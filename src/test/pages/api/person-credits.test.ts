import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosMockModule, axiosGetMock, nextConfigMockModule } = vi.hoisted(() => {
	const get = vi.fn();
	const isAxiosError = (error: unknown) => Boolean((error as any)?.isAxiosError);
	return {
		axiosGetMock: get,
		axiosMockModule: {
			__esModule: true,
			default: Object.assign(get, {
				get,
				isAxiosError,
			}),
			get,
			isAxiosError,
		},
		nextConfigMockModule: {
			__esModule: true,
			default: () => ({ publicRuntimeConfig: { traktClientId: 'runtime-test-id' } }),
		},
	};
});

vi.mock('axios', () => axiosMockModule);
vi.mock('next/config', () => nextConfigMockModule);

import handler from '@/pages/api/person/[personSlug]';

type MockResponse = Pick<NextApiResponse, 'status' | 'json' | 'setHeader'>;

const createResponse = () => {
	const res: Partial<MockResponse> = {};
	res.setHeader = vi.fn();
	res.status = vi.fn().mockReturnThis();
	res.json = vi.fn().mockReturnThis();
	return res as unknown as MockResponse;
};

describe('person credits API', () => {
	beforeEach(() => {
		axiosGetMock.mockReset();
		process.env.TRAKT_CLIENT_ID = 'test-client-id';
	});

	it('returns person credits from Trakt including cast and crew', async () => {
		const moviesMockData = {
			cast: [
				{
					character: 'Jack Dawson',
					movie: {
						title: 'Titanic',
						year: 1997,
						ids: {
							trakt: 100,
							slug: 'titanic-1997',
							imdb: 'tt0120338',
							tmdb: 597,
						},
					},
				},
			],
			crew: {
				directing: [
					{
						movie: {
							title: 'The Grand Budapest Hotel',
							year: 2014,
							ids: {
								trakt: 101,
								slug: 'grand-budapest-hotel',
								imdb: 'tt2278388',
								tmdb: 120467,
							},
						},
					},
				],
			},
		};

		const showsMockData = {
			cast: [
				{
					character: 'Luke Brower',
					show: {
						title: 'Growing Pains',
						year: 1985,
						ids: {
							trakt: 200,
							slug: 'growing-pains',
							imdb: 'tt0088527',
							tmdb: 1222,
						},
					},
				},
			],
			crew: {},
		};

		axiosGetMock
			.mockResolvedValueOnce({ data: moviesMockData })
			.mockResolvedValueOnce({ data: showsMockData });

		const res = createResponse();
		await handler(
			{
				method: 'GET',
				query: { personSlug: 'leonardo-dicaprio' },
			} as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(axiosGetMock).toHaveBeenCalledWith(
			'https://api.trakt.tv/people/leonardo-dicaprio/movies',
			expect.objectContaining({
				headers: expect.objectContaining({
					'trakt-api-key': 'test-client-id',
				}),
			})
		);
		expect(axiosGetMock).toHaveBeenCalledWith(
			'https://api.trakt.tv/people/leonardo-dicaprio/shows',
			expect.objectContaining({
				headers: expect.objectContaining({
					'trakt-api-key': 'test-client-id',
				}),
			})
		);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			name: null,
			movies: [
				{
					title: 'The Grand Budapest Hotel',
					year: 2014,
					job: 'Director',
					mediaType: 'movie',
					creditType: 'crew',
					ids: { imdb: 'tt2278388' },
				},
				{
					title: 'Titanic',
					year: 1997,
					character: 'Jack Dawson',
					mediaType: 'movie',
					creditType: 'cast',
					ids: { imdb: 'tt0120338' },
				},
			],
			shows: [
				{
					title: 'Growing Pains',
					year: 1985,
					character: 'Luke Brower',
					mediaType: 'show',
					creditType: 'cast',
					ids: { imdb: 'tt0088527' },
				},
			],
			all: [
				{
					title: 'The Grand Budapest Hotel',
					year: 2014,
					job: 'Director',
					mediaType: 'movie',
					creditType: 'crew',
					ids: { imdb: 'tt2278388' },
				},
				{
					title: 'Titanic',
					year: 1997,
					character: 'Jack Dawson',
					mediaType: 'movie',
					creditType: 'cast',
					ids: { imdb: 'tt0120338' },
				},
				{
					title: 'Growing Pains',
					year: 1985,
					character: 'Luke Brower',
					mediaType: 'show',
					creditType: 'cast',
					ids: { imdb: 'tt0088527' },
				},
			],
		});
	});

	it('filters out credits without IMDb IDs', async () => {
		const moviesMockData = {
			cast: [
				{
					character: 'Character 1',
					movie: {
						title: 'Movie With IMDb',
						year: 2020,
						ids: { trakt: 1, slug: 'movie-1', imdb: 'tt1234567', tmdb: 100 },
					},
				},
				{
					character: 'Character 2',
					movie: {
						title: 'Movie Without IMDb',
						year: 2021,
						ids: { trakt: 2, slug: 'movie-2', imdb: null, tmdb: 101 },
					},
				},
			],
			crew: {},
		};

		const showsMockData = { cast: [], crew: {} };

		axiosGetMock
			.mockResolvedValueOnce({ data: moviesMockData })
			.mockResolvedValueOnce({ data: showsMockData });

		const res = createResponse();
		await handler(
			{
				method: 'GET',
				query: { personSlug: 'test-person' },
			} as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(res.status).toHaveBeenCalledWith(200);
		const jsonCall = (res.json as any).mock.calls[0][0];
		expect(jsonCall.movies).toHaveLength(1);
		expect(jsonCall.movies[0].title).toBe('Movie With IMDb');
	});

	it('validates required personSlug parameter', async () => {
		const res = createResponse();
		await handler(
			{ method: 'GET', query: {} } as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ message: 'Missing personSlug parameter.' });
	});

	it('returns 405 for non-GET methods', async () => {
		const res = createResponse();
		await handler(
			{ method: 'POST', query: { personSlug: 'test' } } as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
		expect(res.json).toHaveBeenCalledWith({ message: 'Method Not Allowed' });
	});

	it('handles Trakt API errors gracefully', async () => {
		axiosGetMock.mockRejectedValue({
			isAxiosError: true,
			response: {
				status: 404,
				data: 'Not Found',
			},
		});

		const res = createResponse();
		await handler(
			{
				method: 'GET',
				query: { personSlug: 'unknown-person' },
			} as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({ message: 'Failed to fetch person credits.' });
	});

	it('uses runtime config when env variable is missing', async () => {
		delete process.env.TRAKT_CLIENT_ID;
		axiosGetMock
			.mockResolvedValueOnce({ data: { cast: [], crew: {} } })
			.mockResolvedValueOnce({ data: { cast: [], crew: {} } });

		const res = createResponse();
		await handler(
			{
				method: 'GET',
				query: { personSlug: 'test' },
			} as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(axiosGetMock).toHaveBeenCalledWith(
			'https://api.trakt.tv/people/test/movies',
			expect.objectContaining({
				headers: expect.objectContaining({
					'trakt-api-key': 'runtime-test-id',
				}),
			})
		);
		expect(res.status).toHaveBeenCalledWith(200);
	});
});
