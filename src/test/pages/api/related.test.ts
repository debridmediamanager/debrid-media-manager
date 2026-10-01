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

// The metadata cache's table, in memory and emptied before every test.
const cacheRows = vi.hoisted(() => new Map<string, { data: unknown; updatedAt: Date }>());
vi.mock('@/services/database/mdblistCache', () => ({
	getMdblistCacheService: () => ({
		getWithMetadata: async (key: string) => cacheRows.get(key) ?? null,
		set: async (key: string, _type: string, data: unknown) => {
			cacheRows.set(key, { data, updatedAt: new Date() });
		},
	}),
}));

import handler from '@/pages/api/related/[mediaType]';

type MockResponse = Pick<NextApiResponse, 'status' | 'json' | 'setHeader'>;

const createResponse = () => {
	const res: Partial<MockResponse> = {};
	res.setHeader = vi.fn();
	res.status = vi.fn().mockReturnThis();
	res.json = vi.fn().mockReturnThis();
	return res as unknown as MockResponse;
};

const originalTmdbKey = process.env.TMDB_KEY;

describe('related media API', () => {
	beforeEach(() => {
		cacheRows.clear();
		axiosGetMock.mockReset();
		process.env.TRAKT_CLIENT_ID = 'test-client-id';
		process.env.TMDB_KEY = '';
	});

	it('returns related media results from Trakt', async () => {
		const mockedData = [{ ids: { imdb: 'tt123' } }];
		axiosGetMock.mockResolvedValue({ data: mockedData });

		const res = createResponse();
		await handler(
			{
				method: 'GET',
				query: { mediaType: 'movie', imdbId: 'tt0000001' },
			} as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(axiosGetMock).toHaveBeenCalledWith(
			'https://api.trakt.tv/movies/tt0000001/related',
			expect.objectContaining({
				headers: expect.objectContaining({
					'trakt-api-key': 'test-client-id',
				}),
			})
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: mockedData, source: 'trakt' });
	});

	it('validates required parameters', async () => {
		const res = createResponse();
		await handler(
			{ method: 'GET', query: { mediaType: 'movie' } } as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ message: 'Missing imdbId query parameter.' });
	});

	it('returns graceful message when Trakt returns client error and no fallback is available', async () => {
		axiosGetMock.mockRejectedValue({
			isAxiosError: true,
			response: {
				status: 404,
				data: 'Not found',
			},
		});

		const res = createResponse();
		await handler(
			{
				method: 'GET',
				query: { mediaType: 'show', imdbId: 'tt9999999' },
			} as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [],
			source: 'none',
			message: 'No related media found.',
		});
	});

	it('falls back to TMDB when Trakt fails with server error', async () => {
		process.env.TMDB_KEY = 'tmdb-test-key';
		axiosGetMock
			.mockRejectedValueOnce({
				isAxiosError: true,
				response: { status: 503, data: 'Service Unavailable' },
			})
			.mockResolvedValueOnce({ data: { movie_results: [{ id: 100 }] } })
			.mockResolvedValueOnce({
				data: {
					results: [{ id: 200, title: 'Fallback Movie', release_date: '2021-02-03' }],
				},
			})
			.mockResolvedValueOnce({
				data: {
					external_ids: { imdb_id: 'ttfallback' },
					title: 'Fallback Movie',
					release_date: '2021-02-03',
				},
			});

		const res = createResponse();
		await handler(
			{
				method: 'GET',
				query: { mediaType: 'movie', imdbId: 'tt1234567' },
			} as unknown as NextApiRequest,
			res as unknown as NextApiResponse
		);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [
				{
					title: 'Fallback Movie',
					year: 2021,
					ids: { imdb: 'ttfallback' },
				},
			],
			source: 'tmdb',
			message: 'Fetched related movies via TMDB fallback.',
		});
	});
});

afterAll(() => {
	process.env.TMDB_KEY = originalTmdbKey;
});
