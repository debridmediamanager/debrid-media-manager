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
	});

	it('returns the stored releases in the shape the other torrent routes use', async () => {
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetAllScrapedTrueResults).toHaveBeenCalledWith('anime:anidb:1');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			results: [{ hash: HASH, title: 'Anime.EP01', fileSize: 1234 }],
		});
	});

	it('drops the same releases the paged query drops', async () => {
		mockGetAllScrapedTrueResults.mockResolvedValue([
			{ filename: 'Anime.EP01', size_bytes: 1234, hash: HASH },
			{ filename: 'Anime.EP01 again', size_bytes: 1, hash: HASH },
			{ filename: 'Аниме 01', size_bytes: 9, hash: 'b'.repeat(40) },
			{ filename: '', size_bytes: 9, hash: 'c'.repeat(40) },
			{ filename: 'no hash', size_bytes: 9 },
		]);
		const res = createMockResponse();

		await handler(createMockRequest({ query: baseQuery }), res);

		expect(res.json).toHaveBeenCalledWith({
			results: [{ hash: HASH, title: 'Anime.EP01', fileSize: 1234 }],
		});
	});

	it('rejects a page that is not a non-negative integer', async () => {
		const res = createMockResponse();

		await handler(createMockRequest({ query: { ...baseQuery, page: '-1' } }), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockGetAllScrapedTrueResults).not.toHaveBeenCalled();
	});

	it('marks the anime id as requested when nothing has been scraped', async () => {
		mockGetAllScrapedTrueResults.mockResolvedValue(null);
		mockKeyExists.mockResolvedValue(false);
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockSaveScrapedResults).toHaveBeenCalledWith('requested:anidb:1', []);
		expect(res.setHeader).toHaveBeenCalledWith('status', 'requested');
		expect(res.status).toHaveBeenCalledWith(204);
	});

	it('reports processing instead of re-requesting an in-flight scrape', async () => {
		mockGetAllScrapedTrueResults.mockResolvedValue(null);
		mockKeyExists.mockResolvedValue(true);
		const req = createMockRequest({ query: baseQuery });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.setHeader).toHaveBeenCalledWith('status', 'processing');
		expect(res.status).toHaveBeenCalledWith(204);
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
