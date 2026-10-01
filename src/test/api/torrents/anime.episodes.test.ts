import handler from '@/pages/api/torrents/anime';
import frieren from '@/test/fixtures/anime/scrapedtrue-anime-anidb-17617.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Frieren's 772 stored releases as production held them on 2026-09-27. They
// are served largest first, so page 0 is packs and episode 5 sits pages deep.

const { mockGetAllScrapedTrueResults } = vi.hoisted(() => ({
	mockGetAllScrapedTrueResults: vi.fn(),
}));

vi.mock('@/utils/problemToken', () => ({ validateProblemToken: () => true }));
vi.mock('@/services/repository', () => ({
	repository: { getAllScrapedTrueResults: mockGetAllScrapedTrueResults },
}));

const query = { animeId: 'anidb-17617', dmmProblemKey: 'key', solution: 'solution' };
type Served = {
	results: { hash: string; title: string; fileSize: number }[];
	episodes?: {
		episodes: { episode: number; count: number }[];
		batches: number;
		unnumbered: number;
	};
};

async function serve(extra: Record<string, string> = {}) {
	const res = createMockResponse();
	await handler(createMockRequest({ query: { ...query, ...extra } }), res);
	return { res, body: vi.mocked(res.json).mock.calls[0]?.[0] as Served };
}

describe('/api/torrents/anime episode handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAllScrapedTrueResults.mockImplementation(async () => structuredClone(frieren));
	});

	it('summarises every episode of the whole row on page 0', async () => {
		const { body } = await serve();

		expect(body.results).toHaveLength(50);
		expect(body.episodes!.episodes.map((e) => e.episode)).toEqual(
			Array.from({ length: 28 }, (_, i) => i + 1)
		);
		expect(body.episodes!.batches).toBe(39);
		// Page 0 is the largest releases; no single episode is among them.
		expect(body.results.every((r) => !/Frieren - 05 \(/.test(r.title))).toBe(true);
	});

	it('serves one episode across the whole row, not only the page on screen', async () => {
		const { body } = await serve({ episode: '5' });

		expect(body.results.length).toBe(26);
		expect(body.results.map((r) => r.title)).toContain(
			'[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv'
		);
		expect(body.results.every((r) => !/01 ~ 28|\(01-28\)/.test(r.title))).toBe(true);
		// Still the whole entry's summary, so the other episodes stay offered.
		expect(body.episodes!.episodes).toHaveLength(28);
	});

	it('pages the packs on their own', async () => {
		const first = await serve({ episode: 'batch' });
		const second = await serve({ episode: 'batch', page: '1' });

		expect(first.body.results).toHaveLength(39);
		expect(second.body).toEqual({ results: [] });
	});

	it('leaves the summary off later pages', async () => {
		const { body } = await serve({ page: '1' });

		expect(body.results).toHaveLength(50);
		expect(body.episodes).toBeUndefined();
	});

	it.each(['-1', 'five', '5.5', '99999'])('refuses episode=%s', async (episode) => {
		const { res } = await serve({ episode });

		expect(res.status).toHaveBeenCalledWith(400);
		expect(mockGetAllScrapedTrueResults).not.toHaveBeenCalled();
	});
});
