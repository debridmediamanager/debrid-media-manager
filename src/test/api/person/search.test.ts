import handler from '@/pages/api/person/search';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { traktClientId: 'test-id' } }),
}));

const mockedAxios = vi.mocked(axios, true);

describe('/api/person/search', () => {
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

	it('returns 400 when query param is missing', async () => {
		const req = createMockRequest({ method: 'GET', query: {} });
		await handler(req, res);

		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({ message: 'Missing query parameter.' });
	});

	it('returns 500 when TRAKT_CLIENT_ID is not configured', async () => {
		delete process.env.TRAKT_CLIENT_ID;
		vi.resetModules();
		vi.mock('next/config', () => ({
			default: () => ({ publicRuntimeConfig: {} }),
		}));
		const { default: freshHandler } = await import('@/pages/api/person/search');
		const req = createMockRequest({ method: 'GET', query: { query: 'brad pitt' } });
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await freshHandler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ message: 'Trakt configuration missing.' });
		consoleSpy.mockRestore();
	});

	it('returns mapped search results on success', async () => {
		const traktResponse = [
			{
				type: 'person',
				score: 100,
				person: {
					name: 'Brad Pitt',
					ids: { trakt: 1, slug: 'brad-pitt', imdb: 'nm0000093', tmdb: 287 },
				},
			},
			{
				type: 'person',
				score: 50,
				person: {
					name: 'Brad Pittman',
					ids: { trakt: 2, slug: 'brad-pittman', imdb: 'nm1234567', tmdb: 999 },
				},
			},
		];
		mockedAxios.get.mockResolvedValueOnce({ data: traktResponse });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({ method: 'GET', query: { query: 'brad pitt' } });

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			results: [
				{ name: 'Brad Pitt', slug: 'brad-pitt', imdb: 'nm0000093', tmdb: 287, score: 100 },
				{
					name: 'Brad Pittman',
					slug: 'brad-pittman',
					imdb: 'nm1234567',
					tmdb: 999,
					score: 50,
				},
			],
		});
		expect(mockedAxios.get).toHaveBeenCalledWith(
			'https://api.trakt.tv/search/person',
			expect.objectContaining({ params: { query: 'brad pitt' } })
		);
		consoleSpy.mockRestore();
	});

	it('handles array query param by using first element', async () => {
		mockedAxios.get.mockResolvedValueOnce({ data: [] });
		const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({ method: 'GET', query: { query: ['first', 'second'] } });

		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(mockedAxios.get).toHaveBeenCalledWith(
			'https://api.trakt.tv/search/person',
			expect.objectContaining({ params: { query: 'first' } })
		);
		consoleSpy.mockRestore();
	});

	it('forwards axios error status on failure', async () => {
		const axiosError: any = new Error('Not Found');
		axiosError.isAxiosError = true;
		axiosError.response = { status: 404, data: 'Not Found' };
		mockedAxios.get.mockRejectedValueOnce(axiosError);
		mockedAxios.isAxiosError.mockReturnValue(true);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const req = createMockRequest({ method: 'GET', query: { query: 'test' } });

		await handler(req, res);

		expect(res._getStatusCode()).toBe(404);
		expect(res._getData()).toEqual({ message: 'Failed to search for person.' });
		consoleSpy.mockRestore();
		consoleInfoSpy.mockRestore();
	});
});
