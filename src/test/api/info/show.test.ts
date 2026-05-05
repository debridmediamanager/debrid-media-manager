import handler from '@/pages/api/info/show';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getMdblistClient).mockReturnValue(mockMdbClient as any);
		vi.mocked(getMetadataCache).mockReturnValue(mockMetadataCache as any);
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
});
