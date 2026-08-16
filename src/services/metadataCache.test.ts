import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
		expect(axiosMocks.get).toHaveBeenCalledWith('url', { headers: {} });
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
		expect(movieCall).toEqual([
			'https://v3-cinemeta.strem.io/meta/movie/tt123.json',
			'cinemeta_movie_tt123',
			'cinemeta_movie',
			undefined,
			2592000000, // 30 days — never cache a movie permanently, see MOVIE duration
		]);
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
		expect(tmdbMovieCall[4]).toBe(2592000000);
		expect(tmdbTvCall[2]).toBe('tmdb_tv');
		expect(tmdbTvCall[4]).toBe(604800000);

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
