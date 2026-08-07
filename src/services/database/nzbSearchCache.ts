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
 * Stored in the generic `Cache` KV table under an `nzbsearch:` prefix, so this
 * needs no migration — the schema is shared with btdig-scraper and gatekeeper
 * via sync-prisma-schemas.sh, and a new model would have to land in all three.
 *
 * Freshness comes from the row's own `updatedAt`, matching how MetadataCache
 * ages MDBList entries.
 */
export const NZB_SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const KEY_PREFIX = 'nzbsearch:';

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
		ttlMs: number = NZB_SEARCH_TTL_MS
	): Promise<CachedNzbSearch | null> {
		try {
			const row = await this.prisma.cache.findUnique({
				where: { key: nzbSearchCacheKey(imdbId, seasonNum) },
			});
			if (!row) return null;

			const value = row.value as unknown as { results?: unknown };
			if (!Array.isArray(value?.results)) return null;

			return {
				results: value.results as UsenetResult[],
				updatedAt: row.updatedAt,
				isFresh: isFresh(row.updatedAt, ttlMs),
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
