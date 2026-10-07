import handler from '@/pages/api/torrents/anime';
import storedRow from '@/test/fixtures/anime/scrapedtrue-anime-anidb-17617.json';
import page0 from '@/test/fixtures/anime/scrapedtrue-page0-anime-anidb-17617.json';
import recorded from '@/test/fixtures/scraped/cyrillic-led-pages-2026-10-07.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The repository answers exactly as production's did for `anime:anidb-17617`
// on 2026-09-27: the paged JSON_TABLE query returned `null` for a row holding
// 772 releases, because every one of them is `{hash, filename, size_bytes}`
// and the query projects only `$.title` and `$.fileSize`. Nothing else is
// mocked: deduplication and ordering are the real ones.

const { mockGetScrapedTrueResults, mockGetAllScrapedTrueResults, mockSaveScrapedResults } =
	vi.hoisted(() => ({
		mockGetScrapedTrueResults: vi.fn(),
		mockGetAllScrapedTrueResults: vi.fn(),
		mockSaveScrapedResults: vi.fn(),
	}));

vi.mock('@/utils/problemToken', () => ({ validateProblemToken: () => true }));

vi.mock('@/services/repository', () => ({
	repository: {
		getScrapedTrueResults: mockGetScrapedTrueResults,
		getAllScrapedTrueResults: mockGetAllScrapedTrueResults,
		saveScrapedResults: mockSaveScrapedResults,
	},
}));

type Legacy = { hash: string; filename: string; size_bytes: number };
const legacy = storedRow as Legacy[];

const query = { animeId: 'anidb-17617', dmmProblemKey: 'key', solution: 'solution' };

type Served = { hash: string; title: string; fileSize: number };
const results = (res: ReturnType<typeof createMockResponse>): Served[] =>
	vi.mocked(res.json).mock.calls[0][0].results;

describe('/api/torrents/anime reads the rows the scrapers stored', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetScrapedTrueResults.mockResolvedValue(page0[0].value);
		mockGetAllScrapedTrueResults.mockImplementation(async (key: string) =>
			key === 'anime:anidb-17617' ? structuredClone(storedRow) : null
		);
	});

	it("serves Frieren's releases instead of queueing a scrape", async () => {
		const res = createMockResponse();

		await handler(createMockRequest({ query }), res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockSaveScrapedResults).not.toHaveBeenCalled();
		const served = results(res);
		expect(served).toHaveLength(50);
		const biggest = [...legacy].sort((a, b) => b.size_bytes - a.size_bytes)[0];
		expect(served[0]).toEqual({
			hash: biggest.hash,
			title: biggest.filename,
			fileSize: biggest.size_bytes,
		});
		for (const r of served) {
			expect(r.title).toMatch(/\S/);
			expect(Number.isFinite(r.fileSize)).toBe(true);
		}
		expect(served.map((r) => r.fileSize)).toEqual(
			[...served.map((r) => r.fileSize)].sort((a, b) => b - a)
		);
	});

	it('pages through the whole row fifty at a time', async () => {
		const pages: string[][] = [];
		for (let page = 0; ; page++) {
			const res = createMockResponse();
			await handler(createMockRequest({ query: { ...query, page: String(page) } }), res);
			const served = results(res);
			if (served.length === 0) break;
			pages.push(served.map((r) => r.hash));
		}

		const unique = new Set(legacy.map((r) => r.hash));
		expect(pages.flat()).toHaveLength(unique.size);
		expect(new Set(pages.flat()).size).toBe(unique.size);
		expect(pages.slice(0, -1).every((p) => p.length === 50)).toBe(true);
	});

	// Card 248: 15 of A Letter to Momo's 86 releases are named in Russian first,
	// the two largest among them, and the page dropped all 15 as the movie and
	// season pages did.
	it("serves A Letter to Momo's releases named in Russian", async () => {
		const momo = recorded.pages.find(
			(p) => p.table === 'ScrapedTrue' && p.key === 'anime:anidb-8270'
		)!.value as Legacy[];
		mockGetAllScrapedTrueResults.mockImplementation(async (key: string) =>
			key === 'anime:anidb-8270' ? structuredClone(momo) : null
		);
		const served: Served[] = [];
		for (let page = 0; ; page++) {
			const res = createMockResponse();
			await handler(
				createMockRequest({
					query: { ...query, animeId: 'anidb-8270', page: String(page) },
				}),
				res
			);
			if (results(res).length === 0) break;
			served.push(...results(res));
		}

		expect(served.map((r) => r.hash).sort()).toEqual(momo.map((r) => r.hash).sort());
		const russian = momo.filter((r) => /^[А-Яа-яЁё]/.test(r.filename));
		expect(russian).toHaveLength(15);
		expect(served[0]).toEqual({
			hash: 'e215072314e15c9c1957433b6f7270f73cf75d5f',
			title: 'Письмо для Момо / Momo e no Tegami / A Letter to Momo [Movie] [RUS(int) · JAP+Sub] [2011 · повседневность · комедия · Blu-ray] [1080p]',
			fileSize: 45352.96,
		});
	});

	// The scrapers' shared pipeline appends `{hash, title, fileSize}` to an
	// existing array, so one row can hold both shapes.
	it('reads the canonical shape alongside the legacy one', async () => {
		const appended = {
			hash: 'ffffffffffffffffffffffffffffffffffffffff',
			title: '[SubsPlease] Sousou no Frieren - 29 (1080p) [00000000].mkv',
			fileSize: 999_999,
		};
		mockGetAllScrapedTrueResults.mockResolvedValue([...structuredClone(legacy), appended]);
		const res = createMockResponse();

		await handler(createMockRequest({ query }), res);

		expect(results(res)[0]).toEqual(appended);
		expect(results(res)[1].title).toBe(
			[...legacy].sort((a, b) => b.size_bytes - a.size_bytes)[0].filename
		);
	});
});
