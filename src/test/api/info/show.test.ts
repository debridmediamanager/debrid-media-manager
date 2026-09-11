import handler from '@/pages/api/info/show';
import wednesdayCinemeta from '@/test/fixtures/metadata/cinemeta-tt13443470-wednesday.json';
import wednesdayMdblist from '@/test/fixtures/metadata/mdblist-tt13443470-wednesday.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/mdblistClient', () => ({
	getMdblistClient: vi.fn(),
}));

vi.mock('@/services/metadataCache', () => ({
	getMetadataCache: vi.fn(),
}));

vi.mock('user-agents', () => ({
	default: vi.fn().mockImplementation(() => ({
		toString: () => 'test-agent',
	})),
}));

import { getMdblistClient } from '@/services/mdblistClient';
import { getMetadataCache } from '@/services/metadataCache';

describe('/api/info/show', () => {
	const mockMdbClient = {
		getInfoByImdbId: vi.fn(),
	};
	const mockMetadataCache = {
		getCinemetaSeries: vi.fn(),
		getTraktShowEpisode: vi.fn().mockResolvedValue(null),
		getOmdbInfo: vi.fn().mockResolvedValue(null),
	};

	const tmdbEnv = { key: process.env.TMDB_KEY, token: process.env.TMDB_READ_TOKEN };

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getMdblistClient).mockReturnValue(mockMdbClient as any);
		vi.mocked(getMetadataCache).mockReturnValue(mockMetadataCache as any);
		mockMetadataCache.getTraktShowEpisode.mockResolvedValue(null);
		// Fixtures carry a real tmdbid; without a credential the route skips the
		// TMDB status/trailer call rather than reaching the network.
		delete process.env.TMDB_KEY;
		delete process.env.TMDB_READ_TOKEN;
	});

	afterEach(() => {
		if (tmdbEnv.key === undefined) delete process.env.TMDB_KEY;
		else process.env.TMDB_KEY = tmdbEnv.key;
		if (tmdbEnv.token === undefined) delete process.env.TMDB_READ_TOKEN;
		else process.env.TMDB_READ_TOKEN = tmdbEnv.token;
	});

	it('requires an IMDb id', async () => {
		const req = createMockRequest();
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'IMDB ID is required' });
	});

	it('merges season metadata from both sources', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({
			title: 'MDB Show',
			description: 'MDB Desc',
			poster: 'mdb-poster',
			backdrop: 'mdb-backdrop',
			ratings: [{ source: 'imdb', score: 8.5 }],
			seasons: [
				{ season_number: 1, name: 'Season 1', episode_count: 8 },
				{ season_number: 2, name: 'Season 2', episode_count: 10 },
			],
		});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({
			meta: {
				name: 'Cine Show',
				description: 'Cine Desc',
				poster: 'cine-poster',
				background: 'cine-bg',
				imdbRating: 9.1,
				videos: [{ season: 1 }, { season: 1 }, { season: 3 }, { season: 3 }, { season: 3 }],
			},
			meta_videos: [],
		});

		const req = createMockRequest({
			query: { imdbid: 'ttshow123' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockMdbClient.getInfoByImdbId).toHaveBeenCalledWith('ttshow123');
		expect(mockMetadataCache.getCinemetaSeries).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			title: 'MDB Show',
			description: 'MDB Desc',
			poster: 'mdb-poster',
			backdrop: 'mdb-backdrop',
			season_count: 3,
			season_names: ['Season 1', 'Season 2', 'Season 3'],
			has_specials: false,
			imdb_score: 9.1,
			season_episode_counts: {
				1: 8,
				2: 10,
				3: 3,
			},
			trailer: '',
			status: undefined,
			next_episode_to_air: undefined,
			last_episode_to_air: undefined,
		});
	});

	it('returns 500 when fetching fails', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockMdbClient.getInfoByImdbId.mockRejectedValue(new Error('fail'));
		const req = createMockRequest({
			query: { imdbid: 'ttbroken' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch show information' });
		consoleSpy.mockRestore();
	});

	it('uses higher season count from cinemeta when mdb has fewer seasons', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({
			title: 'New Show',
			description: 'A new show',
			poster: 'poster.jpg',
			backdrop: 'backdrop.jpg',
			ratings: [{ source: 'imdb', score: 7.5 }],
			seasons: [{ season_number: 1, name: 'Season 1', episode_count: 10 }],
		});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({
			meta: {
				name: 'New Show',
				description: 'A new show',
				poster: 'poster.jpg',
				background: 'background.jpg',
				imdbRating: 7.5,
				videos: [
					{ season: 1, episode: 1 },
					{ season: 1, episode: 2 },
					{ season: 2, episode: 1 },
					{ season: 2, episode: 2 },
				],
			},
		});

		const req = createMockRequest({
			query: { imdbid: 'tt31187479' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				season_count: 2,
				season_names: ['Season 1', 'Season 2'],
				season_episode_counts: {
					1: 10,
					2: 2,
				},
			})
		);
	});

	it('uses higher season count from mdb when cinemeta has fewer seasons', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({
			title: 'Established Show',
			description: 'An established show',
			poster: 'poster.jpg',
			backdrop: 'backdrop.jpg',
			ratings: [{ source: 'imdb', score: 8.0 }],
			seasons: [
				{ season_number: 1, name: 'Season 1', episode_count: 12 },
				{ season_number: 2, name: 'Season 2', episode_count: 12 },
				{ season_number: 3, name: 'Season 3', episode_count: 10 },
			],
		});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({
			meta: {
				name: 'Established Show',
				description: 'An established show',
				poster: 'poster.jpg',
				background: 'background.jpg',
				imdbRating: 8.0,
				videos: [
					{ season: 1, episode: 1 },
					{ season: 1, episode: 2 },
					{ season: 2, episode: 1 },
				],
			},
		});

		const req = createMockRequest({
			query: { imdbid: 'tt12345678' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				season_count: 3,
				season_names: ['Season 1', 'Season 2', 'Season 3'],
				season_episode_counts: {
					1: 12,
					2: 12,
					3: 10,
				},
			})
		);
	});

	it('falls back to OMDb when mdblist and cinemeta have nothing', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'True',
			Title: 'Breaking Bad',
			Plot: 'A chemistry teacher turns to manufacturing methamphetamine.',
			Poster: 'https://m.media-amazon.com/images/M/breakingbad.jpg',
			imdbRating: '9.5',
		});

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt0903747' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Breaking Bad',
				description: 'A chemistry teacher turns to manufacturing methamphetamine.',
				poster: 'https://m.media-amazon.com/images/M/breakingbad.jpg',
				// This route reports the rating on its native 0-10 scale, unlike
				// /api/info/movie which multiplies by 10.
				imdb_score: 9.5,
			})
		);
	});

	it('does not ask OMDb when mdblist and Cinemeta have already answered', async () => {
		// OMDb is the most rate-limited source DMM uses, and on a show the other
		// two know, every field it could fill is already filled.
		mockMdbClient.getInfoByImdbId.mockResolvedValue(wednesdayMdblist);
		mockMetadataCache.getCinemetaSeries.mockResolvedValue(wednesdayCinemeta);

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt13443470' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockMetadataCache.getOmdbInfo).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Wednesday', status: 'Returning Series' })
		);
	});

	it('never renders OMDb’s "N/A" filler as real metadata', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'True',
			Title: 'Some Obscure Show',
			Plot: 'N/A',
			Poster: 'N/A',
			imdbRating: 'N/A',
		});

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt0000002' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Some Obscure Show',
				description: 'n/a',
				poster: '',
				imdb_score: 0,
			})
		);
	});

	it('still answers when OMDb itself fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockMdbClient.getInfoByImdbId.mockResolvedValue({ title: 'MDB Show' });
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockRejectedValue(new Error('Invalid API key!'));

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt1234567' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: 'MDB Show' }));
		warn.mockRestore();
	});
});
