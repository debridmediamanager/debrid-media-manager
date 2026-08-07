import handler from '@/pages/api/nzb2rd/search';
import { searchUsenet } from '@/services/nzb2rd';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/nzb2rd', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/nzb2rd')>();
	return { ...actual, searchUsenet: vi.fn(), getNewznabApiKey: () => 'test-key' };
});

const mockRepository = vi.mocked(repository);
const mockSearch = vi.mocked(searchUsenet);

const RESULTS = [{ id: 'a', title: 'Some.Release.1080p', size: 100 }];
const CACHED = [{ id: 'b', title: 'Cached.Release.1080p', size: 200 }];

const run = async (query: Record<string, string>) => {
	const req = createMockRequest({ method: 'GET', query });
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

beforeEach(() => {
	vi.clearAllMocks();
	mockRepository.getCachedNzbSearch = vi.fn().mockResolvedValue(null);
	mockRepository.setCachedNzbSearch = vi.fn().mockResolvedValue(undefined);
});

describe('GET /api/nzb2rd/search caching', () => {
	it('calls the indexer on a cold cache and stores the result', async () => {
		mockSearch.mockResolvedValue(RESULTS);

		const res = await run({ imdbId: 'tt1418646' });

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: RESULTS, cached: false });
		expect(mockSearch).toHaveBeenCalledTimes(1);
		expect(mockRepository.setCachedNzbSearch).toHaveBeenCalledWith(
			'tt1418646',
			undefined,
			RESULTS
		);
	});

	// The whole point: the indexer meters API calls against one shared account.
	it('serves a fresh entry without touching the indexer', async () => {
		mockRepository.getCachedNzbSearch = vi
			.fn()
			.mockResolvedValue({ results: CACHED, updatedAt: new Date(), isFresh: true });

		const res = await run({ imdbId: 'tt1418646' });

		expect(res.json).toHaveBeenCalledWith({ results: CACHED, cached: true });
		expect(mockSearch).not.toHaveBeenCalled();
		expect(mockRepository.setCachedNzbSearch).not.toHaveBeenCalled();
	});

	it('refetches once the entry is past its TTL', async () => {
		mockRepository.getCachedNzbSearch = vi
			.fn()
			.mockResolvedValue({ results: CACHED, updatedAt: new Date(0), isFresh: false });
		mockSearch.mockResolvedValue(RESULTS);

		const res = await run({ imdbId: 'tt1418646' });

		expect(mockSearch).toHaveBeenCalledTimes(1);
		expect(res.json).toHaveBeenCalledWith({ results: RESULTS, cached: false });
	});

	it('falls back to a stale entry when the indexer is down', async () => {
		mockRepository.getCachedNzbSearch = vi
			.fn()
			.mockResolvedValue({ results: CACHED, updatedAt: new Date(0), isFresh: false });
		mockSearch.mockRejectedValue(new Error('indexer returned 429'));

		const res = await run({ imdbId: 'tt1418646' });

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ results: CACHED, cached: true, stale: true });
	});

	it('still fails when the indexer is down and nothing was ever cached', async () => {
		mockSearch.mockRejectedValue(new Error('indexer returned 429'));

		const res = await run({ imdbId: 'tt1418646' });

		expect(res.status).toHaveBeenCalledWith(502);
	});

	it('caches a show season under its own key', async () => {
		mockSearch.mockResolvedValue(RESULTS);

		await run({ imdbId: 'tt0944947', seasonNum: '2' });

		expect(mockRepository.getCachedNzbSearch).toHaveBeenCalledWith('tt0944947', 2);
		expect(mockRepository.setCachedNzbSearch).toHaveBeenCalledWith('tt0944947', 2, RESULTS);
	});

	it('survives a cache read failure by going to the indexer', async () => {
		mockRepository.getCachedNzbSearch = vi.fn().mockRejectedValue(new Error('db down'));
		mockSearch.mockResolvedValue(RESULTS);

		const res = await run({ imdbId: 'tt1418646' });

		expect(res.json).toHaveBeenCalledWith({ results: RESULTS, cached: false });
	});

	it('rejects a bad imdb id before spending anything', async () => {
		const res = await run({ imdbId: 'nope' });

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockSearch).not.toHaveBeenCalled();
		expect(mockRepository.getCachedNzbSearch).not.toHaveBeenCalled();
	});
});
