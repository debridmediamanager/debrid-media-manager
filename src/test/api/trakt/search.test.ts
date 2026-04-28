import handler from '@/pages/api/trakt/search';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');

const mockAxios = vi.mocked(axios);

describe('/api/trakt/search', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects non-GET methods', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('returns 400 when query is missing', async () => {
		const req = createMockRequest({ method: 'GET', query: {} });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'Missing query parameter' });
	});

	it('returns results from Trakt search', async () => {
		const searchResults = [
			{ type: 'movie', score: 100, movie: { title: 'Test Movie', ids: { trakt: '1' } } },
		];
		(mockAxios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: searchResults });

		const req = createMockRequest({ method: 'GET', query: { query: 'test' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(searchResults);
	});

	it('uses default types "movie,show" when not specified', async () => {
		(mockAxios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });

		const req = createMockRequest({ method: 'GET', query: { query: 'test' } });
		const res = createMockResponse();

		await handler(req, res);

		const url = (mockAxios.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(url).toContain('/search/movie,show');
	});

	it('uses custom types when provided', async () => {
		(mockAxios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });

		const req = createMockRequest({
			method: 'GET',
			query: { query: 'test', types: 'movie' },
		});
		const res = createMockResponse();

		await handler(req, res);

		const url = (mockAxios.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(url).toContain('/search/movie?');
		expect(url).not.toContain('movie,show');
	});

	it('returns error status from Trakt on failure', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		(mockAxios.get as ReturnType<typeof vi.fn>).mockRejectedValue({
			message: 'Request failed',
			response: { status: 429 },
		});

		const req = createMockRequest({ method: 'GET', query: { query: 'test' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(429);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch search results' });
	});

	it('returns 500 when Trakt error has no response status', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		(mockAxios.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

		const req = createMockRequest({ method: 'GET', query: { query: 'test' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch search results' });
	});

	it('encodes query parameter in the URL', async () => {
		(mockAxios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });

		const req = createMockRequest({
			method: 'GET',
			query: { query: 'test show & movie' },
		});
		const res = createMockResponse();

		await handler(req, res);

		const url = (mockAxios.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(url).toContain(encodeURIComponent('test show & movie'));
	});
});
