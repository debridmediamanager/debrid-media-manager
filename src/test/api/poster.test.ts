import handler from '@/pages/api/poster';
import { getMdblistCacheService } from '@/services/database/mdblistCache';
import { getMdblistClient } from '@/services/mdblistClient';
import { getMetadataCache } from '@/services/metadataCache';
import { createMockRequest } from '@/test/utils/api';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('@/services/mdblistClient');
vi.mock('@/services/database/mdblistCache');
vi.mock('@/services/metadataCache');

const mockedAxios = vi.mocked(axios, true);
const mockedGetMdblistClient = vi.mocked(getMdblistClient);
const mockedGetMdblistCacheService = vi.mocked(getMdblistCacheService);
const mockedGetMetadataCache = vi.mocked(getMetadataCache);

describe('/api/poster', () => {
	let mockReq: any;
	let mockRes: any;
	let mockMdblistClient: { getInfoByImdbId: ReturnType<typeof vi.fn> };
	let mockCache: {
		getWithMetadata: ReturnType<typeof vi.fn>;
		set: ReturnType<typeof vi.fn>;
	};
	let mockMetadataCache: { getOmdbInfo: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.clearAllMocks();

		mockReq = createMockRequest();
		mockRes = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn().mockReturnThis(),
			setHeader: vi.fn().mockReturnThis(),
			send: vi.fn().mockReturnThis(),
			_getStatusCode: () => 200,
			_getData: () => ({}),
			_getHeaders: () => ({}),
			_setStatusCode: vi.fn(),
		} as any;

		// Mock mdblist client (fallback when TMDB has no poster)
		mockMdblistClient = {
			getInfoByImdbId: vi.fn().mockResolvedValue({ poster: null }),
		};
		mockedGetMdblistClient.mockReturnValue(mockMdblistClient as any);

		// Cache miss by default, so the existing cases exercise the live chain.
		mockCache = {
			getWithMetadata: vi.fn().mockResolvedValue(null),
			set: vi.fn().mockResolvedValue(undefined),
		};
		mockedGetMdblistCacheService.mockReturnValue(mockCache as any);

		// OMDb has nothing by default (fallback between TMDB and MDBList).
		mockMetadataCache = { getOmdbInfo: vi.fn().mockResolvedValue(null) };
		mockedGetMetadataCache.mockReturnValue(mockMetadataCache as any);
	});

	it('should return 400 when imdbid is missing', async () => {
		mockReq.method = 'GET';
		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(400);
		expect(mockRes.json).toHaveBeenCalledWith({ error: 'IMDB ID is required' });
	});

	it('should return 400 when imdbid is not a string', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: ['tt1234567'] };
		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(400);
		expect(mockRes.json).toHaveBeenCalledWith({ error: 'IMDB ID is required' });
	});

	it('should return poster URL from TMDB when found', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		const mockTmdbResponse = {
			data: {
				movie_results: [{ poster_path: '/poster123.jpg' }],
				tv_results: [],
			},
		};
		mockedAxios.get.mockResolvedValue(mockTmdbResponse);

		await handler(mockReq, mockRes);

		expect(mockRes.json).toHaveBeenCalledWith({
			url: 'https://image.tmdb.org/t/p/w500/poster123.jpg',
		});
	});

	it('should return poster URL from TV results when movie not found', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		const mockTmdbResponse = {
			data: {
				movie_results: [],
				tv_results: [{ poster_path: '/tvposter123.jpg' }],
			},
		};
		mockedAxios.get.mockResolvedValue(mockTmdbResponse);

		await handler(mockReq, mockRes);

		expect(mockRes.json).toHaveBeenCalledWith({
			url: 'https://image.tmdb.org/t/p/w500/tvposter123.jpg',
		});
	});

	it('should return 404 when no poster found', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		const mockTmdbResponse = {
			data: {
				movie_results: [],
				tv_results: [],
			},
		};
		mockedAxios.get.mockResolvedValue(mockTmdbResponse);

		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(404);
		expect(mockRes.json).toHaveBeenCalledWith({ error: 'Poster not found' });
	});

	it('should return 404 when TMDB API throws error', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		mockedAxios.get.mockRejectedValue(new Error('API Error'));

		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(404);
		expect(mockRes.json).toHaveBeenCalledWith({ error: 'Poster not found' });
	});

	it('should return poster URL from Fanart.tv when FANART_KEY is set', async () => {
		process.env.FANART_KEY = 'test-fanart-key';
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		mockedAxios.get.mockResolvedValueOnce({
			data: {
				movieposter: [
					{
						id: '1',
						url: 'https://assets.fanart.tv/fanart/movie-poster.jpg',
						lang: 'en',
						likes: '5',
					},
					{
						id: '2',
						url: 'https://assets.fanart.tv/fanart/movie-poster2.jpg',
						lang: 'de',
						likes: '10',
					},
				],
			},
		});

		await handler(mockReq, mockRes);

		expect(mockRes.json).toHaveBeenCalledWith({
			url: 'https://assets.fanart.tv/fanart/movie-poster.jpg',
		});
		expect(mockedAxios.get).toHaveBeenCalledWith(
			expect.stringContaining('webservice.fanart.tv/v3/movies/tt1234567')
		);
		delete process.env.FANART_KEY;
	});

	it('should fall through to TMDB when Fanart.tv has no posters', async () => {
		process.env.FANART_KEY = 'test-fanart-key';
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		// Fanart.tv returns empty
		mockedAxios.get.mockResolvedValueOnce({ data: {} });
		// TMDB returns poster
		mockedAxios.get.mockResolvedValueOnce({
			data: {
				movie_results: [{ poster_path: '/tmdb-poster.jpg' }],
				tv_results: [],
			},
		});

		await handler(mockReq, mockRes);

		expect(mockRes.json).toHaveBeenCalledWith({
			url: 'https://image.tmdb.org/t/p/w500/tmdb-poster.jpg',
		});
		delete process.env.FANART_KEY;
	});

	it('should handle different HTTP methods', async () => {
		const methods = ['GET', 'POST', 'PUT', 'DELETE'];

		for (const method of methods) {
			vi.clearAllMocks();
			mockReq.method = method;
			mockReq.query = { imdbid: 'tt1234567' };

			const mockTmdbResponse = {
				data: {
					movie_results: [{ poster_path: '/poster123.jpg' }],
					tv_results: [],
				},
			};
			mockedAxios.get.mockResolvedValue(mockTmdbResponse);

			await handler(mockReq, mockRes);

			expect(mockRes.json).toHaveBeenCalledWith({
				url: 'https://image.tmdb.org/t/p/w500/poster123.jpg',
			});
		}
	});

	it('falls back to OMDb when Fanart and TMDB have no poster', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt3896198' };

		mockedAxios.get.mockResolvedValue({
			data: { movie_results: [], tv_results: [] },
		});
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'True',
			Poster: 'https://m.media-amazon.com/images/M/guardians.jpg',
		});

		await handler(mockReq, mockRes);

		expect(mockRes.json).toHaveBeenCalledWith({
			url: 'https://m.media-amazon.com/images/M/guardians.jpg',
		});
	});

	it('falls through to MDBList when OMDb reports "N/A" for the poster', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt0000001' };

		mockedAxios.get.mockResolvedValue({
			data: { movie_results: [], tv_results: [] },
		});
		mockMetadataCache.getOmdbInfo.mockResolvedValue({ Response: 'True', Poster: 'N/A' });
		mockMdblistClient.getInfoByImdbId.mockResolvedValue({
			poster: 'https://mdblist.example/poster.jpg',
		});

		await handler(mockReq, mockRes);

		expect(mockRes.json).toHaveBeenCalledWith({
			url: 'https://mdblist.example/poster.jpg',
		});
	});

	it('caches the resolved poster URL', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		mockedAxios.get.mockResolvedValue({
			data: { movie_results: [{ poster_path: '/poster123.jpg' }], tv_results: [] },
		});

		await handler(mockReq, mockRes);

		expect(mockCache.set).toHaveBeenCalledWith('poster_tt1234567', 'poster', {
			url: 'https://image.tmdb.org/t/p/w500/poster123.jpg',
		});
	});

	it('serves a cached poster without querying any source', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		mockCache.getWithMetadata.mockResolvedValue({
			data: { url: 'https://cached.example/poster.jpg' },
			updatedAt: new Date(),
		});

		await handler(mockReq, mockRes);

		expect(mockRes.json).toHaveBeenCalledWith({ url: 'https://cached.example/poster.jpg' });
		expect(mockedAxios.get).not.toHaveBeenCalled();
		expect(mockMdblistClient.getInfoByImdbId).not.toHaveBeenCalled();
	});

	it('caches a miss too, so an artless title stops re-querying every source', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		mockedAxios.get.mockResolvedValue({
			data: { movie_results: [], tv_results: [] },
		});

		await handler(mockReq, mockRes);

		expect(mockCache.set).toHaveBeenCalledWith('poster_tt1234567', 'poster', { url: null });
		expect(mockRes.status).toHaveBeenCalledWith(404);
	});

	it('retries a cached miss the next day rather than holding it for a month', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		// A miss recorded two days ago: past the 24h negative TTL, well inside the
		// 30-day positive one.
		mockCache.getWithMetadata.mockResolvedValue({
			data: { url: null },
			updatedAt: new Date(Date.now() - 2 * 86400000),
		});
		mockedAxios.get.mockResolvedValue({
			data: { movie_results: [{ poster_path: '/fresh.jpg' }], tv_results: [] },
		});

		await handler(mockReq, mockRes);

		expect(mockRes.json).toHaveBeenCalledWith({
			url: 'https://image.tmdb.org/t/p/w500/fresh.jpg',
		});
	});

	it('does not cache a miss when a source threw', async () => {
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		mockedAxios.get.mockRejectedValue(new Error('TMDB down'));

		await handler(mockReq, mockRes);

		expect(mockRes.status).toHaveBeenCalledWith(404);
		expect(mockCache.set).not.toHaveBeenCalled();
	});

	it('still answers when the cache is unreachable', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockReq.method = 'GET';
		mockReq.query = { imdbid: 'tt1234567' };

		mockCache.getWithMetadata.mockRejectedValue(new Error('db down'));
		mockedAxios.get.mockResolvedValue({
			data: { movie_results: [{ poster_path: '/poster123.jpg' }], tv_results: [] },
		});

		await handler(mockReq, mockRes);

		expect(mockRes.json).toHaveBeenCalledWith({
			url: 'https://image.tmdb.org/t/p/w500/poster123.jpg',
		});
		errorSpy.mockRestore();
	});
});
