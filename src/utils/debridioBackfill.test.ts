import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	backfillFromDebridioNow,
	refreshDebridioAvailabilityInBackground,
} from './debridioBackfill';

const {
	keyExistsMock,
	saveScrapedResultsMock,
	markAsDoneMock,
	saveScrapedTrueResultsMock,
	saveInstantAvailabilityMock,
	saveInstantAvailabilityAdMock,
	getDebridioRefreshedAtMock,
	markDebridioRefreshedMock,
	enabledMock,
	providersMock,
	scrapeMovieMock,
	scrapeSeasonMock,
	cinemetaMock,
} = vi.hoisted(() => ({
	keyExistsMock: vi.fn(),
	saveScrapedResultsMock: vi.fn(),
	markAsDoneMock: vi.fn(),
	saveScrapedTrueResultsMock: vi.fn(),
	saveInstantAvailabilityMock: vi.fn(),
	saveInstantAvailabilityAdMock: vi.fn(),
	getDebridioRefreshedAtMock: vi.fn(),
	markDebridioRefreshedMock: vi.fn(),
	enabledMock: vi.fn(),
	providersMock: vi.fn(),
	scrapeMovieMock: vi.fn(),
	scrapeSeasonMock: vi.fn(),
	cinemetaMock: vi.fn(),
}));

vi.mock('@/services/repository', () => ({
	repository: {
		keyExists: keyExistsMock,
		saveScrapedResults: saveScrapedResultsMock,
		markAsDone: markAsDoneMock,
		saveScrapedTrueResults: saveScrapedTrueResultsMock,
		saveInstantAvailability: saveInstantAvailabilityMock,
		saveInstantAvailabilityAd: saveInstantAvailabilityAdMock,
		getDebridioRefreshedAt: getDebridioRefreshedAtMock,
		markDebridioRefreshed: markDebridioRefreshedMock,
	},
}));

vi.mock('@/services/debridio', () => ({
	isDebridioEnabled: enabledMock,
	configuredDebridioProviders: providersMock,
	scrapeDebridioMovie: scrapeMovieMock,
	scrapeDebridioSeason: scrapeSeasonMock,
}));

vi.mock('@/services/metadataCache', () => ({
	getMetadataCache: () => ({ getCinemetaSeries: cinemetaMock }),
}));

const MOVIE_TARGET = { imdbId: 'tt0111161', key: 'movie:tt0111161', kind: 'movie' } as const;
const SEASON_TARGET = {
	imdbId: 'tt0903747',
	key: 'tv:tt0903747:1',
	kind: 'series',
	season: 1,
} as const;

const SCRAPE = {
	torrents: [{ title: 'Some.Release.1080p', fileSize: 2048, hash: 'a'.repeat(40) }],
	available: [{ hash: 'a'.repeat(40), filename: 'Some.Release.1080p.mkv', bytes: 2147483648 }],
};

const AD_SCRAPE = {
	torrents: [
		{ title: 'Some.Release.1080p', fileSize: 2048, hash: 'a'.repeat(40) },
		{ title: 'AD.Only.Release.2160p', fileSize: 4096, hash: 'b'.repeat(40) },
	],
	available: [{ hash: 'b'.repeat(40), filename: 'AD.Only.Release.2160p.mkv', bytes: 4294967296 }],
};

describe('backfillFromDebridioNow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		enabledMock.mockReturnValue(true);
		providersMock.mockReturnValue(['realdebrid']);
		scrapeMovieMock.mockReset();
		scrapeSeasonMock.mockReset();
		keyExistsMock.mockResolvedValue(false);
		saveScrapedResultsMock.mockResolvedValue(undefined);
		markAsDoneMock.mockResolvedValue(undefined);
		saveInstantAvailabilityMock.mockResolvedValue(1);
		saveInstantAvailabilityAdMock.mockResolvedValue(1);
		getDebridioRefreshedAtMock.mockResolvedValue(null);
		markDebridioRefreshedMock.mockResolvedValue(undefined);
	});

	it('returns nothing and touches nothing when debridio is disabled', async () => {
		enabledMock.mockReturnValue(false);

		expect(await backfillFromDebridioNow(MOVIE_TARGET)).toEqual([]);
		expect(keyExistsMock).not.toHaveBeenCalled();
		expect(scrapeMovieMock).not.toHaveBeenCalled();
	});

	it('steps aside when another scrape of this title is in flight', async () => {
		keyExistsMock.mockResolvedValue(true);

		expect(await backfillFromDebridioNow(MOVIE_TARGET)).toEqual([]);
		expect(scrapeMovieMock).not.toHaveBeenCalled();
		expect(markAsDoneMock).not.toHaveBeenCalled();
	});

	it('does not re-scrape a key tombstoned inside the ttl', async () => {
		getDebridioRefreshedAtMock.mockResolvedValue(new Date());

		expect(await backfillFromDebridioNow(MOVIE_TARGET)).toEqual([]);
		expect(scrapeMovieMock).not.toHaveBeenCalled();
		expect(keyExistsMock).not.toHaveBeenCalled();
	});

	it('scrapes, persists torrents and availability, and cleans the processing key', async () => {
		scrapeMovieMock.mockResolvedValue(SCRAPE);

		const results = await backfillFromDebridioNow(MOVIE_TARGET);

		expect(results).toEqual(SCRAPE.torrents);
		expect(keyExistsMock).toHaveBeenCalledWith('processing:tt0111161');
		expect(saveScrapedResultsMock).toHaveBeenCalledWith('processing:tt0111161', []);
		expect(saveScrapedTrueResultsMock).toHaveBeenCalledWith(
			'movie:tt0111161',
			SCRAPE.torrents,
			true
		);
		expect(saveInstantAvailabilityMock).toHaveBeenCalledWith('tt0111161', SCRAPE.available);
		expect(markDebridioRefreshedMock).toHaveBeenCalledWith('movie:tt0111161');
		expect(markAsDoneMock).toHaveBeenCalledWith('tt0111161');
	});

	it('fans a season out over the episodes cinemeta reports', async () => {
		cinemetaMock.mockResolvedValue({
			meta: {
				videos: [
					{ season: 1, episode: 2 },
					{ season: 1, episode: 7 },
					{ season: 2, episode: 1 },
				],
			},
		});
		scrapeSeasonMock.mockResolvedValue(SCRAPE);

		await backfillFromDebridioNow(SEASON_TARGET);

		expect(scrapeSeasonMock).toHaveBeenCalledWith('tt0903747', 1, [2, 7], 'realdebrid');
		expect(saveInstantAvailabilityMock).toHaveBeenCalledWith('tt0903747', SCRAPE.available);
	});

	it('falls back to episodes 1-12 when cinemeta fails', async () => {
		cinemetaMock.mockRejectedValue(new Error('cinemeta down'));
		scrapeSeasonMock.mockResolvedValue(SCRAPE);

		await backfillFromDebridioNow(SEASON_TARGET);

		const episodes = scrapeSeasonMock.mock.calls[0][2];
		expect(episodes).toHaveLength(12);
		expect(episodes[0]).toBe(1);
		expect(episodes[11]).toBe(12);
	});

	it('clears the processing key and returns [] when the scrape fails', async () => {
		scrapeMovieMock.mockRejectedValue(new Error('debridio responded 500'));

		expect(await backfillFromDebridioNow(MOVIE_TARGET)).toEqual([]);
		expect(markAsDoneMock).toHaveBeenCalledWith('tt0111161');
		expect(saveScrapedTrueResultsMock).not.toHaveBeenCalled();
	});

	it('skips persistence entirely for a title debridio does not know', async () => {
		scrapeMovieMock.mockResolvedValue({ torrents: [], available: [] });

		expect(await backfillFromDebridioNow(MOVIE_TARGET)).toEqual([]);
		expect(saveScrapedTrueResultsMock).not.toHaveBeenCalled();
		expect(saveInstantAvailabilityMock).not.toHaveBeenCalled();
	});

	it('splits availability by provider and dedupes shared torrents across both', async () => {
		providersMock.mockReturnValue(['realdebrid', 'alldebrid']);
		scrapeMovieMock.mockImplementation(async (_imdbId: string, provider: string) =>
			provider === 'alldebrid' ? AD_SCRAPE : SCRAPE
		);

		const results = await backfillFromDebridioNow(MOVIE_TARGET);

		expect(results).toHaveLength(2);
		expect(saveScrapedTrueResultsMock).toHaveBeenCalledWith(
			'movie:tt0111161',
			expect.arrayContaining([
				expect.objectContaining({ hash: 'a'.repeat(40) }),
				expect.objectContaining({ hash: 'b'.repeat(40) }),
			]),
			true
		);
		expect(saveInstantAvailabilityMock).toHaveBeenCalledWith('tt0111161', SCRAPE.available);
		expect(saveInstantAvailabilityAdMock).toHaveBeenCalledWith(
			'tt0111161',
			AD_SCRAPE.available
		);
	});

	it('persists the healthy provider and still tombstones when only alldebrid fails', async () => {
		providersMock.mockReturnValue(['realdebrid', 'alldebrid']);
		scrapeMovieMock.mockImplementation(async (_imdbId: string, provider: string) => {
			if (provider === 'alldebrid') throw new Error('The auth apikey is invalid');
			return SCRAPE;
		});

		const results = await backfillFromDebridioNow(MOVIE_TARGET);

		expect(results).toEqual(SCRAPE.torrents);
		expect(saveInstantAvailabilityMock).toHaveBeenCalledWith('tt0111161', SCRAPE.available);
		expect(saveInstantAvailabilityAdMock).not.toHaveBeenCalled();
		expect(markDebridioRefreshedMock).toHaveBeenCalledWith('movie:tt0111161');
	});

	it('fails without tombstoning when every configured provider fails', async () => {
		providersMock.mockReturnValue(['realdebrid', 'alldebrid']);
		scrapeMovieMock.mockRejectedValue(new Error('(upstream_error) bad_token'));

		expect(await backfillFromDebridioNow(MOVIE_TARGET)).toEqual([]);
		expect(markDebridioRefreshedMock).not.toHaveBeenCalled();
		expect(markAsDoneMock).toHaveBeenCalledWith('tt0111161');
	});
});

describe('refreshDebridioAvailabilityInBackground', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		enabledMock.mockReturnValue(true);
		providersMock.mockReturnValue(['realdebrid']);
		getDebridioRefreshedAtMock.mockResolvedValue(null);
		markDebridioRefreshedMock.mockResolvedValue(undefined);
		scrapeMovieMock.mockResolvedValue(SCRAPE);
		saveInstantAvailabilityMock.mockResolvedValue(1);
		saveInstantAvailabilityAdMock.mockResolvedValue(1);
	});

	it('does nothing while disabled', async () => {
		enabledMock.mockReturnValue(false);

		await refreshDebridioAvailabilityInBackground(MOVIE_TARGET);

		expect(getDebridioRefreshedAtMock).not.toHaveBeenCalled();
	});

	it('skips a key refreshed inside the ttl', async () => {
		getDebridioRefreshedAtMock.mockResolvedValue(new Date());

		await refreshDebridioAvailabilityInBackground(MOVIE_TARGET);

		expect(scrapeMovieMock).not.toHaveBeenCalled();
		expect(markDebridioRefreshedMock).not.toHaveBeenCalled();
	});

	it('refreshes and re-arms the ttl when the last refresh is older', async () => {
		getDebridioRefreshedAtMock.mockResolvedValue(new Date('2026-01-01'));

		await refreshDebridioAvailabilityInBackground(MOVIE_TARGET);

		expect(scrapeMovieMock).toHaveBeenCalledWith('tt0111161', 'realdebrid');
		expect(saveInstantAvailabilityMock).toHaveBeenCalledWith('tt0111161', SCRAPE.available);
		expect(markDebridioRefreshedMock).toHaveBeenCalledWith('movie:tt0111161');
	});

	it('does not re-arm the ttl when the scrape fails', async () => {
		getDebridioRefreshedAtMock.mockResolvedValue(new Date('2026-01-01'));
		scrapeMovieMock.mockRejectedValue(new Error('boom'));

		await refreshDebridioAvailabilityInBackground(MOVIE_TARGET);

		expect(markDebridioRefreshedMock).not.toHaveBeenCalled();
	});

	it('swallows failures without rejecting', async () => {
		scrapeMovieMock.mockRejectedValue(new Error('boom'));

		await expect(
			refreshDebridioAvailabilityInBackground(MOVIE_TARGET)
		).resolves.toBeUndefined();
	});
});
