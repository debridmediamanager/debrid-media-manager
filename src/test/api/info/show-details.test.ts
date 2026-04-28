import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { traktClientId: 'test-trakt-id' } }),
}));

const mockedAxios = vi.mocked(axios, true);

import handler from '@/pages/api/info/show-details';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';

describe('/api/info/show-details', () => {
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

		const { default: freshHandler } = await import('@/pages/api/info/show-details');
		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt1234567' } });
		res = createMockResponse();
		await freshHandler(req, res);
		expect(res._getStatusCode()).toBe(500);

		vi.doUnmock('next/config');
		vi.mock('next/config', () => ({
			default: () => ({ publicRuntimeConfig: { traktClientId: 'test-trakt-id' } }),
		}));
	});

	it('returns 404 when show not found in TMDB', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockedAxios.get.mockResolvedValueOnce({
			data: { tv_results: [] },
		});

		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt0000000' } });
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(404);
		expect(res._getData()).toEqual({ message: 'Show not found.' });
	});

	it('returns enriched show details on success', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});

		mockedAxios.get.mockImplementation(async (url: string) => {
			if (url.includes('/find/')) {
				return { data: { tv_results: [{ id: 456 }] } };
			}
			if (url.includes('/tv/')) {
				return {
					data: {
						name: 'Test Show',
						overview: 'A test show',
						first_air_date: '2020-01-01',
						last_air_date: '2024-12-01',
						number_of_seasons: 5,
						number_of_episodes: 50,
						genres: [{ id: 1, name: 'Drama' }],
						vote_average: 8.5,
						vote_count: 2000,
						poster_path: '/show-poster.jpg',
						backdrop_path: '/show-backdrop.jpg',
						status: 'Ended',
						type: 'Scripted',
						created_by: [{ name: 'Creator One', id: 100 }],
						credits: {
							cast: [
								{
									name: 'Lead Actor',
									character: 'Main Role',
									profile_path: '/lead.jpg',
									id: 50,
								},
							],
							crew: [],
						},
					},
				};
			}
			if (url.includes('/search/person')) {
				return {
					data: [{ person: { ids: { tmdb: 50, slug: 'lead-actor' } } }],
				};
			}
			return { data: {} };
		});

		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt1234567' } });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.title).toBe('Test Show');
		expect(data.overview).toBe('A test show');
		expect(data.firstAirDate).toBe('2020-01-01');
		expect(data.lastAirDate).toBe('2024-12-01');
		expect(data.numberOfSeasons).toBe(5);
		expect(data.numberOfEpisodes).toBe(50);
		expect(data.status).toBe('Ended');
		expect(data.type).toBe('Scripted');
		expect(data.cast).toHaveLength(1);
		expect(data.cast[0].name).toBe('Lead Actor');
		expect(data.creators).toHaveLength(1);
		expect(data.creators[0].name).toBe('Creator One');
		expect(data.creators[0].job).toBe('Creator');
		expect(data.creators[0].department).toBe('Production');
	});

	it('handles Trakt slug lookup failures gracefully', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		mockedAxios.get.mockImplementation(async (url: string) => {
			if (url.includes('/find/')) {
				return { data: { tv_results: [{ id: 456 }] } };
			}
			if (url.includes('/tv/')) {
				return {
					data: {
						name: 'Test Show',
						overview: 'Overview',
						first_air_date: '2020-01-01',
						last_air_date: '2024-01-01',
						number_of_seasons: 1,
						number_of_episodes: 10,
						genres: [],
						vote_average: 7.0,
						vote_count: 100,
						poster_path: null,
						backdrop_path: null,
						status: 'Returning Series',
						type: 'Scripted',
						created_by: [{ name: 'Creator', id: 200 }],
						credits: {
							cast: [
								{ name: 'Actor', character: 'Role', profile_path: null, id: 10 },
							],
							crew: [],
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
		expect(data.creators[0].slug).toBeNull();
	});

	it('returns appropriate error status on axios errors', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});

		const axiosError = new Error('Request failed') as any;
		axiosError.isAxiosError = true;
		axiosError.response = { status: 503, data: 'Service Unavailable' };

		mockedAxios.get.mockRejectedValue(axiosError);
		mockedAxios.isAxiosError.mockReturnValue(true);

		const req = createMockRequest({ method: 'GET', query: { imdbId: 'tt1234567' } });
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(503);
		expect(res._getData()).toEqual({ message: 'Failed to fetch show details.' });
	});
});
