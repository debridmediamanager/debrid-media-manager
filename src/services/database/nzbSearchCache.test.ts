import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isFresh,
	NZB_SEARCH_EMPTY_TTL_MS,
	NZB_SEARCH_TTL_MS,
	nzbSearchCacheKey,
	NzbSearchCacheService,
} from './nzbSearchCache';

vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn(() => ({
		cache: {
			upsert: vi.fn(),
			findUnique: vi.fn(),
			findMany: vi.fn(),
			delete: vi.fn(),
		},
		$disconnect: vi.fn(),
	})),
}));

const RESULTS = [{ id: 'a', title: 'Some.Release', size: 100 }];
const NOW = 1_700_000_000_000;
const ago = (ms: number) => new Date(NOW - ms);

describe('nzbSearchCacheKey', () => {
	it('separates a movie from a season of a show', () => {
		expect(nzbSearchCacheKey('tt1418646')).toBe('nzbsearch:v2:tt1418646');
		expect(nzbSearchCacheKey('tt0944947', 2)).toBe('nzbsearch:v2:tt0944947:s2');
	});

	it('keeps season 0 distinct from no season at all', () => {
		expect(nzbSearchCacheKey('tt0944947', 0)).toBe('nzbsearch:v2:tt0944947:s0');
		expect(nzbSearchCacheKey('tt0944947', 0)).not.toBe(nzbSearchCacheKey('tt0944947'));
	});

	it('lowercases so casing cannot split one title across two entries', () => {
		expect(nzbSearchCacheKey('TT1418646')).toBe('nzbsearch:v2:tt1418646');
	});

	// Entries written before seasons were keyed on the TVDB id hold a season's
	// packs and none of its episodes. Reading one back would serve exactly the bug
	// the fix removes, for as long as its week-long TTL has left to run.
	it('cannot read an entry written by the previous version', () => {
		expect(nzbSearchCacheKey('tt27497393', 1)).not.toBe('nzbsearch:tt27497393:s1');
		expect(nzbSearchCacheKey('tt27497393', 1).startsWith('nzbsearch:v2:')).toBe(true);
	});
});

describe('isFresh', () => {
	it('holds for a full week and lapses after it', () => {
		expect(NZB_SEARCH_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
		expect(isFresh(ago(0), NZB_SEARCH_TTL_MS, NOW)).toBe(true);
		expect(isFresh(ago(NZB_SEARCH_TTL_MS - 1), NZB_SEARCH_TTL_MS, NOW)).toBe(true);
		expect(isFresh(ago(NZB_SEARCH_TTL_MS), NZB_SEARCH_TTL_MS, NOW)).toBe(true);
		expect(isFresh(ago(NZB_SEARCH_TTL_MS + 1), NZB_SEARCH_TTL_MS, NOW)).toBe(false);
	});
});

describe('NzbSearchCacheService', () => {
	let service: NzbSearchCacheService;
	let prisma: any;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new NzbSearchCacheService();
		prisma = (service as any).prisma;
	});

	it('returns a recent entry as fresh', async () => {
		prisma.cache.findUnique.mockResolvedValue({
			key: 'nzbsearch:v2:tt1418646',
			value: { results: RESULTS },
			updatedAt: new Date(Date.now() - 1000),
		});

		const hit = await service.get('tt1418646');
		expect(prisma.cache.findUnique).toHaveBeenCalledWith({
			where: { key: 'nzbsearch:v2:tt1418646' },
		});
		expect(hit?.isFresh).toBe(true);
		expect(hit?.results).toEqual(RESULTS);
	});

	it('still returns an expired entry, marked stale, so it can be a fallback', async () => {
		prisma.cache.findUnique.mockResolvedValue({
			key: 'nzbsearch:v2:tt1418646',
			value: { results: RESULTS },
			updatedAt: new Date(Date.now() - NZB_SEARCH_TTL_MS - 60_000),
		});

		const hit = await service.get('tt1418646');
		expect(hit?.isFresh).toBe(false);
		expect(hit?.results).toEqual(RESULTS);
	});

	it('returns null for a miss or a malformed row', async () => {
		prisma.cache.findUnique.mockResolvedValue(null);
		expect(await service.get('tt1418646')).toBeNull();

		prisma.cache.findUnique.mockResolvedValue({
			key: 'nzbsearch:v2:tt1418646',
			value: { nonsense: true },
			updatedAt: new Date(),
		});
		expect(await service.get('tt1418646')).toBeNull();
	});

	it('never throws a read failure into the caller', async () => {
		prisma.cache.findUnique.mockRejectedValue(new Error('db down'));
		expect(await service.get('tt1418646')).toBeNull();
	});

	it('upserts under the season-scoped key', async () => {
		await service.set('tt0944947', 3, RESULTS);
		const call = prisma.cache.upsert.mock.calls[0][0];
		expect(call.where).toEqual({ key: 'nzbsearch:v2:tt0944947:s3' });
		expect(call.create.value).toEqual({ results: RESULTS });
	});

	it('never throws a write failure into the request that triggered it', async () => {
		prisma.cache.upsert.mockRejectedValue(new Error('db down'));
		await expect(service.set('tt1418646', undefined, RESULTS)).resolves.toBeUndefined();
	});

	// An empty answer is usually temporary — a mid-season show gains releases
	// weekly, and the indexer backfills its id mapping days after a premiere.
	// Holding it for the full week keeps saying "nothing found" long after the
	// search would have worked.
	describe('empty results age out early', () => {
		const emptyRow = (ageMs: number) => ({
			key: 'nzbsearch:v2:tt27497393:s1',
			value: { results: [] },
			updatedAt: new Date(Date.now() - ageMs),
		});

		it('keeps an empty entry only for the short TTL', async () => {
			prisma.cache.findUnique.mockResolvedValue(emptyRow(NZB_SEARCH_EMPTY_TTL_MS - 60_000));
			expect((await service.get('tt27497393', 1))?.isFresh).toBe(true);

			prisma.cache.findUnique.mockResolvedValue(emptyRow(NZB_SEARCH_EMPTY_TTL_MS + 60_000));
			const stale = await service.get('tt27497393', 1);
			expect(stale?.isFresh).toBe(false);
			expect(stale?.results).toEqual([]);
		});

		it('is shorter than the TTL a real result gets', async () => {
			expect(NZB_SEARCH_EMPTY_TTL_MS).toBeLessThan(NZB_SEARCH_TTL_MS);

			const age = NZB_SEARCH_EMPTY_TTL_MS + 60_000;
			prisma.cache.findUnique.mockResolvedValue({
				key: 'nzbsearch:v2:tt27497393:s1',
				value: { results: RESULTS },
				updatedAt: new Date(Date.now() - age),
			});
			expect((await service.get('tt27497393', 1))?.isFresh).toBe(true);
		});
	});
});
