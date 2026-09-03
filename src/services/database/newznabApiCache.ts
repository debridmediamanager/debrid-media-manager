import { UsenetResult } from '../nzb2rd';
import { DatabaseClient } from './client';

/**
 * Durable cache for the aggregated Newznab API responses.
 *
 * Same job as nzbSearchCache — one upstream call per query per TTL, for every
 * visitor and every instance in the swarm — but a different clock. This endpoint
 * is queried by *arr-style clients that poll the same searches on a schedule, so
 * the cost of a short TTL is paid over and over against a metered account.
 *
 * The TTL therefore scales with the *content*, not with the query: a release
 * posted years ago has no plausible follow-up, while a show that aired this week
 * gains releases daily. See searchTtlMs.
 *
 * Stored in the generic `Cache` KV table under an `nzbapi:v1:` prefix, so this
 * needs no migration — the schema is shared with btdig-scraper and gatekeeper via
 * sync-prisma-schemas.sh, and a new model would have to land in all three.
 */
const KEY_PREFIX = 'nzbapi:v1:';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Calendar years are not needed here — the tiers are coarse by design. */
const YEAR_MS = 365 * DAY_MS;

/**
 * An empty result ages out far sooner than a real one, for the same reason it
 * does in nzbSearchCache: nothing found is rarely a durable fact. A show mid-run
 * gains releases weekly, and an indexer backfills its id mapping days after a
 * premiere. An hour still caps upstream calls per query, which is the point.
 */
export const NEWZNAB_API_EMPTY_TTL_MS = HOUR_MS;

/** No pubDate anywhere in the set — age is unknown, so neither tier applies. */
export const NEWZNAB_API_UNDATED_TTL_MS = 24 * HOUR_MS;

/**
 * How long an answer keeps, from the age of the newest release in it.
 *
 * Pure, and evaluated at *read* time rather than at write time: the entry itself
 * ages while its content does not, so a set whose newest item was 29 days old
 * when written must not keep a 12-hour TTL forever.
 *
 * A future pubDate (an indexer's clock, or a pre-air post) reads as brand new,
 * which is the safe direction — it shortens the TTL.
 */
export function searchTtlMs(newestPubDate: Date | null, now: number = Date.now()): number {
	if (!newestPubDate) return NEWZNAB_API_UNDATED_TTL_MS;

	const age = now - newestPubDate.getTime();
	if (age < 30 * DAY_MS) return 12 * HOUR_MS;
	if (age < 90 * DAY_MS) return 3 * DAY_MS;
	if (age < YEAR_MS) return 7 * DAY_MS;
	if (age < 3 * YEAR_MS) return 21 * DAY_MS;
	return 45 * DAY_MS;
}

/**
 * A result as this cache stores it.
 *
 * `pubDate` is what the TTL is computed from and `category` is what a Newznab
 * client filters on, so both have to survive the round trip — a search served
 * from cache must be indistinguishable from a live one. Named separately from
 * `UsenetResult`, and restating those two fields, because that is a contract of
 * the stored value rather than of the search that produced it.
 */
export type CachedUsenetResult = UsenetResult & { pubDate?: string; category?: string[] };

export interface CachedNewznabApiSearch {
	results: CachedUsenetResult[];
	updatedAt: Date;
	/** False for an entry past its TTL — still returned, so it can be served if
	 *  the indexers are unreachable rather than failing the request outright. */
	isFresh: boolean;
}

export function newznabApiCacheKey(query: string): string {
	return `${KEY_PREFIX}${query}`;
}

/** The most recent parseable pubDate in the set, or null if there is none. */
export function newestPubDate(results: CachedUsenetResult[]): Date | null {
	let newest: number | null = null;
	for (const result of results) {
		if (!result?.pubDate) continue;
		const time = Date.parse(result.pubDate);
		if (!Number.isFinite(time)) continue;
		if (newest === null || time > newest) newest = time;
	}
	return newest === null ? null : new Date(newest);
}

/** The TTL an entry holding these results is entitled to, right now. */
export function ttlForResults(results: CachedUsenetResult[], now: number = Date.now()): number {
	if (results.length === 0) return NEWZNAB_API_EMPTY_TTL_MS;
	return searchTtlMs(newestPubDate(results), now);
}

export function isFresh(updatedAt: Date, ttlMs: number, now: number = Date.now()): boolean {
	return now - updatedAt.getTime() <= ttlMs;
}

export class NewznabApiCacheService extends DatabaseClient {
	/**
	 * `maxTtlMs` caps the age-scaled TTL for queries whose freshness matters more
	 * than their content's age — an *arr RSS sync always carries brand-new
	 * releases, which the age tiers alone would hold for 12h.
	 */
	async get(
		key: string,
		now: number = Date.now(),
		maxTtlMs?: number
	): Promise<CachedNewznabApiSearch | null> {
		try {
			const row = await this.prisma.cache.findUnique({
				where: { key: newznabApiCacheKey(key) },
			});
			if (!row) return null;

			const value = row.value as unknown as { results?: unknown };
			if (!Array.isArray(value?.results)) return null;

			const results = value.results as CachedUsenetResult[];
			const ttlMs = Math.min(ttlForResults(results, now), maxTtlMs ?? Infinity);
			return {
				results,
				updatedAt: row.updatedAt,
				isFresh: isFresh(row.updatedAt, ttlMs, now),
			};
		} catch (error) {
			console.error('Error reading Newznab API cache:', error);
			return null;
		}
	}

	async set(key: string, results: CachedUsenetResult[]): Promise<void> {
		const value = { results } as unknown as object;
		try {
			await this.prisma.cache.upsert({
				where: { key: newznabApiCacheKey(key) },
				update: { value } as any,
				create: { key: newznabApiCacheKey(key), value } as any,
			});
		} catch (error) {
			// A cache write failure must never fail the request it came from.
			console.error('Error writing Newznab API cache:', error);
		}
	}
}
