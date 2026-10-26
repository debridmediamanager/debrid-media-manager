import handler, { clearTitleSearchMemo } from '@/pages/api/search/title';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchImdbTitlesMock } = vi.hoisted(() => {
	return {
		searchImdbTitlesMock: vi.fn(),
	};
});

vi.mock('@/services/repository', () => ({
	repository: {
		searchImdbTitles: searchImdbTitlesMock,
	},
}));

describe('/api/search/title', () => {
	beforeEach(() => {
		searchImdbTitlesMock.mockReset();
		clearTitleSearchMemo();
	});

	it('asks the database once for a title asked again', async () => {
		// keyless zurgs place whole libraries by name: the same title arrives from every install
		searchImdbTitlesMock.mockResolvedValue([]);
		for (const keyword of ['Severance 2022', 'severance  2022']) {
			const res = createMockResponse();
			await handler(createMockRequest({ query: { keyword } }), res);
			expect(res.status).toHaveBeenCalledWith(200);
		}
		expect(searchImdbTitlesMock).toHaveBeenCalledTimes(1);
	});

	it('returns 400 when keyword is missing', async () => {
		const req = createMockRequest();
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Missing "keyword" query parameter',
		});
	});

	it('returns results from local IMDB database', async () => {
		searchImdbTitlesMock.mockResolvedValue([
			{
				imdbId: 'tt0133093',
				type: 'movie',
				year: 1999,
				title: 'The Matrix',
				originalTitle: 'The Matrix',
				rating: 8.7,
				votes: 2000000,
				isOriginalMatch: true,
			},
			{
				imdbId: 'tt0234215',
				type: 'movie',
				year: 2003,
				title: 'The Matrix Reloaded',
				originalTitle: 'The Matrix Reloaded',
				rating: 7.2,
				votes: 600000,
				isOriginalMatch: true,
			},
		]);
		const req = createMockRequest({ query: { keyword: 'matrix' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(searchImdbTitlesMock).toHaveBeenCalledWith('matrix', {
			limit: 120,
			year: undefined,
			mediaType: undefined,
		});
		const payload = (res.json as Mock).mock.calls[0][0] as { results: any[] };
		expect(payload.results.length).toBe(2);
		expect(payload.results[0].imdbid).toBe('tt0133093');
	});

	it('parses year from search query', async () => {
		searchImdbTitlesMock.mockResolvedValue([
			{
				imdbId: 'tt0133093',
				type: 'movie',
				year: 1999,
				title: 'The Matrix',
				originalTitle: 'The Matrix',
				rating: 8.7,
				votes: 2000000,
				isOriginalMatch: true,
			},
		]);
		const req = createMockRequest({ query: { keyword: 'matrix 1999' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(searchImdbTitlesMock).toHaveBeenCalledWith('matrix', {
			limit: 120,
			year: 1999,
			mediaType: undefined,
		});
	});

	it('parses media type from search query', async () => {
		searchImdbTitlesMock.mockResolvedValue([]);
		const req = createMockRequest({ query: { keyword: 'breaking bad show' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(searchImdbTitlesMock).toHaveBeenCalledWith('breaking bad', {
			limit: 120,
			year: undefined,
			mediaType: 'show',
		});
	});

	it('handles empty results gracefully', async () => {
		searchImdbTitlesMock.mockResolvedValue([]);
		const req = createMockRequest({ query: { keyword: 'nonexistent movie xyz' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: [] });
	});

	it('handles database errors gracefully', async () => {
		searchImdbTitlesMock.mockRejectedValue(new Error('Database connection failed'));
		const req = createMockRequest({ query: { keyword: 'matrix' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'An internal error occurred',
		});
	});
});
