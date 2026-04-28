import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { traktClientId: 'test-trakt-id' } }),
}));

const mockedAxios = vi.mocked(axios, true);

import handler from '@/pages/api/info/movie-details';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';

describe('/api/info/movie-details', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.TMDB_KEY = 'test-tmdb-key';
		process.env.TRAKT_CLIENT_ID = 'test-trakt-id';
	});

	afterEach(() => {
		delete process.env.TMDB_KEY;
		delete process.env.TRAKT_CLIENT_ID;
	});

	it('rejects non-GET with 405 and Allow header', async () => {
		const req = createMockRequest({ method: 'POST' });
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(405);
		expect(res._getHeaders()['Allow']).toBe('GET');
		expect(res._getData()).toEqual({ message: 'Method Not Allowed' });
	});

	it('returns 400 for missing imdbId', async () => {
		const req = createMockRequest({ method: 'GET', query: {} });
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({ message: 'Missing imdbId query parameter.' });
	});

	it('returns 500 when TMDB_KEY missing', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		delete process.env.TMDB_KEY;
		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt1234567' } });
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ message: 'TMDB configuration missing.' });
	});

	it('returns 500 when TRAKT_CLIENT_ID missing', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		delete process.env.TRAKT_CLIENT_ID;

		vi.doUnmock('next/config');
		vi.mock('next/config', () => ({
			default: () => ({ publicRuntimeConfig: {} }),
		}));

		const { default: freshHandler } = await import('@/pages/api/info/movie-details');
		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt1234567' } });
		res = createMockResponse();
		await freshHandler(req, res);
		expect(res._getStatusCode()).toBe(500);

		vi.doUnmock('next/config');
		vi.mock('next/config', () => ({
			default: () => ({ publicRuntimeConfig: { traktClientId: 'test-trakt-id' } }),
		}));
	});

	it('returns 404 when movie not found in TMDB', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockedAxios.get.mockResolvedValueOnce({
			data: { movie_results: [] },
		});

		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt0000000' } });
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(404);
		expect(res._getData()).toEqual({ message: 'Movie not found.' });
	});

	it('returns enriched movie details on success', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});

		mockedAxios.get.mockImplementation(async (url: string) => {
			if (url.includes('/find/')) {
				return { data: { movie_results: [{ id: 123 }] } };
			}
			if (url.includes('/movie/')) {
				return {
					data: {
						title: 'Test Movie',
						overview: 'A test movie',
						release_date: '2024-01-01',
						runtime: 120,
						genres: [{ id: 1, name: 'Action' }],
						vote_average: 8.0,
						vote_count: 1000,
						poster_path: '/poster.jpg',
						backdrop_path: '/backdrop.jpg',
						credits: {
							cast: [
								{
									name: 'Actor One',
									character: 'Hero',
									profile_path: '/actor1.jpg',
									id: 1,
								},
							],
							crew: [
								{
									name: 'Director One',
									job: 'Director',
									department: 'Directing',
									id: 2,
								},
							],
						},
					},
				};
			}
			if (url.includes('/search/person')) {
				return {
					data: [{ person: { ids: { tmdb: 1, slug: 'actor-one' } } }],
				};
			}
			return { data: {} };
		});

		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt1234567' } });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.title).toBe('Test Movie');
		expect(data.overview).toBe('A test movie');
		expect(data.releaseDate).toBe('2024-01-01');
		expect(data.runtime).toBe(120);
		expect(data.cast).toHaveLength(1);
		expect(data.cast[0].name).toBe('Actor One');
		expect(data.cast[0].slug).toBe('actor-one');
	});

	it('handles Trakt slug lookup failures gracefully', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		mockedAxios.get.mockImplementation(async (url: string) => {
			if (url.includes('/find/')) {
				return { data: { movie_results: [{ id: 123 }] } };
			}
			if (url.includes('/movie/')) {
				return {
					data: {
						title: 'Test Movie',
						overview: 'Overview',
						release_date: '2024-01-01',
						runtime: 90,
						genres: [],
						vote_average: 7.0,
						vote_count: 500,
						poster_path: null,
						backdrop_path: null,
						credits: {
							cast: [
								{ name: 'Actor', character: 'Role', profile_path: null, id: 10 },
							],
							crew: [
								{
									name: 'Director',
									job: 'Director',
									department: 'Directing',
									id: 20,
								},
							],
						},
					},
				};
			}
			if (url.includes('/search/person')) {
				throw new Error('Trakt API error');
			}
			return { data: {} };
		});

		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt1234567' } });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.cast[0].slug).toBeNull();
		expect(data.director.slug).toBeNull();
	});

	it('returns appropriate error status on axios errors', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});

		const axiosError = new Error('Request failed') as any;
		axiosError.isAxiosError = true;
		axiosError.response = { status: 429, data: 'Rate limited' };

		mockedAxios.get.mockRejectedValue(axiosError);
		mockedAxios.isAxiosError.mockReturnValue(true);

		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt1234567' } });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(429);
		expect(res._getData()).toEqual({ message: 'Failed to fetch movie details.' });
	});
});
