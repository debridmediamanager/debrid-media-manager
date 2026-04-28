import handler from '@/pages/api/info/show';
import { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/mdblistClient');
vi.mock('@/services/metadataCache');

describe('/api/info/show - trailer field', () => {
	it('should return trailer field from mdbResponse', async () => {
		const { getMdblistClient } = await import('@/services/mdblistClient');
		const { getMetadataCache } = await import('@/services/metadataCache');

		const mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({
				title: 'Test Show',
				description: 'Test description',
				poster: 'https://example.com/poster.jpg',
				backdrop: 'https://example.com/backdrop.jpg',
				trailer: 'https://youtube.com/watch?v=SHOW123',
				seasons: [
					{ season_number: 1, name: 'Season 1', episode_count: 10 },
					{ season_number: 2, name: 'Season 2', episode_count: 12 },
				],
				ratings: [{ source: 'imdb', score: 90 }],
			}),
		};

		const mockMetadataCache = {
			getCinemetaSeries: vi.fn().mockResolvedValue({
				meta: {
					name: 'Test Show',
					description: 'Test description',
					poster: 'https://example.com/poster.jpg',
					background: 'https://example.com/backdrop.jpg',
					imdbRating: '9.0',
					videos: [
						{ season: 1, episode: 1 },
						{ season: 1, episode: 2 },
						{ season: 2, episode: 1 },
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
				title: 'Test Show',
				trailer: 'https://youtube.com/watch?v=SHOW123',
			})
		);
	});

	it('should return empty string for trailer if not available', async () => {
		const { getMdblistClient } = await import('@/services/mdblistClient');
		const { getMetadataCache } = await import('@/services/metadataCache');

		const mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({
				title: 'Test Show',
				description: 'Test description',
				seasons: [],
				ratings: [],
			}),
		};

		const mockMetadataCache = {
			getCinemetaSeries: vi.fn().mockResolvedValue({
				meta: {
					name: 'Test Show',
					videos: [],
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
