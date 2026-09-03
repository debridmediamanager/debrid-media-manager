import {
	newestPubDate,
	NEWZNAB_API_EMPTY_TTL_MS,
	NEWZNAB_API_UNDATED_TTL_MS,
	newznabApiCacheKey,
	NewznabApiCacheService,
	searchTtlMs,
	type CachedUsenetResult,
} from '@/services/database/newznabApiCache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

const NOW = Date.UTC(2026, 8, 3);
const agedDays = (days: number) => new Date(NOW - days * DAY);

const result = (pubDate?: string): CachedUsenetResult => ({
	id: 'ds:abc123',
	title: 'Some.Release.1080p',
	size: 1024,
	...(pubDate ? { pubDate } : {}),
});

describe('searchTtlMs', () => {
	// The tiers exist because the cost of a stale answer is not symmetric: a show
	// that aired this week gains releases daily, while a 2019 film's result set is
	// finished. A flat TTL either re-queries a metered account for nothing or
	// hides this week's releases.
	it('holds a set of this month for 12 hours', () => {
		expect(searchTtlMs(agedDays(0), NOW)).toBe(12 * HOUR);
		expect(searchTtlMs(agedDays(29), NOW)).toBe(12 * HOUR);
	});

	it('steps up at 30 days', () => {
		expect(searchTtlMs(agedDays(30), NOW)).toBe(3 * DAY);
		expect(searchTtlMs(agedDays(31), NOW)).toBe(3 * DAY);
		expect(searchTtlMs(agedDays(89), NOW)).toBe(3 * DAY);
	});

	it('steps up at 90 days', () => {
		expect(searchTtlMs(agedDays(90), NOW)).toBe(7 * DAY);
		expect(searchTtlMs(agedDays(91), NOW)).toBe(7 * DAY);
		expect(searchTtlMs(new Date(NOW - YEAR + 1), NOW)).toBe(7 * DAY);
	});

	it('steps up at a year', () => {
		expect(searchTtlMs(new Date(NOW - YEAR), NOW)).toBe(21 * DAY);
		expect(searchTtlMs(new Date(NOW - YEAR - DAY), NOW)).toBe(21 * DAY);
		expect(searchTtlMs(new Date(NOW - 3 * YEAR + 1), NOW)).toBe(21 * DAY);
	});

	it('steps up at three years and stops there', () => {
		expect(searchTtlMs(new Date(NOW - 3 * YEAR), NOW)).toBe(45 * DAY);
		expect(searchTtlMs(new Date(NOW - 20 * YEAR), NOW)).toBe(45 * DAY);
	});

	// An indexer with a fast clock, or a pre-air post, would otherwise buy itself
	// the longest TTL of all by being "older than three years" in the negative.
	it('treats a future date as brand new, not ancient', () => {
		expect(searchTtlMs(new Date(NOW + 2 * DAY), NOW)).toBe(12 * HOUR);
	});

	it('falls back to a day when nothing carries a date', () => {
		expect(searchTtlMs(null, NOW)).toBe(NEWZNAB_API_UNDATED_TTL_MS);
		expect(NEWZNAB_API_UNDATED_TTL_MS).toBe(24 * HOUR);
	});
});

describe('newestPubDate', () => {
	it('takes the newest of the set and ignores unparseable and missing dates', () => {
		const newest = newestPubDate([
			result('Mon, 01 Jan 2018 00:00:00 +0000'),
			result('not a date'),
			result(),
			result('Mon, 05 Aug 2024 12:00:00 +0000'),
		]);
		expect(newest?.toISOString()).toBe('2024-08-05T12:00:00.000Z');
	});

	it('is null when no item carries a usable date', () => {
		expect(newestPubDate([result(), result('nonsense')])).toBeNull();
	});
});

describe('NewznabApiCacheService', () => {
	let service: NewznabApiCacheService;
	let prisma: any;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new NewznabApiCacheService();
		prisma = (service as any).prisma;
	});

	const row = (results: CachedUsenetResult[], ageMs: number) => ({
		key: newznabApiCacheKey('q'),
		value: { results },
		updatedAt: new Date(NOW - ageMs),
	});

	it('reads under the versioned prefix', async () => {
		prisma.cache.findUnique.mockResolvedValue(row([result()], 0));
		await service.get('movie:tt1418646', NOW);
		expect(prisma.cache.findUnique).toHaveBeenCalledWith({
			where: { key: 'nzbapi:v1:movie:tt1418646' },
		});
	});

	// Freshness is computed at read time from the content's own age, so a set of
	// decade-old releases keeps for weeks while a set from this week does not
	// survive the night.
	it('keeps an entry of old content fresh a month after it was written', async () => {
		prisma.cache.findUnique.mockResolvedValue(
			row([result('Mon, 01 Jan 2018 00:00:00 +0000')], 30 * DAY)
		);
		const hit = await service.get('q', NOW);
		expect(hit?.isFresh).toBe(true);
		expect(hit?.results).toHaveLength(1);
	});

	it('lets an entry of recent content go stale after thirteen hours', async () => {
		const recent = result(new Date(NOW - 2 * DAY).toUTCString());
		prisma.cache.findUnique.mockResolvedValue(row([recent], 13 * HOUR));
		expect((await service.get('q', NOW))?.isFresh).toBe(false);

		prisma.cache.findUnique.mockResolvedValue(row([recent], 11 * HOUR));
		expect((await service.get('q', NOW))?.isFresh).toBe(true);
	});

	// "Nothing found" is rarely durable — a mid-run show gains releases weekly and
	// an indexer backfills its id mapping days after a premiere.
	it('ages an empty set out within the hour', async () => {
		prisma.cache.findUnique.mockResolvedValue(row([], NEWZNAB_API_EMPTY_TTL_MS - 60_000));
		expect((await service.get('q', NOW))?.isFresh).toBe(true);

		prisma.cache.findUnique.mockResolvedValue(row([], NEWZNAB_API_EMPTY_TTL_MS + 60_000));
		const stale = await service.get('q', NOW);
		expect(stale?.isFresh).toBe(false);
		expect(stale?.results).toEqual([]);
	});

	// Stale is still served: the fallback is a live indexer call, and an outage
	// there must not turn into an error for the client.
	it('returns a stale entry rather than nothing', async () => {
		prisma.cache.findUnique.mockResolvedValue(row([result()], 10 * DAY));
		const hit = await service.get('q', NOW);
		expect(hit?.isFresh).toBe(false);
		expect(hit?.results).toHaveLength(1);
	});

	it('returns null for a miss or a malformed row', async () => {
		prisma.cache.findUnique.mockResolvedValue(null);
		expect(await service.get('q', NOW)).toBeNull();

		prisma.cache.findUnique.mockResolvedValue({
			key: newznabApiCacheKey('q'),
			value: { nonsense: true },
			updatedAt: new Date(NOW),
		});
		expect(await service.get('q', NOW)).toBeNull();
	});

	it('never throws a read failure into the caller', async () => {
		prisma.cache.findUnique.mockRejectedValue(new Error('db down'));
		expect(await service.get('q', NOW)).toBeNull();
	});

	it('upserts the results under the prefixed key', async () => {
		const results = [result('Mon, 05 Aug 2024 12:00:00 +0000')];
		await service.set('movie:tt1418646', results);
		const call = prisma.cache.upsert.mock.calls[0][0];
		expect(call.where).toEqual({ key: 'nzbapi:v1:movie:tt1418646' });
		expect(call.create).toEqual({ key: 'nzbapi:v1:movie:tt1418646', value: { results } });
		// pubDate has to survive the round trip — it is what the TTL is read from.
		expect(call.create.value.results[0].pubDate).toBe('Mon, 05 Aug 2024 12:00:00 +0000');
	});

	it('never throws a write failure into the request that triggered it', async () => {
		prisma.cache.upsert.mockRejectedValue(new Error('db down'));
		await expect(service.set('q', [result()])).resolves.toBeUndefined();
	});

	// An *arr RSS sync (no q/imdbid/tvdbid) always holds freshly posted releases,
	// which the age tiers alone would cache for 12h — new releases would reach
	// sponsors half a day late. runSearch passes RSS_TTL_MS as the cap for those.
	describe('maxTtlMs cap', () => {
		const freshRow = (ageMs: number) => ({
			key: newznabApiCacheKey('q'),
			value: { results: [result(new Date(NOW - HOUR).toUTCString())] },
			updatedAt: new Date(NOW - ageMs),
		});

		it('an entry fresh under its age tier goes stale under a shorter cap', async () => {
			prisma.cache.findUnique.mockResolvedValue(freshRow(HOUR));
			expect((await service.get('q', NOW))?.isFresh).toBe(true);
			expect((await service.get('q', NOW, 15 * 60 * 1000))?.isFresh).toBe(false);
		});

		it('an entry younger than the cap stays fresh', async () => {
			prisma.cache.findUnique.mockResolvedValue(freshRow(10 * 60 * 1000));
			expect((await service.get('q', NOW, 15 * 60 * 1000))?.isFresh).toBe(true);
		});

		it('a cap longer than the age tier does not extend freshness', async () => {
			prisma.cache.findUnique.mockResolvedValue(freshRow(13 * HOUR));
			expect((await service.get('q', NOW, 100 * DAY))?.isFresh).toBe(false);
		});
	});
});
