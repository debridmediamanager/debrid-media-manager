import handler from '@/pages/api/related/[mediaType]';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { traktClientId: 'test-id' } }),
}));

const mockedAxios = vi.mocked(axios, true);

describe('/api/related/[mediaType]', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.TRAKT_CLIENT_ID = 'test-id';
		process.env.TMDB_KEY = 'test-tmdb-key';
		res = createMockResponse();
	});

	it('returns 405 for non-GET requests', async () => {
		const req = createMockRequest({ method: 'POST' });
		await handler(req, res);

		expect(res._getStatusCode()).toBe(405);
		expect(res._getHeaders()).toHaveProperty('Allow', 'GET');
		expect(res._getData()).toEqual({ message: 'Method Not Allowed' });
	});

	it('returns 400 for invalid mediaType', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: { mediaType: 'podcast', imdbId: 'tt1234567' },
		});
		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({
			message: 'Invalid mediaType. Expected "movie" or "show".',
		});
	});

	it('returns 400 when imdbId is missing', async () => {
		const req = createMockRequest({ method: 'GET', query: { mediaType: 'movie' } });
		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({ message: 'Missing imdbId query parameter.' });
	});

	it('returns 500 when TRAKT_CLIENT_ID is not configured', async () => {
		delete process.env.TRAKT_CLIENT_ID;
		vi.resetModules();
		vi.mock('next/config', () => ({
			default: () => ({ publicRuntimeConfig: {} }),
		}));
		const { default: freshHandler } = await import('@/pages/api/related/[mediaType]');
		const req = createMockRequest({
			method: 'GET',
			query: { mediaType: 'movie', imdbId: 'tt1234567' },
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await freshHandler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ message: 'Trakt configuration missing.' });
		consoleSpy.mockRestore();
	});

	it('returns results from Trakt source when available', async () => {
		const traktResults = [
			{ title: 'Similar Movie', year: 2020, ids: { imdb: 'tt9999999' } },
			{ title: 'Another Movie', year: 2019, ids: { imdb: 'tt8888888' } },
		];
		mockedAxios.get.mockResolvedValueOnce({ data: traktResults });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({
			method: 'GET',
			query: { mediaType: 'movie', imdbId: 'tt1234567' },
		});

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ results: traktResults, source: 'trakt' });
		expect(mockedAxios.get).toHaveBeenCalledWith(
			'https://api.trakt.tv/movies/tt1234567/related',
			expect.any(Object)
		);
		consoleSpy.mockRestore();
	});

	it('falls back to TMDB when Trakt returns empty results', async () => {
		mockedAxios.get.mockResolvedValueOnce({ data: [] });

		mockedAxios.get.mockResolvedValueOnce({
			data: { movie_results: [{ id: 550 }], tv_results: [] },
		});
		mockedAxios.get.mockResolvedValueOnce({
			data: { results: [{ id: 100, title: 'TMDB Movie', release_date: '2021-05-01' }] },
		});
		mockedAxios.get.mockResolvedValueOnce({
			data: { external_ids: { imdb_id: 'tt7777777' }, title: 'TMDB Movie' },
		});

		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const req = createMockRequest({
			method: 'GET',
			query: { mediaType: 'movie', imdbId: 'tt1234567' },
		});

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.source).toBe('tmdb');
		expect(data.results).toHaveLength(1);
		expect(data.results[0].ids.imdb).toBe('tt7777777');
		consoleSpy.mockRestore();
		consoleWarnSpy.mockRestore();
	});

	it('falls back to TMDB when Trakt errors', async () => {
		const axiosError: any = new Error('Server Error');
		axiosError.isAxiosError = true;
		axiosError.response = { status: 500, data: 'Internal Server Error' };
		mockedAxios.get.mockRejectedValueOnce(axiosError);
		mockedAxios.isAxiosError.mockReturnValue(true);

		mockedAxios.get.mockResolvedValueOnce({
			data: { movie_results: [{ id: 550 }], tv_results: [] },
		});
		mockedAxios.get.mockResolvedValueOnce({
			data: { results: [{ id: 200, title: 'Fallback Movie', release_date: '2022-01-01' }] },
		});
		mockedAxios.get.mockResolvedValueOnce({
			data: { external_ids: { imdb_id: 'tt6666666' }, title: 'Fallback Movie' },
		});

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({
			method: 'GET',
			query: { mediaType: 'movie', imdbId: 'tt1234567' },
		});

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.source).toBe('tmdb');
		expect(data.results[0].ids.imdb).toBe('tt6666666');
		consoleSpy.mockRestore();
		consoleInfoSpy.mockRestore();
	});

	it('returns empty results with none source when both fail', async () => {
		mockedAxios.get.mockResolvedValueOnce({ data: [] });

		mockedAxios.get.mockResolvedValueOnce({
			data: { movie_results: [], tv_results: [] },
		});

		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({
			method: 'GET',
			query: { mediaType: 'movie', imdbId: 'tt1234567' },
		});

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.results).toEqual([]);
		expect(data.source).toBe('none');
		expect(data.message).toBeDefined();
		consoleSpy.mockRestore();
		consoleInfoSpy.mockRestore();
	});

	it('handles show mediaType for Trakt endpoint', async () => {
		const traktResults = [{ title: 'Related Show', year: 2023, ids: { imdb: 'tt5555555' } }];
		mockedAxios.get.mockResolvedValueOnce({ data: traktResults });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({
			method: 'GET',
			query: { mediaType: 'show', imdbId: 'tt1234567' },
		});

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(mockedAxios.get).toHaveBeenCalledWith(
			'https://api.trakt.tv/shows/tt1234567/related',
			expect.any(Object)
		);
		consoleSpy.mockRestore();
	});
});
