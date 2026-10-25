import handler from '@/pages/api/person/[personSlug]';
import lanaMovies from '@/test/fixtures/person/lana-wachowski-movies.json';
import lanaShows from '@/test/fixtures/person/lana-wachowski-shows.json';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { traktClientId: 'test-id' } }),
}));

const mockedAxios = vi.mocked(axios, true);

describe('/api/person/[personSlug]', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.TRAKT_CLIENT_ID = 'test-id';
		res = createMockResponse();
	});

	it('returns 405 for non-GET requests', async () => {
		const req = createMockRequest({ method: 'POST' });
		await handler(req, res);

		expect(res._getStatusCode()).toBe(405);
		expect(res._getHeaders()).toHaveProperty('Allow', 'GET');
		expect(res._getData()).toEqual({ message: 'Method Not Allowed' });
	});

	it('returns 400 when personSlug is missing', async () => {
		const req = createMockRequest({ method: 'GET', query: {} });
		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({ message: 'Missing personSlug parameter.' });
	});

	it('returns 500 when TRAKT_CLIENT_ID is not configured', async () => {
		delete process.env.TRAKT_CLIENT_ID;
		vi.resetModules();
		// doMock applies to the import below only; a nested vi.mock is hoisted to the
		// top of the file and races the module-level next/config mock.
		vi.doMock('next/config', () => ({
			default: () => ({ publicRuntimeConfig: {} }),
		}));
		const { default: freshHandler } = await import('@/pages/api/person/[personSlug]');
		const req = createMockRequest({ method: 'GET', query: { personSlug: 'brad-pitt' } });
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await freshHandler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ message: 'Trakt configuration missing.' });
		consoleSpy.mockRestore();
	});

	it('returns credits with cast and crew for movies and shows', async () => {
		const movieCredits = {
			cast: [
				{
					character: 'Tyler Durden',
					movie: {
						title: 'Fight Club',
						year: 1999,
						ids: { trakt: 1, slug: 'fight-club', imdb: 'tt0137523', tmdb: 550 },
					},
				},
			],
			crew: {
				production: [
					{
						movie: {
							title: 'Plan B',
							year: 2007,
							ids: { trakt: 2, slug: 'plan-b', imdb: 'tt0448134', tmdb: 100 },
						},
					},
				],
			},
		};
		const showCredits = {
			cast: [
				{
					character: 'Guest',
					show: {
						title: 'Friends',
						year: 1994,
						ids: { trakt: 3, slug: 'friends', imdb: 'tt0108778', tmdb: 1668 },
					},
				},
			],
			crew: {
				directing: [
					{
						show: {
							title: 'Some Show',
							year: 2020,
							ids: { trakt: 4, slug: 'some-show', imdb: 'tt9999999', tmdb: 5000 },
						},
					},
				],
			},
		};

		mockedAxios.get.mockResolvedValueOnce({ data: movieCredits });
		mockedAxios.get.mockResolvedValueOnce({ data: showCredits });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({ method: 'GET', query: { personSlug: 'brad-pitt' } });

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		const data = res._getData() as any;
		expect(data.movies).toHaveLength(2);
		expect(data.shows).toHaveLength(2);
		// Newest first, Trakt's department shown as a role name.
		expect(data.movies[0]).toEqual({
			title: 'Plan B',
			year: 2007,
			job: 'Producer',
			mediaType: 'movie',
			creditType: 'crew',
			ids: { imdb: 'tt0448134' },
		});
		expect(data.movies[1]).toEqual({
			title: 'Fight Club',
			year: 1999,
			character: 'Tyler Durden',
			mediaType: 'movie',
			creditType: 'cast',
			ids: { imdb: 'tt0137523' },
		});
		consoleSpy.mockRestore();
	});

	it('filters out items without imdb id', async () => {
		const movieCredits = {
			cast: [
				{
					character: 'Role A',
					movie: {
						title: 'Has IMDB',
						year: 2020,
						ids: { trakt: 1, slug: 'a', imdb: 'tt1111111', tmdb: 1 },
					},
				},
				{
					character: 'Role B',
					movie: {
						title: 'No IMDB',
						year: 2021,
						ids: { trakt: 2, slug: 'b', imdb: '', tmdb: 2 },
					},
				},
			],
			crew: {},
		};
		const showCredits = { cast: [], crew: {} };

		mockedAxios.get.mockResolvedValueOnce({ data: movieCredits });
		mockedAxios.get.mockResolvedValueOnce({ data: showCredits });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({ method: 'GET', query: { personSlug: 'test-person' } });

		await handler(req, res);

		const data = res._getData() as any;
		expect(data.movies).toHaveLength(1);
		expect(data.movies[0].title).toBe('Has IMDB');
		consoleSpy.mockRestore();
	});

	it('sorts all credits by year descending', async () => {
		const movieCredits = {
			cast: [
				{
					character: 'A',
					movie: {
						title: 'Old Movie',
						year: 2000,
						ids: { trakt: 1, slug: 'old', imdb: 'tt0000001', tmdb: 1 },
					},
				},
			],
			crew: {},
		};
		const showCredits = {
			cast: [
				{
					character: 'B',
					show: {
						title: 'New Show',
						year: 2024,
						ids: { trakt: 2, slug: 'new', imdb: 'tt0000002', tmdb: 2 },
					},
				},
				{
					character: 'C',
					show: {
						title: 'Mid Show',
						year: 2010,
						ids: { trakt: 3, slug: 'mid', imdb: 'tt0000003', tmdb: 3 },
					},
				},
			],
			crew: {},
		};

		mockedAxios.get.mockResolvedValueOnce({ data: movieCredits });
		mockedAxios.get.mockResolvedValueOnce({ data: showCredits });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({ method: 'GET', query: { personSlug: 'test' } });

		await handler(req, res);

		const data = res._getData() as any;
		expect(data.all[0].year).toBe(2024);
		expect(data.all[1].year).toBe(2010);
		expect(data.all[2].year).toBe(2000);
		consoleSpy.mockRestore();
	});

	it('handles array personSlug param', async () => {
		mockedAxios.get.mockResolvedValueOnce({ data: { cast: [], crew: {} } });
		mockedAxios.get.mockResolvedValueOnce({ data: { cast: [], crew: {} } });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({
			method: 'GET',
			query: { personSlug: ['brad-pitt', 'other'] },
		});

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(mockedAxios.get).toHaveBeenCalledWith(
			'https://api.trakt.tv/people/brad-pitt/movies',
			expect.any(Object)
		);
		consoleSpy.mockRestore();
	});

	it('forwards axios error status on failure', async () => {
		const axiosError: any = new Error('Server Error');
		axiosError.isAxiosError = true;
		axiosError.response = { status: 503, data: 'Service Unavailable' };
		mockedAxios.get.mockRejectedValueOnce(axiosError);
		mockedAxios.isAxiosError.mockReturnValue(true);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({ method: 'GET', query: { personSlug: 'brad-pitt' } });

		await handler(req, res);

		expect(res._getStatusCode()).toBe(503);
		expect(res._getData()).toEqual({ message: 'Failed to fetch person credits.' });
		consoleSpy.mockRestore();
		consoleInfoSpy.mockRestore();
	});

	it('lists each title once with its roles merged (real Trakt credits)', async () => {
		// Trakt returns Lana Wachowski's 30 films as 51 entries: The Matrix once per department.
		mockedAxios.get.mockResolvedValueOnce({ data: lanaMovies });
		mockedAxios.get.mockResolvedValueOnce({ data: lanaShows });
		mockedAxios.get.mockResolvedValueOnce({ data: { name: 'Lana Wachowski' } });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({ method: 'GET', query: { personSlug: 'lana-wachowski' } });

		await handler(req, res);

		const data = res._getData() as any;
		const ids = data.movies.map((item: any) => item.ids.imdb);
		expect(data.movies).toHaveLength(30);
		expect(new Set(ids).size).toBe(30);
		expect(data.movies.filter((item: any) => item.title === 'The Matrix')).toEqual([
			{
				title: 'The Matrix',
				year: 1999,
				job: 'Director · Writer · Producer',
				mediaType: 'movie',
				creditType: 'crew',
				ids: { imdb: 'tt0133093' },
			},
		]);
		expect(new Set(data.shows.map((item: any) => item.ids.imdb)).size).toBe(data.shows.length);
		const years = data.movies.map((item: any) => item.year || 0);
		expect(years).toEqual([...years].sort((a: number, b: number) => b - a));
		expect(data.name).toBe('Lana Wachowski');
		consoleSpy.mockRestore();
	});

	it('returns the real display name, or null when Trakt has none', async () => {
		mockedAxios.get.mockResolvedValueOnce({ data: { cast: [], crew: {} } });
		mockedAxios.get.mockResolvedValueOnce({ data: { cast: [], crew: {} } });
		mockedAxios.get.mockResolvedValueOnce({ data: { name: 'Samuel L. Jackson' } });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		await handler(
			createMockRequest({ method: 'GET', query: { personSlug: 'samuel-l-jackson' } }),
			res
		);
		expect((res._getData() as any).name).toBe('Samuel L. Jackson');

		res = createMockResponse();
		mockedAxios.get.mockResolvedValueOnce({ data: { cast: [], crew: {} } });
		mockedAxios.get.mockResolvedValueOnce({ data: { cast: [], crew: {} } });
		mockedAxios.get.mockRejectedValueOnce(new Error('not found'));
		await handler(createMockRequest({ method: 'GET', query: { personSlug: 'x' } }), res);
		expect(res._getStatusCode()).toBe(200);
		expect((res._getData() as any).name).toBeNull();
		consoleSpy.mockRestore();
	});
});
