import shawshankCinemeta from '@/test/fixtures/metadata/cinemeta-tt0111161-the-shawshank-redemption.json';
import wednesdayCinemeta from '@/test/fixtures/metadata/cinemeta-tt13443470-wednesday.json';
import thundermansCinemeta from '@/test/fixtures/metadata/cinemeta-tt37752275-clash-of-the-thundermans.json';
import { RECENT_METADATA_TTL } from '@/utils/metadataFreshness';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetadataCacheService, getMetadataCache } from './metadataCache';

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {},
	}),
}));

const cacheFactory: { current: CacheStub | null } = { current: null };

vi.mock('./database/mdblistCache', () => ({
	getMdblistCacheService: () => cacheFactory.current,
}));

const axiosMocks = vi.hoisted(() => ({
	get: vi.fn(),
}));

vi.mock('axios', () => ({
	default: {
		get: axiosMocks.get,
	},
}));

type CacheStub = {
	getWithMetadata: ReturnType<typeof vi.fn>;
	set: ReturnType<typeof vi.fn>;
};

const originalEnv = { ...process.env };

const buildCache = (): CacheStub => ({
	getWithMetadata: vi.fn(),
	set: vi.fn(),
});

beforeEach(() => {
	cacheFactory.current = buildCache();
	axiosMocks.get.mockReset();
	vi.clearAllMocks();
	Object.assign(process.env, originalEnv);
});

afterAll(() => {
	Object.assign(process.env, originalEnv);
});

describe('MetadataCacheService fetchWithCache', () => {
	it('returns cached data when entry is still fresh', async () => {
		const cacheData = { data: { cached: true }, updatedAt: new Date() };
		cacheFactory.current = buildCache();
		cacheFactory.current.getWithMetadata.mockResolvedValue(cacheData);

		const service = new MetadataCacheService();
		const result = await service.fetchWithCache('url', 'key', 'type', undefined, 3600000);

		expect(result).toEqual(cacheData.data);
		expect(axiosMocks.get).not.toHaveBeenCalled();
		expect(cacheFactory.current.set).not.toHaveBeenCalled();
	});

	it('fetches and caches data when entry is missing or expired', async () => {
		const expired = { data: { cached: false }, updatedAt: new Date(Date.now() - 10000) };
		cacheFactory.current = buildCache();
		cacheFactory.current.getWithMetadata.mockResolvedValueOnce(expired);
		axiosMocks.get.mockResolvedValue({ data: { fresh: true } });

		const service = new MetadataCacheService();
		const result = await service.fetchWithCache('url', 'key', 'type', { headers: {} }, 1000);

		expect(result).toEqual({ fresh: true });
		expect(axiosMocks.get).toHaveBeenCalledWith('url', { timeout: 10000, headers: {} });
		expect(cacheFactory.current.set).toHaveBeenCalledWith('key', 'type', { fresh: true });
	});

	it('serves the expired entry when the refetch fails', async () => {
		const stale = { data: { cached: 'stale' }, updatedAt: new Date(Date.now() - 10000) };
		cacheFactory.current = buildCache();
		cacheFactory.current.getWithMetadata.mockResolvedValue(stale);
		axiosMocks.get.mockRejectedValue(new Error('upstream down'));

		const service = new MetadataCacheService();
		const result = await service.fetchWithCache('url', 'key', 'type', undefined, 1000);

		expect(result).toEqual(stale.data);
		expect(cacheFactory.current.set).not.toHaveBeenCalled();
	});

	it('serves the expired entry when the response body is empty', async () => {
		const stale = { data: { cached: 'stale' }, updatedAt: new Date(Date.now() - 10000) };
		cacheFactory.current = buildCache();
		cacheFactory.current.getWithMetadata.mockResolvedValue(stale);
		axiosMocks.get.mockResolvedValue({ data: undefined });

		const service = new MetadataCacheService();
		const result = await service.fetchWithCache('url', 'key', 'type', undefined, 1000);

		expect(result).toEqual(stale.data);
	});

	it('rethrows when the refetch fails and nothing is cached', async () => {
		cacheFactory.current = buildCache();
		cacheFactory.current.getWithMetadata.mockResolvedValue(null);
		axiosMocks.get.mockRejectedValue(new Error('upstream down'));

		const service = new MetadataCacheService();
		await expect(service.fetchWithCache('url', 'key', 'type', undefined, 1000)).rejects.toThrow(
			'upstream down'
		);
	});

	it('continues even if cache.set throws', async () => {
		cacheFactory.current = buildCache();
		cacheFactory.current.getWithMetadata.mockResolvedValue(null);
		cacheFactory.current.set.mockRejectedValue(new Error('write failure'));
		axiosMocks.get.mockResolvedValue({ data: { ok: true } });

		const service = new MetadataCacheService();
		await expect(service.fetchWithCache('url', 'key', 'type')).resolves.toEqual({ ok: true });
		expect(cacheFactory.current.set).toHaveBeenCalled();
	});
});

describe('MetadataCacheService API helpers', () => {
	it('throws when OMDB key is missing', async () => {
		const saved = process.env.OMDB_KEY;
		delete process.env.OMDB_KEY;
		try {
			const service = new MetadataCacheService();
			await expect(service.getOmdbInfo('tt123')).rejects.toThrow(
				'OMDB_KEY environment variable is not set'
			);
		} finally {
			process.env.OMDB_KEY = saved;
		}
	});

	it('throws when TMDB key is missing', async () => {
		const saved = process.env.TMDB_KEY;
		delete process.env.TMDB_KEY;
		try {
			const service = new MetadataCacheService();
			await expect(service.searchTmdbByImdb('tt123')).rejects.toThrow(
				'TMDB_KEY environment variable is not set'
			);
		} finally {
			process.env.TMDB_KEY = saved;
		}
	});

	it('throws when Trakt client id is missing', async () => {
		const saved = process.env.TRAKT_CLIENT_ID;
		delete process.env.TRAKT_CLIENT_ID;
		try {
			const service = new MetadataCacheService();
			await expect(service.getTraktTrending('movies')).rejects.toThrow(
				'TRAKT_CLIENT_ID environment variable is not set'
			);
		} finally {
			process.env.TRAKT_CLIENT_ID = saved;
		}
	});

	it('delegates to fetchWithCache with proper cache hints', async () => {
		process.env.OMDB_KEY = 'abc';
		process.env.TMDB_KEY = 'tmdb';
		process.env.TRAKT_CLIENT_ID = 'trakt';

		const service = new MetadataCacheService();
		const spy = vi.spyOn(service as any, 'fetchWithCache').mockResolvedValue('ok');

		await service.getCinemetaMovie('tt123');
		await service.searchCinemetaSeries('query');
		await service.searchOmdb('title', 2020, 'movie');
		await service.getTraktPopular('shows', 'drama', 5);
		await service.getTmdbMovieInfo(27205);
		await service.getTmdbTvInfo(1396);
		await service.getTmdbExternalIds(27205, 'movie');

		const [
			movieCall,
			seriesCall,
			omdbCall,
			traktCall,
			tmdbMovieCall,
			tmdbTvCall,
			externalIdsCall,
		] = spy.mock.calls;
		expect(movieCall.slice(0, 4)).toEqual([
			'https://v3-cinemeta.strem.io/meta/movie/tt123.json',
			'cinemeta_movie_tt123',
			'cinemeta_movie',
			undefined,
		]);
		// The lifetime is a function of the cached row, not a constant: a settled
		// movie keeps the 30 days it always had, one still being rated does not.
		const movieMaxAge = movieCall[4] as (cached: unknown) => number;
		expect(typeof movieMaxAge).toBe('function');
		expect(movieMaxAge({ meta: { released: '1994-09-23T00:00:00.000Z' } })).toBe(2592000000);
		expect(movieMaxAge({ meta: { releaseInfo: String(new Date().getFullYear()) } })).toBe(
			RECENT_METADATA_TTL
		);
		expect(seriesCall[0]).toBe(
			'https://v3-cinemeta.strem.io/catalog/series/top/search=query.json'
		);
		expect(seriesCall[1]).toBe('cinemeta_search_series_query');
		expect(seriesCall[2]).toBe('cinemeta_search');
		expect(seriesCall[4]).toBe(3600000);

		expect(omdbCall[0]).toBe('https://www.omdbapi.com/?s=title&y=2020&apikey=abc&type=movie');
		expect(omdbCall[1]).toBe('omdb_search_title_2020_movie');
		expect(omdbCall[2]).toBe('omdb_search');
		expect(omdbCall[4]).toBe(3600000);

		expect(traktCall[0]).toBe('https://api.trakt.tv/shows/popular?genres=drama&limit=5');
		expect(traktCall[1]).toBe('trakt_popular_shows_drama_5');
		expect(traktCall[2]).toBe('trakt_popular');
		expect(traktCall[3]).toEqual(
			expect.objectContaining({
				headers: expect.objectContaining({
					'trakt-api-key': 'trakt',
				}),
			})
		);
		expect(traktCall[4]).toBe(21600000);

		// TMDB titles and posters get revised upstream, so neither may be permanent.
		expect(tmdbMovieCall[2]).toBe('tmdb_movie');
		// A film's lifetime is read off the row: 30 days once it has been out a
		// while, hours while it is recent or not yet released.
		const movieLifetime = tmdbMovieCall[4] as (row: unknown) => number;
		expect(movieLifetime({ release_date: '2001-07-20' })).toBe(2592000000);
		expect(movieLifetime({ release_date: new Date(Date.now() + 86400000).toISOString() })).toBe(
			RECENT_METADATA_TTL
		);
		expect(tmdbTvCall[2]).toBe('tmdb_tv');
		// A show's lifetime is read off the row: a week once it has ended, hours
		// while it still has an episode to air.
		expect(
			(tmdbTvCall[4] as (row: unknown) => number)({
				status: 'Ended',
				last_air_date: '2013-09-29',
			})
		).toBe(604800000);
		expect(
			(tmdbTvCall[4] as (row: unknown) => number)({
				status: 'Returning Series',
				next_episode_to_air: { air_date: new Date(Date.now() + 86400000).toISOString() },
			})
		).toBe(RECENT_METADATA_TTL);

		// External ids are an immutable mapping and stay permanent on purpose.
		expect(externalIdsCall[2]).toBe('tmdb_external_ids');
		expect(externalIdsCall[4]).toBeUndefined();
	});

	it('getMetadataCache returns a singleton instance', () => {
		cacheFactory.current = buildCache();
		const first = getMetadataCache();
		const second = getMetadataCache();
		expect(first).toBe(second);
	});
});

describe('Cinemeta cache lifetime follows the title', () => {
	// Pinned to the day the fixtures were captured so "recent" keeps meaning what
	// it meant then. Only Date is faked; the service still awaits real promises.
	const CAPTURED_AT = new Date('2026-09-11T12:00:00Z');
	const HOURS = 60 * 60 * 1000;

	beforeEach(() => {
		cacheFactory.current = buildCache();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(CAPTURED_AT);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const cachedRow = (data: unknown, ageMs: number) => ({
		data,
		updatedAt: new Date(Date.now() - ageMs),
	});

	it('refetches a movie released days ago once the row is hours old', async () => {
		const service = new MetadataCacheService();
		cacheFactory.current!.getWithMetadata.mockResolvedValue(
			cachedRow(thundermansCinemeta, 7 * HOURS)
		);
		axiosMocks.get.mockResolvedValue({ data: { meta: { imdbRating: '4.6' } } });

		const result = await service.getCinemetaMovie('tt37752275');

		expect(axiosMocks.get).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ meta: { imdbRating: '4.6' } });
	});

	it('still serves that row while it is fresh', async () => {
		const service = new MetadataCacheService();
		cacheFactory.current!.getWithMetadata.mockResolvedValue(
			cachedRow(thundermansCinemeta, 2 * HOURS)
		);

		await service.getCinemetaMovie('tt37752275');

		expect(axiosMocks.get).not.toHaveBeenCalled();
	});

	it('keeps serving a settled movie for the full thirty days', async () => {
		const service = new MetadataCacheService();
		cacheFactory.current!.getWithMetadata.mockResolvedValue(
			cachedRow(shawshankCinemeta, 10 * 24 * HOURS)
		);

		await service.getCinemetaMovie('tt0111161');

		expect(axiosMocks.get).not.toHaveBeenCalled();
	});

	it('refetches an airing series once its row is hours old', async () => {
		const service = new MetadataCacheService();
		cacheFactory.current!.getWithMetadata.mockResolvedValue(
			cachedRow(wednesdayCinemeta, 7 * HOURS)
		);
		axiosMocks.get.mockResolvedValue({ data: { meta: { name: 'Wednesday' } } });

		await service.getCinemetaSeries('tt13443470');

		expect(axiosMocks.get).toHaveBeenCalledTimes(1);
	});
});

describe('MetadataCacheService show providers', () => {
	const day = 86400000;

	it('resolves a TVmaze id once, then fetches the show with its embeds', async () => {
		const cache = cacheFactory.current!;
		cache.getWithMetadata.mockResolvedValue(null);
		axiosMocks.get
			.mockResolvedValueOnce({ status: 200, data: { id: 2950 } })
			.mockResolvedValueOnce({
				status: 200,
				data: {
					id: 2950,
					name: 'The Great British Bake Off',
					status: 'Running',
					network: { name: 'Channel 4' },
					_embedded: {
						seasons: [
							{
								number: 17,
								episodeOrder: 10,
								premiereDate: '2026-09-22',
								endDate: '2026-10-06',
								image: { medium: 'x' },
								network: { name: 'Channel 4' },
							},
						],
						nextepisode: {
							season: 17,
							number: 2,
							name: 'Biscuit Week',
							airdate: '2026-09-29',
							airstamp: '2026-09-29T19:00:00+00:00',
							summary: '<p>long</p>',
						},
					},
				},
			});

		const show = await new MetadataCacheService().getTvmazeShow('tt1877368');

		expect(axiosMocks.get.mock.calls[0][0]).toBe(
			'https://api.tvmaze.com/lookup/shows?imdb=tt1877368'
		);
		expect(axiosMocks.get.mock.calls[1][0]).toBe(
			'https://api.tvmaze.com/shows/2950?embed[]=seasons&embed[]=nextepisode&embed[]=previousepisode'
		);
		expect(cache.set).toHaveBeenCalledWith('tvmaze_lookup_tt1877368', 'tvmaze_lookup', {
			id: 2950,
		});
		// Only the fields the merge reads are stored.
		expect(show._embedded.seasons).toEqual([
			{ number: 17, episodeOrder: 10, premiereDate: '2026-09-22', endDate: '2026-10-06' },
		]);
		expect(show._embedded.nextepisode).not.toHaveProperty('summary');
		expect(show).not.toHaveProperty('network');
	});

	it('remembers that TVmaze does not know an id, for a week', async () => {
		const cache = cacheFactory.current!;
		cache.getWithMetadata.mockResolvedValue(null);
		axiosMocks.get.mockResolvedValueOnce({ status: 404, data: { name: 'Not Found' } });

		expect(await new MetadataCacheService().getTvmazeShow('tt0000001')).toBeNull();
		expect(cache.set).toHaveBeenCalledWith('tvmaze_lookup_tt0000001', 'tvmaze_lookup', {
			id: null,
		});

		axiosMocks.get.mockClear();
		cache.getWithMetadata.mockResolvedValue({
			data: { id: null },
			updatedAt: new Date(Date.now() - 6 * day),
		});
		expect(await new MetadataCacheService().getTvmazeShow('tt0000001')).toBeNull();
		expect(axiosMocks.get).not.toHaveBeenCalled();

		cache.getWithMetadata.mockResolvedValue({
			data: { id: null },
			updatedAt: new Date(Date.now() - 8 * day),
		});
		axiosMocks.get.mockResolvedValueOnce({ status: 404, data: {} });
		await new MetadataCacheService().getTvmazeShow('tt0000001');
		expect(axiosMocks.get).toHaveBeenCalledTimes(1);
	});

	it('keeps an airing TVmaze show for hours and an ended one for a week', async () => {
		const cache = cacheFactory.current!;
		const airing = {
			status: 'Running',
			_embedded: {
				seasons: [],
				nextepisode: { airdate: new Date(Date.now() + day).toISOString() },
			},
		};
		const ended = {
			status: 'Ended',
			_embedded: {
				seasons: [{ number: 8, premiereDate: '2015-09-28', endDate: '2022-12-08' }],
			},
		};
		const rows: Record<string, any> = {
			tvmaze_lookup_ttairing: { data: { id: 1 }, updatedAt: new Date() },
			tvmaze_lookup_ttended: { data: { id: 2 }, updatedAt: new Date() },
			tvmaze_show_1: { data: airing, updatedAt: new Date(Date.now() - 7 * 3600000) },
			tvmaze_show_2: { data: ended, updatedAt: new Date(Date.now() - 6 * day) },
		};
		cache.getWithMetadata.mockImplementation(async (key: string) => rows[key] ?? null);
		axiosMocks.get.mockResolvedValue({ status: 200, data: airing });

		await new MetadataCacheService().getTvmazeShow('ttended');
		expect(axiosMocks.get).not.toHaveBeenCalled();

		await new MetadataCacheService().getTvmazeShow('ttairing');
		expect(axiosMocks.get).toHaveBeenCalledTimes(1);
	});

	it('serves a stale TVmaze show when TVmaze is down, and null with nothing cached', async () => {
		const cache = cacheFactory.current!;
		const stale = { id: 1, status: 'Running', _embedded: { seasons: [] } };
		cache.getWithMetadata.mockImplementation(async (key: string) =>
			key === 'tvmaze_lookup_tt1'
				? { data: { id: 1 }, updatedAt: new Date() }
				: { data: stale, updatedAt: new Date(Date.now() - 30 * day) }
		);
		axiosMocks.get.mockRejectedValue(new Error('429'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(await new MetadataCacheService().getTvmazeShow('tt1')).toEqual(stale);

		cache.getWithMetadata.mockResolvedValue(null);
		expect(await new MetadataCacheService().getTvmazeShow('tt2')).toBeNull();
	});

	it('caches Trakt seasons with a lifetime read off the seasons', async () => {
		process.env.TRAKT_CLIENT_ID = 'trakt';
		const service = new MetadataCacheService();
		const spy = vi.spyOn(service, 'fetchWithCache').mockResolvedValue([{ number: 1 }]);

		expect(await service.getTraktShowSeasons('tt1877368')).toEqual([{ number: 1 }]);
		const [url, key, type, config, maxAge] = spy.mock.calls[0];
		expect(url).toBe('https://api.trakt.tv/shows/tt1877368/seasons?extended=full');
		expect(key).toBe('trakt_seasons_tt1877368');
		expect(type).toBe('trakt_seasons');
		expect(config?.validateStatus?.(404)).toBe(true);
		const lifetime = maxAge as (row: unknown) => number;
		expect(lifetime([{ first_aired: '2016-08-24T19:00:00.000Z' }])).toBe(7 * day);
		expect(lifetime([{ first_aired: new Date(Date.now() - day).toISOString() }])).toBe(
			RECENT_METADATA_TTL
		);
	});

	it('answers null for Trakt seasons without a client id or when Trakt fails', async () => {
		delete process.env.TRAKT_CLIENT_ID;
		expect(await new MetadataCacheService().getTraktShowSeasons('tt1')).toBeNull();

		process.env.TRAKT_CLIENT_ID = 'trakt';
		const service = new MetadataCacheService();
		vi.spyOn(service, 'fetchWithCache').mockRejectedValue(new Error('down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await service.getTraktShowSeasons('tt1')).toBeNull();
	});

	it('gives an OMDb series a lifetime from its year range and leaves movies at 30 days', async () => {
		process.env.OMDB_KEY = 'omdb';
		const service = new MetadataCacheService();
		const spy = vi.spyOn(service, 'fetchWithCache').mockResolvedValue({});

		await service.getOmdbInfo('tt1877368');
		const lifetime = spy.mock.calls[0][4] as (row: unknown) => number;
		expect(lifetime({ Type: 'series', Year: '2010–' })).toBe(RECENT_METADATA_TTL);
		expect(lifetime({ Type: 'series', Year: '2004–2011' })).toBe(7 * day);
		expect(lifetime({ Type: 'movie', Year: '2026' })).toBe(30 * day);
	});

	it('caches a TMDB show separately for each appended response', async () => {
		process.env.TMDB_KEY = 'tmdb';
		const service = new MetadataCacheService();
		const spy = vi.spyOn(service, 'fetchWithCache').mockResolvedValue({});

		await service.getTmdbTvInfo(34549, 'videos');
		await service.getTmdbTvInfo(34549);
		expect(spy.mock.calls[0][0]).toContain('/tv/34549?');
		expect(spy.mock.calls[0][0]).toContain('append_to_response=videos');
		expect(spy.mock.calls[0][1]).toBe('tmdb_tv_34549_videos');
		expect(spy.mock.calls[1][1]).toBe('tmdb_tv_34549');
	});

	it('caches Trakt person lookups by name', async () => {
		process.env.TRAKT_CLIENT_ID = 'trakt';
		const service = new MetadataCacheService();
		const spy = vi
			.spyOn(service, 'fetchWithCache')
			.mockResolvedValue([{ person: { ids: { slug: 'paul-hollywood', tmdb: 1 } } }]);

		expect(await service.searchTraktPerson('Paul Hollywood')).toEqual({
			ids: { slug: 'paul-hollywood', tmdb: 1 },
		});
		expect(spy.mock.calls[0][0]).toBe(
			'https://api.trakt.tv/search/person?query=Paul%20Hollywood'
		);
		expect(spy.mock.calls[0][1]).toBe('trakt_search_person_Paul Hollywood');
		expect(spy.mock.calls[0][4]).toBe(30 * day);
	});

	it('caches a Trakt summary per type with a lifetime from its release, and answers null on 404', async () => {
		process.env.TRAKT_CLIENT_ID = 'trakt';
		const service = new MetadataCacheService();
		const spy = vi
			.spyOn(service, 'fetchWithCache')
			.mockResolvedValueOnce({ title: 'Spirited Away', ids: { trakt: 97 } })
			.mockResolvedValueOnce({ error: 'not found' });

		expect(await service.getTraktSummary('movies', 'tt0245429')).toEqual(
			expect.objectContaining({ title: 'Spirited Away' })
		);
		const [url, key, , config, maxAge] = spy.mock.calls[0];
		expect(url).toBe('https://api.trakt.tv/movies/tt0245429?extended=full');
		expect(key).toBe('trakt_summary_movies_tt0245429');
		expect(config?.validateStatus?.(404)).toBe(true);
		expect((maxAge as (row: unknown) => number)({ released: '2001-07-20', year: 2001 })).toBe(
			30 * day
		);

		expect(await service.getTraktSummary('shows', 'tt0000001')).toBeNull();
	});

	it('caches a TMDB movie separately for each appended response', async () => {
		process.env.TMDB_KEY = 'tmdb';
		const service = new MetadataCacheService();
		const spy = vi.spyOn(service, 'fetchWithCache').mockResolvedValue({});
		await service.getTmdbMovieInfo(129, 'videos,release_dates');
		expect(spy.mock.calls[0][0]).toContain('append_to_response=videos%2Crelease_dates');
		expect(spy.mock.calls[0][1]).toBe('tmdb_movie_129_videos,release_dates');
	});
});
