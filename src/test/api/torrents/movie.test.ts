import handler from '@/pages/api/torrents/movie';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { TRAP_POOL } from '@/utils/canary';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockValidateProblemToken,
	mockGetScrapedTrueResults,
	mockGetScrapedResults,
	mockGetReportedHashes,
	mockKeyExists,
	mockSaveScrapedResults,
	mockRecordCanary,
	mockFlatten,
	mockSort,
	mockBackfillDebridio,
	mockRefreshDebridio,
} = vi.hoisted(() => ({
	mockValidateProblemToken: vi.fn(),
	mockGetScrapedTrueResults: vi.fn(),
	mockGetScrapedResults: vi.fn(),
	mockGetReportedHashes: vi.fn(),
	mockKeyExists: vi.fn(),
	mockSaveScrapedResults: vi.fn(),
	mockRecordCanary: vi.fn(),
	mockFlatten: vi.fn((items: any[]) => items),
	mockSort: vi.fn((items: any[]) => items),
	mockBackfillDebridio: vi.fn().mockResolvedValue([]),
	mockRefreshDebridio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/problemToken', () => ({
	validateProblemToken: mockValidateProblemToken,
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

vi.mock('@/services/canary/canaryStore', () => ({
	getCanaryStore: () => ({ record: mockRecordCanary }),
}));

vi.mock('@/utils/debridioBackfill', () => ({
	backfillFromDebridioNow: mockBackfillDebridio,
	refreshDebridioAvailabilityInBackground: mockRefreshDebridio,
}));

describe('/api/torrents/movie', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateProblemToken.mockReturnValue(true);
		mockGetScrapedTrueResults.mockResolvedValue([{ title: 'Trusted', hash: 'hash-1' }]);
		mockGetScrapedResults.mockResolvedValue([{ title: 'Community', hash: 'hash-2' }]);
		mockGetReportedHashes.mockResolvedValue(['hash-2']);
	});

	const baseQuery = {
		imdbId: 'tt1234567',
		dmmProblemKey: 'key',
		solution: 'solution',
	};

	it('requires authentication parameters', async () => {
		const req = createMockRequest({ query: { imdbId: 'tt123' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(mockValidateProblemToken).not.toHaveBeenCalled();
	});

	it('rejects when token validation fails', async () => {
		mockValidateProblemToken.mockReturnValue(false);
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
	});

	it('requires imdbId', async () => {
		const req = createMockRequest({ query: { ...baseQuery, imdbId: undefined } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns filtered search results and removes reported hashes', async () => {
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetScrapedTrueResults).toHaveBeenCalled();
		expect(mockGetScrapedResults).toHaveBeenCalled();
		expect(mockGetReportedHashes).toHaveBeenCalledWith('tt1234567');
		expect(mockFlatten).toHaveBeenCalledWith([{ title: 'Trusted', hash: 'hash-1' }]);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: [{ title: 'Trusted', hash: 'hash-1' }] });
	});

	it('falls back to unfiltered results when reporting lookup fails', async () => {
		mockGetReportedHashes.mockRejectedValue(new Error('redis down'));
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [
				{ title: 'Trusted', hash: 'hash-1' },
				{ title: 'Community', hash: 'hash-2' },
			],
		});
	});

	it('skips community results when onlyTrusted is true', async () => {
		const req = createMockRequest({ query: { ...baseQuery, onlyTrusted: 'true' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetScrapedResults).not.toHaveBeenCalled();
	});

	it('marks the imdb id as requested when nothing has been scraped', async () => {
		mockGetScrapedTrueResults.mockResolvedValue([]);
		mockGetScrapedResults.mockResolvedValue([]);
		mockKeyExists.mockResolvedValue(false);
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveScrapedResults).toHaveBeenCalledWith('requested:tt1234567', []);
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
		const req = createMockRequest({ query: { ...baseQuery, page: '2' } });
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

		mockSaveScrapedResults.mockClear();
		const trustedReq = createMockRequest({ query: { ...baseQuery, onlyTrusted: 'true' } });
		const trustedRes = createMockResponse();

		await handler(trustedReq, trustedRes);

		expect(mockSaveScrapedResults).not.toHaveBeenCalled();
		expect(trustedRes.status).toHaveBeenCalledWith(200);
	});

	it('returns 500 when the repository throws synchronously', async () => {
		mockGetScrapedTrueResults.mockRejectedValue(new Error('db down'));
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'An internal error occurred' });
	});

	it('fills an unscraped title from debridio on the same request', async () => {
		mockGetScrapedTrueResults.mockResolvedValue([]);
		mockGetScrapedResults.mockResolvedValue([]);
		const debridioResults = [
			{ title: 'From.Debridio.2160p', fileSize: 58357.76, hash: 'a'.repeat(40) },
		];
		mockBackfillDebridio.mockResolvedValue(debridioResults);

		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockBackfillDebridio).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			key: 'movie:tt1234567',
			kind: 'movie',
		});
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: debridioResults });
		// The heavy scrapers still deepen the title afterwards.
		expect(mockSaveScrapedResults).toHaveBeenCalledWith('requested:tt1234567', []);
		expect(mockRefreshDebridio).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			key: 'movie:tt1234567',
			kind: 'movie',
		});
	});

	it('reports requested when debridio also has nothing', async () => {
		mockGetScrapedTrueResults.mockResolvedValue([]);
		mockGetScrapedResults.mockResolvedValue([]);
		mockBackfillDebridio.mockResolvedValue([]);
		mockKeyExists.mockResolvedValue(false);

		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockBackfillDebridio).toHaveBeenCalled();
		expect(mockSaveScrapedResults).toHaveBeenCalledWith('requested:tt1234567', []);
		expect(res.status).toHaveBeenCalledWith(204);
	});

	it('refreshes debridio availability in the background on a served page', async () => {
		await handler(createMockRequest({ query: baseQuery }), createMockResponse());

		expect(mockRefreshDebridio).toHaveBeenCalledWith({
			imdbId: 'tt1234567',
			key: 'movie:tt1234567',
			kind: 'movie',
		});
	});

	describe('impossible titles', () => {
		const trap = TRAP_POOL[0];

		beforeEach(() => {
			vi.spyOn(console, 'warn').mockImplementation(() => {});
		});

		it('never queues a scrape for a canary id', async () => {
			const req = createMockRequest({ query: { ...baseQuery, imdbId: trap } });
			const res = createMockResponse();

			await handler(req, res);

			expect(mockSaveScrapedResults).not.toHaveBeenCalled();
			expect(mockGetScrapedTrueResults).not.toHaveBeenCalled();
			expect(mockGetScrapedResults).not.toHaveBeenCalled();
		});

		it('is indistinguishable from a genuine never-scraped title', async () => {
			const canaryRes = createMockResponse();
			await handler(createMockRequest({ query: { ...baseQuery, imdbId: trap } }), canaryRes);

			mockGetScrapedTrueResults.mockResolvedValue([]);
			mockGetScrapedResults.mockResolvedValue([]);
			mockKeyExists.mockResolvedValue(false);
			const realRes = createMockResponse();
			await handler(createMockRequest({ query: baseQuery }), realRes);

			expect(canaryRes._getStatusCode()).toBe(realRes._getStatusCode());
			expect(canaryRes._getHeaders()).toEqual(realRes._getHeaders());
			expect(canaryRes._getData()).toEqual(realRes._getData());
		});

		it('records the hit against the caller', async () => {
			const req = createMockRequest({
				query: { ...baseQuery, imdbId: trap },
				headers: { 'cf-connecting-ip': '203.0.113.7' },
				url: '/api/torrents/movie',
			});

			await handler(req, createMockResponse());

			expect(mockRecordCanary).toHaveBeenCalledWith('203.0.113.7', {
				imdbId: trap,
				kind: 'trap',
				path: '/api/torrents/movie',
			});
		});

		it('leaves ordinary ids on the normal path', async () => {
			await handler(createMockRequest({ query: baseQuery }), createMockResponse());

			expect(mockRecordCanary).not.toHaveBeenCalled();
			expect(mockGetScrapedTrueResults).toHaveBeenCalled();
		});
	});
});
