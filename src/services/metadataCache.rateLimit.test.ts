import trakt429 from '@/test/fixtures/metadata/trakt-429-rate-limited.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle } from './metadata';
import { MetadataCacheService } from './metadataCache';
import {
	ProviderCooldownError,
	resetProviderCooldowns,
	trackProviderGaps,
} from './providerCooldown';

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {},
	}),
}));

const cache = vi.hoisted(() => ({
	getWithMetadata: vi.fn(),
	set: vi.fn(),
}));

vi.mock('./database/mdblistCache', () => ({
	getMdblistCacheService: () => cache,
}));

const axiosMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('axios', () => ({
	default: { get: axiosMocks.get },
}));

/**
 * The recorded answer as axios rejects with it: an AxiosError whose response
 * carries the status, the headers (lower-cased, as axios presents them) and the
 * body.
 */
async function recorded429() {
	const { AxiosError } = await vi.importActual<typeof import('axios')>('axios');
	const headers = Object.fromEntries(
		Object.entries(trakt429.headers).map(([name, value]) => [name.toLowerCase(), value])
	);
	const config: any = { url: trakt429.request.url, headers: { 'trakt-api-key': 'client-id' } };
	return new AxiosError(
		`Request failed with status code ${trakt429.status}`,
		AxiosError.ERR_BAD_REQUEST,
		config,
		{},
		{
			status: trakt429.status,
			statusText: '',
			headers,
			config,
			data: trakt429.body,
		}
	);
}

/** Every line the service printed through console.error/warn/log during a test. */
function captureLogs() {
	const lines: unknown[][] = [];
	for (const level of ['error', 'warn'] as const) {
		vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
			lines.push(args);
		});
	}
	vi.spyOn(console, 'log').mockImplementation(() => {});
	return lines;
}

const T0 = Date.parse('2026-10-07T15:34:18Z');

beforeEach(() => {
	vi.useFakeTimers({ now: T0, toFake: ['Date'] });
	resetProviderCooldowns();
	cache.getWithMetadata.mockReset().mockResolvedValue(null);
	cache.set.mockReset().mockResolvedValue(undefined);
	axiosMocks.get.mockReset();
	process.env.TRAKT_CLIENT_ID = 'client-id';
	process.env.TMDB_KEY = 'tmdb-key';
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

// On 2026-10-07 fun's zurg-usenet restarted and asked /api/metadata/resolve 620
// times in three minutes. DMM kept sending Trakt searches after Trakt began
// answering 429, and wrote a thirteen-line error dump for each refusal.
describe('MetadataCacheService after Trakt answers 429', () => {
	it('sends Trakt nothing more for Retry-After, and says so in one line', async () => {
		const logs = captureLogs();
		axiosMocks.get.mockRejectedValueOnce(await recorded429()).mockResolvedValue({ data: [] });

		const service = new MetadataCacheService();
		const outcomes: unknown[] = [];
		for (let i = 0; i < 620; i++) {
			outcomes.push(
				await service.searchTraktTitles('show', `Release ${i}`).then(
					(hits) => hits,
					(error) => error
				)
			);
		}

		expect(axiosMocks.get).toHaveBeenCalledTimes(1);
		// None of them is answered as if Trakt had searched and found nothing.
		expect(outcomes.every((outcome) => outcome instanceof Error)).toBe(true);
		expect(cache.set).not.toHaveBeenCalled();
		expect(logs).toHaveLength(1);
		expect(logs[0]).toHaveLength(1);
		expect(logs[0][0]).toEqual(expect.stringContaining('api.trakt.tv answered 429'));
		expect(logs[0][0]).toEqual(expect.stringContaining('600s'));
	});

	it('asks Trakt again once Retry-After has passed', async () => {
		captureLogs();
		axiosMocks.get.mockRejectedValueOnce(await recorded429()).mockResolvedValue({ data: [] });
		const service = new MetadataCacheService();

		await expect(service.searchTraktTitles('show', 'Gintama')).rejects.toThrow();
		vi.setSystemTime(T0 + 599_000);
		await expect(service.searchTraktTitles('show', 'Gintama')).rejects.toThrow();
		expect(axiosMocks.get).toHaveBeenCalledTimes(1);

		vi.setSystemTime(T0 + 601_000);
		await expect(service.searchTraktTitles('show', 'Gintama')).resolves.toEqual([]);
		expect(axiosMocks.get).toHaveBeenCalledTimes(2);
	});

	it('serves an expired row during the cooldown without asking Trakt', async () => {
		const logs = captureLogs();
		const stale = { data: [{ show: { ids: { imdb: 'tt0988824' } } }], updatedAt: new Date(0) };
		cache.getWithMetadata.mockResolvedValue(stale);
		axiosMocks.get.mockRejectedValueOnce(await recorded429());
		const service = new MetadataCacheService();

		await expect(service.searchTraktTitles('show', 'Naruto')).resolves.toEqual(stale.data);
		await expect(service.searchTraktTitles('show', 'Naruto Shippuden')).resolves.toEqual(
			stale.data
		);
		expect(axiosMocks.get).toHaveBeenCalledTimes(1);
		expect(logs).toHaveLength(1);
	});

	it('keeps asking other providers', async () => {
		captureLogs();
		axiosMocks.get
			.mockRejectedValueOnce(await recorded429())
			.mockResolvedValue({ data: { results: [] } });
		const service = new MetadataCacheService();

		await expect(service.searchTraktTitles('show', 'Bleach')).rejects.toThrow();
		await expect(service.searchTmdbTitles('tv', 'Bleach')).resolves.toEqual({ results: [] });
		expect(axiosMocks.get).toHaveBeenCalledTimes(2);
		expect(String(axiosMocks.get.mock.calls[1][0])).toContain('api.themoviedb.org');
	});

	it('answers the episode schedule from the cooldown too, silently', async () => {
		const logs = captureLogs();
		axiosMocks.get.mockRejectedValueOnce(await recorded429());
		const service = new MetadataCacheService();

		await expect(service.searchTraktTitles('show', 'Wano')).rejects.toThrow();
		await expect(service.getTraktShowEpisode('tt0388629', 'next_episode')).resolves.toBeNull();
		await expect(service.getTraktShowEpisode('tt0388629', 'last_episode')).resolves.toBeNull();
		expect(axiosMocks.get).toHaveBeenCalledTimes(1);
		expect(logs).toHaveLength(1);
	});

	it('marks a tracked lookup incomplete when the refusal leaves it without data', async () => {
		captureLogs();
		axiosMocks.get.mockRejectedValueOnce(await recorded429());
		const service = new MetadataCacheService();

		const first = await trackProviderGaps(() =>
			service.searchTraktTitles('show', 'Skypiea').catch(() => null)
		);
		expect(first.retryAfterMs).toBe(600_000);

		vi.setSystemTime(T0 + 60_000);
		const later = await trackProviderGaps(() =>
			service.searchTraktTitles('show', 'Enies Lobby').catch(() => null)
		);
		expect(later.retryAfterMs).toBe(540_000);

		// A row served stale is data, not a gap.
		cache.getWithMetadata.mockResolvedValue({ data: [], updatedAt: new Date(0) });
		const stale = await trackProviderGaps(() => service.searchTraktTitles('show', 'Jaya'));
		expect(stale.retryAfterMs).toBe(0);
	});

	it('logs a refetch that failed for another reason in one line too', async () => {
		const logs = captureLogs();
		const { AxiosError } = await vi.importActual<typeof import('axios')>('axios');
		cache.getWithMetadata.mockResolvedValue({ data: { meta: {} }, updatedAt: new Date(0) });
		axiosMocks.get.mockRejectedValueOnce(
			new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED', {} as any)
		);
		const service = new MetadataCacheService();

		await service.getCinemetaMovie('tt43622046');
		expect(logs).toHaveLength(1);
		expect(logs[0]).toEqual([
			'[MetadataCache] Refetch failed for cinemeta_movie_tt43622046, serving stale cinemeta_movie: ECONNABORTED timeout of 10000ms exceeded',
		]);
	});
});

// 326 of the 15:34 burst's dumps came from here, one per provider call the
// resolver's candidate lookups lost.
describe('settle', () => {
	it('logs a failed request in one line, and a cooldown refusal not at all', async () => {
		const logs = captureLogs();
		const { AxiosError } = await vi.importActual<typeof import('axios')>('axios');
		const timeout = new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED', {
			url: 'https://v3-cinemeta.strem.io/meta/movie/tt43622046.json',
		} as any);

		await expect(settle(() => Promise.reject(timeout))).resolves.toBeNull();
		await expect(settle(async () => Promise.reject(await recorded429()))).resolves.toBeNull();
		await expect(
			settle(() => Promise.reject(new ProviderCooldownError('api.trakt.tv', 1000)))
		).resolves.toBeNull();

		expect(logs).toEqual([
			['[metadata] provider failed: ECONNABORTED timeout of 10000ms exceeded'],
			['[metadata] provider failed: HTTP 429 from api.trakt.tv'],
		]);
	});
});
