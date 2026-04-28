import handler from '@/pages/api/info/movie';
import { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/mdblistClient');
vi.mock('@/services/metadataCache');

describe('/api/info/movie - trailer field', () => {
	it('should return trailer field from mdbResponse', async () => {
		const { getMdblistClient } = await import('@/services/mdblistClient');
		const { getMetadataCache } = await import('@/services/metadataCache');

		const mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({
				title: 'Test Movie',
				description: 'Test description',
				poster: 'https://example.com/poster.jpg',
				backdrop: 'https://example.com/backdrop.jpg',
				year: 2024,
				trailer: 'https://youtube.com/watch?v=TEST123',
				ratings: [{ source: 'imdb', score: 85 }],
			}),
		};

		const mockMetadataCache = {
			getCinemetaMovie: vi.fn().mockResolvedValue({
				meta: {
					name: 'Test Movie',
					description: 'Test description',
					poster: 'https://example.com/poster.jpg',
					background: 'https://example.com/backdrop.jpg',
					releaseInfo: '2024',
					imdbRating: '8.5',
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
				title: 'Test Movie',
				trailer: 'https://youtube.com/watch?v=TEST123',
			})
		);
	});

	it('should return empty string for trailer if not available', async () => {
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
				trailer: '',
			})
		);
	});
});
