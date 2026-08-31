import { describe, expect, it, vi } from 'vitest';
import { Repository, RepositoryDependencies } from './repository';

type MockRecord = Record<string, ReturnType<typeof vi.fn>>;

const createService = (methodNames: string[]) => {
	const methods = methodNames.reduce<MockRecord>((acc, method) => {
		acc[method] = vi.fn();
		return acc;
	}, {});
	return { instance: methods as unknown as Record<string, unknown>, methods };
};

const buildRepository = () => {
	const availability = createService([
		'disconnect',
		'getIMDBIdByHash',
		'handleDownloadedTorrent',
		'upsertAvailability',
		'saveInstantAvailability',
		'saveInstantAvailabilityAd',
		'getDebridioRefreshedAt',
		'markDebridioRefreshed',
		'checkAvailability',
		'checkAvailabilityByHashes',
		'removeAvailability',
	]);

	const scraped = createService([
		'disconnect',
		'getScrapedTrueResults',
		'getScrapedResults',
		'saveScrapedTrueResults',
		'saveScrapedResults',
		'keyExists',
		'isOlderThan',
		'getOldestRequest',
		'processingMoreThanAnHour',
		'getOldestScrapedMedia',
		'getAllImdbIds',
		'markAsDone',
		'getRecentlyUpdatedContent',
		'getContentSize',
		'getProcessingCount',
		'getRequestedCount',
	]);

	const search = createService(['disconnect', 'saveSearchResults', 'getSearchResults']);

	const anime = createService([
		'disconnect',
		'getRecentlyUpdatedAnime',
		'searchAnimeByTitle',
		'getAnimeByMalIds',
		'getAnimeByKitsuIds',
	]);

	const cast = createService([
		'disconnect',
		'saveCastProfile',
		'getLatestCast',
		'getCastURLs',
		'getCastProfile',
		'saveCast',
		'fetchCastedMovies',
		'fetchCastedShows',
		'fetchAllCastedLinks',
		'deleteCastedLink',
		'getAllUserCasts',
	]);

	const report = createService([
		'disconnect',
		'reportContent',
		'getEmptyMedia',
		'getReportedHashes',
	]);

	const snapshots = createService(['disconnect', 'upsertSnapshot', 'getLatestSnapshot']);

	const deps: RepositoryDependencies = {
		availabilityService: availability.instance as any,
		scrapedService: scraped.instance as any,
		searchService: search.instance as any,
		animeService: anime.instance as any,
		castService: cast.instance as any,
		reportService: report.instance as any,
		torrentSnapshotService: snapshots.instance as any,
	};

	return {
		repo: new Repository(deps),
		mocks: {
			availability,
			scraped,
			search,
			anime,
			cast,
			report,
			snapshots,
		},
	};
};

describe('Repository', () => {
	it('delegates each API to the matching service', async () => {
		const { repo, mocks } = buildRepository();

		const matrix: Array<{
			method: keyof Repository;
			service: keyof typeof mocks;
			serviceMethod: string;
			args: any[];
			value: unknown;
		}> = [
			{
				method: 'getIMDBIdByHash',
				service: 'availability',
				serviceMethod: 'getIMDBIdByHash',
				args: ['hash'],
				value: 'tt123',
			},
			{
				method: 'handleDownloadedTorrent',
				service: 'availability',
				serviceMethod: 'handleDownloadedTorrent',
				args: [{}, 'hash', 'tt123'],
				value: undefined,
			},
			{
				method: 'upsertAvailability',
				service: 'availability',
				serviceMethod: 'upsertAvailability',
				args: [{ hash: 'hash' }],
				value: { ok: true },
			},
			{
				method: 'saveInstantAvailability',
				service: 'availability',
				serviceMethod: 'saveInstantAvailability',
				args: ['tt', [{ hash: 'hash', filename: 'f.mkv', bytes: 1 }]],
				value: 1,
			},
			{
				method: 'saveInstantAvailabilityAd',
				service: 'availability',
				serviceMethod: 'saveInstantAvailabilityAd',
				args: ['tt', [{ hash: 'hash', filename: 'f.mkv', bytes: 1 }]],
				value: 1,
			},
			{
				method: 'getDebridioRefreshedAt',
				service: 'availability',
				serviceMethod: 'getDebridioRefreshedAt',
				args: ['movie:tt'],
				value: new Date('2026-08-31'),
			},
			{
				method: 'markDebridioRefreshed',
				service: 'availability',
				serviceMethod: 'markDebridioRefreshed',
				args: ['movie:tt'],
				value: undefined,
			},
			{
				method: 'checkAvailability',
				service: 'availability',
				serviceMethod: 'checkAvailability',
				args: ['tt', ['h1']],
				value: ['available'],
			},
			{
				method: 'checkAvailabilityByHashes',
				service: 'availability',
				serviceMethod: 'checkAvailabilityByHashes',
				args: [['h1']],
				value: [true],
			},
			{
				method: 'removeAvailability',
				service: 'availability',
				serviceMethod: 'removeAvailability',
				args: ['hash'],
				value: undefined,
			},
			{
				method: 'getScrapedTrueResults',
				service: 'scraped',
				serviceMethod: 'getScrapedTrueResults',
				args: ['key', 10, 1],
				value: [],
			},
			{
				method: 'getScrapedResults',
				service: 'scraped',
				serviceMethod: 'getScrapedResults',
				args: ['key', 10, 1],
				value: [],
			},
			{
				method: 'saveScrapedTrueResults',
				service: 'scraped',
				serviceMethod: 'saveScrapedTrueResults',
				args: ['key', [], true, true],
				value: undefined,
			},
			{
				method: 'saveScrapedResults',
				service: 'scraped',
				serviceMethod: 'saveScrapedResults',
				args: ['key', [], true, true],
				value: undefined,
			},
			{
				method: 'keyExists',
				service: 'scraped',
				serviceMethod: 'keyExists',
				args: ['key'],
				value: true,
			},
			{
				method: 'isOlderThan',
				service: 'scraped',
				serviceMethod: 'isOlderThan',
				args: ['tt', 3],
				value: false,
			},
			{
				method: 'getOldestRequest',
				service: 'scraped',
				serviceMethod: 'getOldestRequest',
				args: [new Date()],
				value: { imdbId: 'tt' },
			},
			{
				method: 'processingMoreThanAnHour',
				service: 'scraped',
				serviceMethod: 'processingMoreThanAnHour',
				args: [],
				value: false,
			},
			{
				method: 'getOldestScrapedMedia',
				service: 'scraped',
				serviceMethod: 'getOldestScrapedMedia',
				args: ['tv', 2],
				value: [],
			},
			{
				method: 'getAllImdbIds',
				service: 'scraped',
				serviceMethod: 'getAllImdbIds',
				args: ['tv'],
				value: ['tt'],
			},
			{
				method: 'markAsDone',
				service: 'scraped',
				serviceMethod: 'markAsDone',
				args: ['tt'],
				value: undefined,
			},
			{
				method: 'getRecentlyUpdatedContent',
				service: 'scraped',
				serviceMethod: 'getRecentlyUpdatedContent',
				args: [],
				value: [],
			},
			{
				method: 'saveSearchResults',
				service: 'search',
				serviceMethod: 'saveSearchResults',
				args: ['key', { value: 1 }],
				value: undefined,
			},
			{
				method: 'getSearchResults',
				service: 'search',
				serviceMethod: 'getSearchResults',
				args: ['key'],
				value: { foo: 'bar' },
			},
			{
				method: 'getRecentlyUpdatedAnime',
				service: 'anime',
				serviceMethod: 'getRecentlyUpdatedAnime',
				args: [5],
				value: [],
			},
			{
				method: 'searchAnimeByTitle',
				service: 'anime',
				serviceMethod: 'searchAnimeByTitle',
				args: ['title'],
				value: [],
			},
			{
				method: 'getAnimeByMalIds',
				service: 'anime',
				serviceMethod: 'getAnimeByMalIds',
				args: [[1]],
				value: [],
			},
			{
				method: 'getAnimeByKitsuIds',
				service: 'anime',
				serviceMethod: 'getAnimeByKitsuIds',
				args: [[1]],
				value: [],
			},
			{
				method: 'saveCastProfile',
				service: 'cast',
				serviceMethod: 'saveCastProfile',
				args: ['user', 'id', 'secret', 'refresh', 15, 3, undefined, undefined],
				value: undefined,
			},
			{
				method: 'getLatestCast',
				service: 'cast',
				serviceMethod: 'getLatestCast',
				args: ['tt', 'user'],
				value: {},
			},
			{
				method: 'getCastURLs',
				service: 'cast',
				serviceMethod: 'getCastURLs',
				args: ['tt', 'user'],
				value: ['url'],
			},
			{
				method: 'getCastProfile',
				service: 'cast',
				serviceMethod: 'getCastProfile',
				args: ['user'],
				value: { id: 'user' },
			},
			{
				method: 'saveCast',
				service: 'cast',
				serviceMethod: 'saveCast',
				args: ['tt', 'user', 'hash', 'url', 'rd', 1],
				value: undefined,
			},
			{
				method: 'fetchCastedMovies',
				service: 'cast',
				serviceMethod: 'fetchCastedMovies',
				args: ['user'],
				value: ['movie'],
			},
			{
				method: 'fetchCastedShows',
				service: 'cast',
				serviceMethod: 'fetchCastedShows',
				args: ['user'],
				value: ['show'],
			},
			{
				method: 'fetchAllCastedLinks',
				service: 'cast',
				serviceMethod: 'fetchAllCastedLinks',
				args: ['user'],
				value: [],
			},
			{
				method: 'deleteCastedLink',
				service: 'cast',
				serviceMethod: 'deleteCastedLink',
				args: ['tt', 'user', 'hash'],
				value: undefined,
			},
			{
				method: 'getAllUserCasts',
				service: 'cast',
				serviceMethod: 'getAllUserCasts',
				args: ['user'],
				value: [],
			},
			{
				method: 'upsertTorrentSnapshot',
				service: 'snapshots',
				serviceMethod: 'upsertSnapshot',
				args: [{ id: '1', hash: 'h', addedDate: new Date(), payload: {} }],
				value: undefined,
			},
			{
				method: 'getLatestTorrentSnapshot',
				service: 'snapshots',
				serviceMethod: 'getLatestSnapshot',
				args: ['hash'],
				value: { id: '1' },
			},
			{
				method: 'reportContent',
				service: 'report',
				serviceMethod: 'reportContent',
				args: ['hash', 'tt', 'user', 'porn'],
				value: undefined,
			},
			{
				method: 'getEmptyMedia',
				service: 'report',
				serviceMethod: 'getEmptyMedia',
				args: [5],
				value: [],
			},
			{
				method: 'getReportedHashes',
				service: 'report',
				serviceMethod: 'getReportedHashes',
				args: ['tt'],
				value: [],
			},
			{
				method: 'getContentSize',
				service: 'scraped',
				serviceMethod: 'getContentSize',
				args: [],
				value: 1,
			},
			{
				method: 'getProcessingCount',
				service: 'scraped',
				serviceMethod: 'getProcessingCount',
				args: [],
				value: 2,
			},
			{
				method: 'getRequestedCount',
				service: 'scraped',
				serviceMethod: 'getRequestedCount',
				args: [],
				value: 3,
			},
		];

		for (const entry of matrix) {
			const service = mocks[entry.service].methods;
			service[entry.serviceMethod].mockReturnValue(entry.value);
			const result = (repo as any)[entry.method](...entry.args);
			expect(service[entry.serviceMethod]).toHaveBeenCalledWith(...entry.args);
			expect(result).toBe(entry.value);
		}
	});

	it('disconnects every underlying service', async () => {
		const { repo, mocks } = buildRepository();
		await repo.disconnect();
		for (const service of Object.values(mocks)) {
			expect(service.methods.disconnect).toHaveBeenCalledTimes(1);
		}
	});
});
