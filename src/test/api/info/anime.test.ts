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

const mockResolveImdbIdFromSimkl = vi.fn();
vi.mock('@/services/anime/simkl', () => ({
	resolveImdbIdFromSimkl: (...args: unknown[]) => mockResolveImdbIdFromSimkl(...args),
}));

const mockGetFranchiseIndex = vi.fn();
vi.mock('@/services/anime/animeFranchise', () => ({
	getFranchiseIndex: (...args: unknown[]) => mockGetFranchiseIndex(...args),
}));

const mockGetAnimeByExternalId = vi.fn();
vi.mock('@/services/repository', () => ({
	repository: {
		getAnimeByExternalId: (...args: unknown[]) => mockGetAnimeByExternalId(...args),
	},
}));

/** The row for kitsu 123, carrying only the imdb id these cases vary. */
const rowWithImdb = (imdb_id: string | null) => ({
	anidb_id: null,
	kitsu_id: 123,
	mal_id: null,
	imdb_id,
	title: 'Row title',
	description: '',
	poster_url: '',
	background_url: '',
	rating: 0,
});

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
		mockGetAnimeByExternalId.mockResolvedValue(null);
		mockResolveImdbIdFromSimkl.mockResolvedValue(null);
		mockGetFranchiseIndex.mockResolvedValue(null);
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
			type: '',
			episodeCount: 0,
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
			type: '',
			episodeCount: 0,
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
			type: 'TV',
			episodeCount: 26,
		});
		mockGetAnimeByExternalId.mockResolvedValue(rowWithImdb('tt0213338'));

		await handler(req, res);

		expect(mockFetchKitsuAnime).toHaveBeenCalledWith(123);
		expect(mockGetAnimeByExternalId).toHaveBeenCalledWith('kitsu', 123);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			title: 'Cowboy Bebop',
			description: 'In the year 2071...',
			poster: 'o.jpg',
			backdrop: 'co.jpg',
			imdbid: 'tt0213338',
			imdbRating: 8.2,
			type: 'TV',
			episodeCount: 26,
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
		mockGetAnimeByExternalId.mockRejectedValue(new Error('no database'));

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Cowboy Bebop', imdbid: '' })
		);
	});

	it('asks Simkl for an imdb id the addon and database both lack', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockResolvedValue({
			data: { meta: { name: 'Cowboy Bebop', imdbRating: '8.9' } },
		});
		mockGetAnimeByExternalId.mockResolvedValue(rowWithImdb(null));
		mockResolveImdbIdFromSimkl.mockResolvedValue('tt0213338');

		await handler(req, res);

		expect(mockResolveImdbIdFromSimkl).toHaveBeenCalledWith('kitsu', 123);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Cowboy Bebop', imdbid: 'tt0213338' })
		);
	});

	it('prefers the database over Simkl and skips the extra call', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockResolvedValue({ data: { meta: { name: 'Cowboy Bebop' } } });
		mockGetAnimeByExternalId.mockResolvedValue(rowWithImdb('tt0213338'));

		await handler(req, res);

		expect(mockResolveImdbIdFromSimkl).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ imdbid: 'tt0213338' }));
	});

	it('never overrides an imdb id the addon already supplied', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockResolvedValue({
			data: { meta: { name: 'Cowboy Bebop', imdb_id: 'tt_from_addon' } },
		});
		mockGetAnimeByExternalId.mockResolvedValue(rowWithImdb('tt_from_row'));

		await handler(req, res);

		expect(mockResolveImdbIdFromSimkl).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ imdbid: 'tt_from_addon' }));
	});

	it('still asks Simkl when the database lookup throws', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockResolvedValue({ data: { meta: { name: 'Cowboy Bebop' } } });
		mockGetAnimeByExternalId.mockRejectedValue(new Error('no database'));
		mockResolveImdbIdFromSimkl.mockResolvedValue('tt0213338');

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ imdbid: 'tt0213338' }));
	});

	it('leaves the imdb id empty when nothing can resolve it', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'kitsu-123' } });
		const res = createMockResponse();
		mockedAxios.get.mockResolvedValue({ data: { meta: { name: 'Cowboy Bebop' } } });

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ imdbid: '' }));
	});

	it('asks no upstream for a mal id the table does not hold', async () => {
		const handler = await loadHandler();
		const req = createMockRequest({ query: { animeid: 'mal-99' } });
		const res = createMockResponse();
		mockedAxios.get.mockRejectedValue(new Error('down'));

		await handler(req, res);

		expect(mockGetAnimeByExternalId).toHaveBeenCalledWith('mal', 99);
		expect(mockedAxios.get).not.toHaveBeenCalled();
		expect(mockFetchKitsuAnime).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: 'Unknown' }));
	});
});
