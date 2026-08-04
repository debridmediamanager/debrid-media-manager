import handler from '@/pages/api/torrents/tv';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockValidateTokenWithHash,
	mockGetScrapedTrueResults,
	mockGetScrapedResults,
	mockGetReportedHashes,
	mockKeyExists,
	mockSaveScrapedResults,
	mockFlatten,
	mockSort,
} = vi.hoisted(() => ({
	mockValidateTokenWithHash: vi.fn(),
	mockGetScrapedTrueResults: vi.fn(),
	mockGetScrapedResults: vi.fn(),
	mockGetReportedHashes: vi.fn(),
	mockKeyExists: vi.fn(),
	mockSaveScrapedResults: vi.fn(),
	mockFlatten: vi.fn((items: any[]) => items),
	mockSort: vi.fn((items: any[]) => items),
}));

vi.mock('@/utils/token', () => ({
	validateTokenWithHash: mockValidateTokenWithHash,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		getScrapedTrueResults: mockGetScrapedTrueResults,
		getScrapedResults: mockGetScrapedResults,
		getReportedHashes: mockGetReportedHashes,
		keyExists: mockKeyExists,
		saveScrapedResults: mockSaveScrapedResults,
	},
}));

vi.mock('@/services/mediasearch', () => ({
	flattenAndRemoveDuplicates: mockFlatten,
	sortByFileSize: mockSort,
}));

describe('/api/torrents/tv', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateTokenWithHash.mockResolvedValue(true);
		mockGetScrapedTrueResults.mockResolvedValue([{ title: 'Season Pack', hash: 'hash-1' }]);
		mockGetScrapedResults.mockResolvedValue([{ title: 'Reported', hash: 'hash-2' }]);
		mockGetReportedHashes.mockResolvedValue(['hash-2']);
	});

	const baseQuery = {
		imdbId: 'tt7654321',
		seasonNum: '2',
		dmmProblemKey: 'key',
		solution: 'solution',
	};

	it('validates authentication parameters', async () => {
		const req = createMockRequest({ query: { imdbId: 'tt', seasonNum: '1' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
	});

	it('rejects invalid tokens', async () => {
		mockValidateTokenWithHash.mockResolvedValue(false);
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
	});

	it('requires imdbId and season number', async () => {
		const req = createMockRequest({ query: { ...baseQuery, imdbId: undefined } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);

		const req2 = createMockRequest({ query: { ...baseQuery, seasonNum: undefined } });
		const res2 = createMockResponse();

		await handler(req2, res2);

		expect(res2.status).toHaveBeenCalledWith(400);
	});

	it('returns filtered tv torrents', async () => {
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetScrapedTrueResults).toHaveBeenCalledWith('tv:tt7654321:2', 0, 0);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [{ title: 'Season Pack', hash: 'hash-1' }],
		});
	});

	it('handles filtering errors by falling back to unfiltered results', async () => {
		mockGetReportedHashes.mockRejectedValue(new Error('redis'));
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [
				{ title: 'Season Pack', hash: 'hash-1' },
				{ title: 'Reported', hash: 'hash-2' },
			],
		});
	});

	it('marks the imdb id as requested when the season has never been scraped', async () => {
		mockGetScrapedTrueResults.mockResolvedValue([]);
		mockGetScrapedResults.mockResolvedValue([]);
		mockKeyExists.mockResolvedValue(false);
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveScrapedResults).toHaveBeenCalledWith('requested:tt7654321', []);
		expect(res.setHeader).toHaveBeenCalledWith('status', 'requested');
		expect(res.status).toHaveBeenCalledWith(204);
		expect(mockGetReportedHashes).not.toHaveBeenCalled();
	});

	it('reports processing instead of re-requesting an in-flight scrape', async () => {
		mockGetScrapedTrueResults.mockResolvedValue([]);
		mockGetScrapedResults.mockResolvedValue([]);
		mockKeyExists.mockResolvedValue(true);
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('status', 'processing');
		expect(res.status).toHaveBeenCalledWith(204);
		expect(mockSaveScrapedResults).not.toHaveBeenCalled();
	});

	it('does not queue a scrape when a later page simply runs out', async () => {
		mockGetScrapedTrueResults.mockResolvedValue([]);
		mockGetScrapedResults.mockResolvedValue([]);
		const req = createMockRequest({ query: { ...baseQuery, page: '3' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveScrapedResults).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: [] });
	});

	it('does not queue a scrape when filters emptied the results', async () => {
		mockGetScrapedTrueResults.mockResolvedValue([]);
		mockGetScrapedResults.mockResolvedValue([]);
		const req = createMockRequest({ query: { ...baseQuery, maxSize: '5' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveScrapedResults).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns 500 for unexpected repository errors', async () => {
		mockGetScrapedTrueResults.mockRejectedValue(new Error('db'));
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'An internal error occurred' });
	});
});
