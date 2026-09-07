import { createMockRequest, createMockResponse } from '@/test/utils/api';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');

const mockUserAgentString = 'TestAgent/1.0';
const mockUserAgent = vi.fn().mockImplementation(() => ({
	toString: () => mockUserAgentString,
}));

vi.mock('user-agents', () => ({
	default: mockUserAgent,
}));

const mockFetchKitsuAnime = vi.fn();
vi.mock('@/services/anime/kitsu', () => ({
	fetchKitsuAnime: (...args: unknown[]) => mockFetchKitsuAnime(...args),
}));

const mockGetImdbIdByKitsuId = vi.fn();
vi.mock('@/services/repository', () => ({
	repository: {
		getImdbIdByKitsuId: (...args: unknown[]) => mockGetImdbIdByKitsuId(...args),
	},
}));

const mockedAxios = vi.mocked(axios, true);

describe('/api/info/anime', () => {
	const loadHandler = async () => {
		const mod = await import('@/pages/api/info/anime');
		return mod.default;
	};

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockFetchKitsuAnime.mockResolvedValue(null);
		mockGetImdbIdByKitsuId.mockResolvedValue(null);
	});

	it('rejects non-GET methods', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
		expect(mockedAxios.get).not.toHaveBeenCalled();
	});

	it('requires animeid parameter', async () => {
		const handler = await loadHandler();
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Anime ID is required' });
	});

	it('fetches anime metadata and returns mapped response', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockResolvedValue({
			data: {
				meta: {
					name: 'Anime Name',
					description: 'Desc',
					poster: 'poster.png',
					background: 'bg.png',
					imdb_id: 'tt123',
					imdbRating: '8.5',
				},
			},
		});

		await handler(req, res);

		expect(mockedAxios.get).toHaveBeenCalledWith(
			'https://anime-kitsu.strem.fun/meta/series/kitsu%3A123.json',
			expect.objectContaining({
				headers: expect.objectContaining({
					'user-agent': mockUserAgentString,
					accept: expect.any(String),
				}),
			})
		);
		expect(mockUserAgent).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			title: 'Anime Name',
			description: 'Desc',
			poster: 'poster.png',
			backdrop: 'bg.png',
			imdbid: 'tt123',
			imdbRating: 8.5,
		});
	});

	it('falls back to defaults when every upstream fails', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockRejectedValue(new Error('down'));
		mockFetchKitsuAnime.mockResolvedValue(null);

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			title: 'Unknown',
			description: 'Unknown',
			poster: 'https://picsum.photos/200/300',
			backdrop: '',
			imdbid: '',
			imdbRating: 0,
		});
	});

	it('serves Kitsu metadata when the addon is down', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockRejectedValue(new Error('down'));
		mockFetchKitsuAnime.mockResolvedValue({
			title: 'Cowboy Bebop',
			description: 'In the year 2071...',
			poster: 'o.jpg',
			backdrop: 'co.jpg',
			rating: 8.2,
		});
		mockGetImdbIdByKitsuId.mockResolvedValue('tt0213338');

		await handler(req, res);

		expect(mockFetchKitsuAnime).toHaveBeenCalledWith(123);
		expect(mockGetImdbIdByKitsuId).toHaveBeenCalledWith(123);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			title: 'Cowboy Bebop',
			description: 'In the year 2071...',
			poster: 'o.jpg',
			backdrop: 'co.jpg',
			imdbid: 'tt0213338',
			imdbRating: 8.2,
		});
	});

	it('falls back when the addon answers without a title', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockResolvedValue({ data: { meta: { description: 'orphan' } } });
		mockFetchKitsuAnime.mockResolvedValue({
			title: 'From Kitsu',
			description: '',
			poster: '',
			backdrop: '',
			rating: 0,
		});

		await handler(req, res);

		expect(mockFetchKitsuAnime).toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: 'From Kitsu' }));
	});

	it('still serves Kitsu metadata when the imdb lookup fails', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockRejectedValue(new Error('down'));
		mockFetchKitsuAnime.mockResolvedValue({
			title: 'Cowboy Bebop',
			description: '',
			poster: '',
			backdrop: '',
			rating: 8.2,
		});
		mockGetImdbIdByKitsuId.mockRejectedValue(new Error('no database'));

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Cowboy Bebop', imdbid: '' })
		);
	});

	it('does not attempt the Kitsu fallback for a non-Kitsu id', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'mal-99' } });
		const res = createMockResponse();
		mockedAxios.get.mockRejectedValue(new Error('down'));

		await handler(req, res);

		expect(mockFetchKitsuAnime).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: 'Unknown' }));
	});
});
