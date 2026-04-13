import handler from '@/pages/api/info/show';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import { vi } from 'vitest';

vi.mock('@/services/mdblistClient');
vi.mock('@/services/metadataCache');
vi.mock('axios');

describe('/api/info/show - trailer fallback sources', () => {
	it('should use Cinemeta trailer when MDBList has no trailer', async () => {
		const { getMdblistClient } = await import('@/services/mdblistClient');
		const { getMetadataCache } = await import('@/services/metadataCache');

		const mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({
				title: 'Test Show',
				description: 'Test description',
				seasons: [{ season_number: 1, name: 'Season 1', episode_count: 10 }],
				ratings: [],
			}),
		};

		const mockMetadataCache = {
			getCinemetaSeries: vi.fn().mockResolvedValue({
				meta: {
					name: 'Test Show',
					trailers: [
						{ source: 'CINEMETA_SHOW123', type: 'Trailer' },
						{ source: 'CINEMETA_SHOW456', type: 'Teaser' },
					],
					videos: [{ season: 1, episode: 1 }],
				},
			}),
		};

		vi.mocked(getMdblistClient).mockReturnValue(mockMdblistClient as any);
		vi.mocked(getMetadataCache).mockReturnValue(mockMetadataCache as any);

		const req = {
			method: 'GET',
			query: { imdbid: 'tt1234567' },
		} as unknown as NextApiRequest;

		const res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn(),
		} as unknown as NextApiResponse;

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				trailer: 'https://youtube.com/watch?v=CINEMETA_SHOW123',
			})
		);
	});

	it('should use TMDB trailer when MDBList and Cinemeta have no trailers', async () => {
		const { getMdblistClient } = await import('@/services/mdblistClient');
		const { getMetadataCache } = await import('@/services/metadataCache');

		const mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({
				title: 'Test Show',
				description: 'Test description',
				tmdbid: 1396,
				seasons: [{ season_number: 1, name: 'Season 1', episode_count: 10 }],
				ratings: [],
			}),
		};

		const mockMetadataCache = {
			getCinemetaSeries: vi.fn().mockResolvedValue({
				meta: {
					name: 'Test Show',
					videos: [{ season: 1, episode: 1 }],
				},
			}),
		};

		(axios.get as any).mockResolvedValue({
			data: {
				results: [
					{ type: 'Trailer', site: 'YouTube', key: 'TMDB_SHOW789' },
					{ type: 'Teaser', site: 'YouTube', key: 'TMDB_SHOW012' },
				],
			},
		});

		vi.mocked(getMdblistClient).mockReturnValue(mockMdblistClient as any);
		vi.mocked(getMetadataCache).mockReturnValue(mockMetadataCache as any);

		const req = {
			method: 'GET',
			query: { imdbid: 'tt1234567' },
		} as unknown as NextApiRequest;

		const res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn(),
		} as unknown as NextApiResponse;

		const previousTmdbKey = process.env.TMDB_KEY;
		try {
			process.env.TMDB_KEY = 'test-key';
			await handler(req, res);
		} finally {
			if (previousTmdbKey === undefined) {
				delete process.env.TMDB_KEY;
			} else {
				process.env.TMDB_KEY = previousTmdbKey;
			}
		}

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				trailer: 'https://youtube.com/watch?v=TMDB_SHOW789',
			})
		);
	});

	it('should prioritize MDBList over other sources', async () => {
		const { getMdblistClient } = await import('@/services/mdblistClient');
		const { getMetadataCache } = await import('@/services/metadataCache');

		const mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({
				title: 'Test Show',
				description: 'Test description',
				trailer: 'https://youtube.com/watch?v=MDB_SHOW111',
				tmdbid: 1396,
				seasons: [{ season_number: 1, name: 'Season 1', episode_count: 10 }],
				ratings: [],
			}),
		};

		const mockMetadataCache = {
			getCinemetaSeries: vi.fn().mockResolvedValue({
				meta: {
					name: 'Test Show',
					trailers: [{ source: 'CINEMETA_SHOW123', type: 'Trailer' }],
					videos: [{ season: 1, episode: 1 }],
				},
			}),
		};

		vi.mocked(getMdblistClient).mockReturnValue(mockMdblistClient as any);
		vi.mocked(getMetadataCache).mockReturnValue(mockMetadataCache as any);

		const req = {
			method: 'GET',
			query: { imdbid: 'tt1234567' },
		} as unknown as NextApiRequest;

		const res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn(),
		} as unknown as NextApiResponse;

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				trailer: 'https://youtube.com/watch?v=MDB_SHOW111',
			})
		);
	});
});
