import { UsenetResult } from '../nzb2rd';
import { DatabaseClient } from './client';

/**
 * Durable cache for Newznab search responses.
 *
 * The indexer meters API calls against a single shared account, and this search
 * runs on every movie and show page of a public site — so the HTTP `s-maxage`
 * hint alone is not enough. A Cloudflare miss, a cold edge PoP, or a restart all
 * turn into real indexer calls. Caching the parsed results in the DB puts a hard
 * floor under that: one call per title per TTL, for every visitor and every
 * instance in the swarm.
 *
 * Stored in the generic `Cache` KV table under an `nzbsearch:v2:` prefix, so this
 * needs no migration — the schema is shared with btdig-scraper and gatekeeper
 * via sync-prisma-schemas.sh, and a new model would have to land in all three.
 *
 * Freshness comes from the row's own `updatedAt`, matching how MetadataCache
 * ages MDBList entries.
 */
export const NZB_SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * An empty result ages out far sooner than a real one.
 *
 * Nothing found is rarely a durable fact: a show mid-season gains releases every
 * week, and the indexer's imdb↔tvdb mapping for a new title gets backfilled days
 * after the premiere. Holding "no results" for the full week outlasts the reason
 * it was empty, and the page keeps saying so long after the search would work.
 * An hour still puts a hard cap on indexer calls per title — which is what the
 * cache is for — while letting a title recover the same day.
 */
export const NZB_SEARCH_EMPTY_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Bump when a change alters what a search *returns*, as opposed to how long an
 * answer keeps. Entries written by the previous code are then unreachable rather
 * than merely old, so the change lands on deploy instead of trickling in over a
 * week as the TTL expires.
 *
 * v2: seasons are keyed on the TVDB id (see buildSearchUrl). Everything written
 * before it holds a season's packs and none of its episodes.
 *
 * v3: results are merged across indexers and their ids are indexer-qualified
 * (`ds:abc123`). A v2 entry holds bare ids and DrunkenSlug-only results, so
 * serving one would both hide altHUB for a week and hand unqualified ids to a
 * two-indexer `fetchNzb`.
 */
const KEY_PREFIX = 'nzbsearch:v3:';

export function nzbSearchCacheKey(imdbId: string, seasonNum?: number): string {
	const base = `${KEY_PREFIX}${imdbId.toLowerCase()}`;
	return seasonNum === undefined ? base : `${base}:s${seasonNum}`;
}

export interface CachedNzbSearch {
	results: UsenetResult[];
	updatedAt: Date;
	/** False for an entry past its TTL — still returned, so it can be served if
	 *  the indexer is unreachable rather than failing the page outright. */
	isFresh: boolean;
}

export function isFresh(
	updatedAt: Date,
	ttlMs: number = NZB_SEARCH_TTL_MS,
	now: number = Date.now()
): boolean {
	return now - updatedAt.getTime() <= ttlMs;
}

export class NzbSearchCacheService extends DatabaseClient {
	async get(
		imdbId: string,
		seasonNum?: number,
		ttlMs: number = NZB_SEARCH_TTL_MS,
		emptyTtlMs: number = NZB_SEARCH_EMPTY_TTL_MS
	): Promise<CachedNzbSearch | null> {
		try {
			const row = await this.prisma.cache.findUnique({
				where: { key: nzbSearchCacheKey(imdbId, seasonNum) },
			});
			if (!row) return null;

			const value = row.value as unknown as { results?: unknown };
			if (!Array.isArray(value?.results)) return null;

			const results = value.results as UsenetResult[];
			return {
				results,
				updatedAt: row.updatedAt,
				isFresh: isFresh(row.updatedAt, results.length === 0 ? emptyTtlMs : ttlMs),
			};
		} catch (error) {
			console.error('Error reading Usenet search cache:', error);
			return null;
		}
	}

	async set(
		imdbId: string,
		seasonNum: number | undefined,
		results: UsenetResult[]
	): Promise<void> {
		const key = nzbSearchCacheKey(imdbId, seasonNum);
		const value = { results } as unknown as object;
		try {
			await this.prisma.cache.upsert({
				where: { key },
				update: { value } as any,
				create: { key, value } as any,
			});
		} catch (error) {
			// A cache write failure must never fail the request it came from.
			console.error('Error writing Usenet search cache:', error);
		}
	}
}
