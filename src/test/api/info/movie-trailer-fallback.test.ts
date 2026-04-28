import handler from '@/pages/api/info/movie';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/mdblistClient');
vi.mock('@/services/metadataCache');
vi.mock('axios');

describe('/api/info/movie - trailer fallback sources', () => {
	it('should use Cinemeta trailer when MDBList has no trailer', async () => {
		const { getMdblistClient } = await import('@/services/mdblistClient');
		const { getMetadataCache } = await import('@/services/metadataCache');

		const mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({
				title: 'Test Movie',
				description: 'Test description',
				ratings: [],
			}),
		};

		const mockMetadataCache = {
			getCinemetaMovie: vi.fn().mockResolvedValue({
				meta: {
					name: 'Test Movie',
					trailers: [
						{ source: 'CINEMETA123', type: 'Trailer' },
						{ source: 'CINEMETA456', type: 'Teaser' },
					],
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
				trailer: 'https://youtube.com/watch?v=CINEMETA123',
			})
		);
	});

	it('should use TMDB trailer when MDBList and Cinemeta have no trailers', async () => {
		const { getMdblistClient } = await import('@/services/mdblistClient');
		const { getMetadataCache } = await import('@/services/metadataCache');

		const mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({
				title: 'Test Movie',
				description: 'Test description',
				tmdbid: 278,
				ratings: [],
			}),
		};

		const mockMetadataCache = {
			getCinemetaMovie: vi.fn().mockResolvedValue({
				meta: {
					name: 'Test Movie',
				},
			}),
		};

		(axios.get as any).mockResolvedValue({
			data: {
				results: [
					{ type: 'Trailer', site: 'YouTube', key: 'TMDB789' },
					{ type: 'Teaser', site: 'YouTube', key: 'TMDB012' },
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
				trailer: 'https://youtube.com/watch?v=TMDB789',
			})
		);
	});

	it('should prioritize MDBList over other sources', async () => {
		const { getMdblistClient } = await import('@/services/mdblistClient');
		const { getMetadataCache } = await import('@/services/metadataCache');

		const mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({
				title: 'Test Movie',
				description: 'Test description',
				trailer: 'https://youtube.com/watch?v=MDB111',
				tmdbid: 278,
				ratings: [],
			}),
		};

		const mockMetadataCache = {
			getCinemetaMovie: vi.fn().mockResolvedValue({
				meta: {
					name: 'Test Movie',
					trailers: [{ source: 'CINEMETA123', type: 'Trailer' }],
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
				trailer: 'https://youtube.com/watch?v=MDB111',
			})
		);
	});
});
