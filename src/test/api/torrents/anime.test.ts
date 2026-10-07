import handler from '@/pages/api/torrents/anime';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockValidateProblemToken,
	mockGetAllScrapedTrueResults,
	mockKeyExists,
	mockSaveScrapedResults,
} = vi.hoisted(() => ({
	mockValidateProblemToken: vi.fn(),
	mockGetAllScrapedTrueResults: vi.fn(),
	mockKeyExists: vi.fn(),
	mockSaveScrapedResults: vi.fn(),
}));

vi.mock('@/utils/problemToken', () => ({
	validateProblemToken: mockValidateProblemToken,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		getAllScrapedTrueResults: mockGetAllScrapedTrueResults,
		keyExists: mockKeyExists,
		saveScrapedResults: mockSaveScrapedResults,
	},
}));

const HASH = 'a'.repeat(40);

describe('/api/torrents/anime', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateProblemToken.mockReturnValue(true);
		mockGetAllScrapedTrueResults.mockResolvedValue([
			{ filename: 'Anime.EP01', size_bytes: 1234, hash: HASH },
		]);
	});

	const baseQuery = {
		animeId: 'anidb:1',
		dmmProblemKey: 'key',
		solution: 'solution',
	};

	it('validates authentication', async () => {
		const req = createMockRequest({ query: { animeId: 'anidb:1' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
	});

	it('requires animeId', async () => {
		const req = createMockRequest({ query: { ...baseQuery, animeId: undefined } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			errorMessage: 'Missing "animeId" query parameter',
		});
	});

	it('returns the stored releases in the shape the other torrent routes use', async () => {
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetAllScrapedTrueResults).toHaveBeenCalledWith('anime:anidb:1');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [{ hash: HASH, title: 'Anime.EP01', fileSize: 1234 }],
			episodes: { episodes: [{ episode: 1, count: 1 }], batches: 0, unnumbered: 0 },
		});
	});

	// A Cyrillic-led name is served (card 248, anime.scrapedtrue.test.ts).
	it('drops releases with no hash, no title or a repeated hash', async () => {
		mockGetAllScrapedTrueResults.mockResolvedValue([
			{ filename: 'Anime.EP01', size_bytes: 1234, hash: HASH },
			{ filename: 'Anime.EP01 again', size_bytes: 1, hash: HASH },
			{ filename: '', size_bytes: 9, hash: 'c'.repeat(40) },
			{ filename: 'no hash', size_bytes: 9 },
		]);
		const res = createMockResponse();

		await handler(createMockRequest({ query: baseQuery }), res);

		expect(res.json).toHaveBeenCalledWith({
			results: [{ hash: HASH, title: 'Anime.EP01', fileSize: 1234 }],
			episodes: { episodes: [{ episode: 1, count: 1 }], batches: 0, unnumbered: 0 },
		});
	});

	it('rejects a page that is not a non-negative integer', async () => {
		const res = createMockResponse();

		await handler(createMockRequest({ query: { ...baseQuery, page: '-1' } }), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockGetAllScrapedTrueResults).not.toHaveBeenCalled();
	});

	// Nothing reads these: the request queue takes only `requested:tt*`, and no
	// scraper marks an anime id `processing:`. On 2026-09-27 one probe of
	// anidb-17617 left `requested:anidb-17617` behind in production.
	it('answers an unscraped anime with an empty list and writes nothing', async () => {
		mockGetAllScrapedTrueResults.mockResolvedValue(null);
		const res = createMockResponse();

		await handler(createMockRequest({ query: { ...baseQuery, animeId: 'anidb-18886' } }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [],
			episodes: { episodes: [], batches: 0, unnumbered: 0 },
		});
		expect(mockSaveScrapedResults).not.toHaveBeenCalled();
		expect(mockKeyExists).not.toHaveBeenCalled();
	});

	it('writes nothing for a page past the end either', async () => {
		const res = createMockResponse();

		await handler(createMockRequest({ query: { ...baseQuery, page: '3' } }), res);

		expect(res.json).toHaveBeenCalledWith({ results: [] });
		expect(mockSaveScrapedResults).not.toHaveBeenCalled();
	});

	it('returns 500 when the repository throws', async () => {
		mockGetAllScrapedTrueResults.mockRejectedValue(new Error('db'));
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ errorMessage: 'An internal error occurred' });
	});
});
