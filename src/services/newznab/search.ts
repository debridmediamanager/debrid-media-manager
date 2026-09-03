// The search half of the Newznab aggregation endpoint: one client query fanned
// out to every configured upstream, merged, cached, and rewritten so nothing in
// the answer names an upstream.
//
// Three things are load-bearing here and none of them are obvious:
//
//   * The cache holds the FULL merged set for a query, before paging. An *arr
//     walks a result set with `offset`, so caching per page would spend an
//     upstream fan-out on every page of every sync; caching the whole set makes
//     paging free and keeps `total` honest across pages.
//   * Every item is rewritten. The upstream's own id becomes an opaque token and
//     the enclosure points back at this app, because an upstream `link` carries
//     the operator's API key in its `&r=` parameter and even a bare qualified id
//     (`ds:abc123`) names which paid accounts DMM fans out to.
//   * Outbound pacing is checked before an indexer is included, not after it
//     answers. Treasure Maps refuses roughly six rapid calls with its own
//     `Request limit reached`, and Sonarr turns a refusal into a 24h backoff —
//     so an indexer over budget is skipped for this query rather than asked.

import { CachedUsenetResult } from '@/services/database/newznabApiCache';
import { dedupeResults, fanOut, Indexer } from '@/services/nzb2rd';
import { HybridRateLimiter } from '@/services/rateLimit/middlewareRateLimiter';
import { repository as db } from '@/services/repository';
import type { NextApiRequest } from 'next';
import { getUpstreamIndexers, UpstreamIndexer } from './indexers';
import { encryptReleaseId } from './opaqueId';
import { NewznabRssItem } from './xml';

/** The `t` values that reach this module. `caps` and `get` are handled elsewhere. */
export const SEARCH_TYPES = ['search', 'tvsearch', 'movie'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export function isSearchType(value: string): value is SearchType {
	return (SEARCH_TYPES as readonly string[]).includes(value);
}

/** Matches `capsXml`'s `<limits max="100" default="100"/>`. */
export const MAX_LIMIT = 100;

/** Freshness ceiling for untargeted (RSS-sync) queries — see runSearch. */
export const RSS_TTL_MS = 15 * 60 * 1000;

/**
 * What every upstream is asked for, regardless of what the client asked for.
 *
 * The client's `limit` pages the merged set; the upstreams are always asked for
 * a full page, so a client asking for 10 does not poison the cache with a set
 * the next client cannot page past.
 */
const UPSTREAM_LIMIT = 100;

const DIGITS = /^\d+$/;
/** `cat` is a comma-separated id list — forwarded verbatim once it validates. */
const CATEGORY_LIST = /^\d+(?:,\d+)*$/;

export type NewznabQuery = NextApiRequest['query'] & { apikey?: string | string[] };

export interface NormalizedSearch {
	/** Exactly what is forwarded upstream and hashed into the cache key. */
	params: Record<string, string>;
	limit: number;
	offset: number;
}

export interface SearchPage {
	items: NewznabRssItem[];
	offset: number;
	/** The whole merged set, not this page — a client pages until it reaches it. */
	total: number;
}

function firstValue(value: string | string[] | undefined): string {
	const raw = Array.isArray(value) ? value[0] : value;
	return typeof raw === 'string' ? raw.trim() : '';
}

function integer(raw: string, min: number, max: number, fallback: number | null): number | null {
	if (!DIGITS.test(raw)) return fallback;
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value)) return fallback;
	return Math.min(Math.max(value, min), max);
}

/**
 * The public origin this app's own grab URLs are built against.
 *
 * Never `req.headers.host`: the enclosure URL is stored by the *arr and replayed
 * for days, so a request that arrived on an internal hostname would mint links
 * only reachable from inside the tailnet — and a spoofed Host header would mint
 * links pointing at someone else's server.
 */
export function getPublicBase(): string {
	return (process.env.NEWZNAB_PUBLIC_BASE || 'https://debridmediamanager.com').replace(
		/\/+$/,
		''
	);
}

/** This app's own grab route for one release, carrying the caller's own key. */
export function grabUrl(token: string, apiKey: string): string {
	const params = new URLSearchParams({ t: 'get', id: token, apikey: apiKey });
	return `${getPublicBase()}/api/newznab/api?${params}`;
}

/**
 * Reads the client's query into the small set of parameters this endpoint
 * forwards, dropping anything malformed rather than passing it on.
 *
 * `imdbid` loses its `tt` prefix: House-of-Usenet and NinjaCentral both return
 * zero results for `tt0111161` and the right ones for `0111161`, which reads as
 * a broken indexer rather than as a malformed query. Every upstream accepts the
 * bare form, so it is sent unconditionally.
 */
export function normalizeSearchQuery(query: NewznabQuery): NormalizedSearch {
	const params: Record<string, string> = {};

	const q = firstValue(query.q);
	if (q) params.q = q;

	const cat = firstValue(query.cat);
	if (CATEGORY_LIST.test(cat)) params.cat = cat;

	for (const name of ['season', 'ep'] as const) {
		const value = integer(firstValue(query[name]), 0, Number.MAX_SAFE_INTEGER, null);
		if (value !== null) params[name] = String(value);
	}

	const imdbid = firstValue(query.imdbid).replace(/^tt/i, '');
	if (DIGITS.test(imdbid)) params.imdbid = imdbid;

	const tvdbid = firstValue(query.tvdbid);
	if (DIGITS.test(tvdbid)) params.tvdbid = tvdbid;

	return {
		params,
		limit: integer(firstValue(query.limit), 1, MAX_LIMIT, MAX_LIMIT) ?? MAX_LIMIT,
		offset: integer(firstValue(query.offset), 0, Number.MAX_SAFE_INTEGER, 0) ?? 0,
	};
}

/**
 * The cache key for a query.
 *
 * Sorted, so `?q=x&cat=5000` and `?cat=5000&q=x` share an entry. `limit` and
 * `offset` are deliberately absent: the entry holds the full merged set, so
 * every page of a result set is served from the one entry the first page wrote.
 */
export function searchCacheKey(t: string, params: Record<string, string>): string {
	const parts = Object.keys(params)
		.sort()
		.map((name) => `${name}=${params[name]}`);
	return `${t}:${parts.join('&')}`;
}

function buildUpstreamUrl(
	indexer: UpstreamIndexer,
	t: string,
	params: Record<string, string>
): string {
	const search = new URLSearchParams({
		t,
		o: 'json',
		extended: '1',
		limit: String(UPSTREAM_LIMIT),
	});
	// A keyless entry (AnimeTosho's .org mirror) has an empty apiKey, and sending
	// `apikey=` is not the same as sending nothing on every server.
	if (!indexer.keyless) search.set('apikey', indexer.apiKey);
	for (const [name, value] of Object.entries(params)) search.set(name, value);
	return `${indexer.url}?${search}`;
}

// Its own limiter instance rather than `checkRateLimitFor`: that one writes the
// X-RateLimit-* headers, which belong to the caller's own budget. These counters
// pace DMM against an upstream and must never appear in a client's response.
let upstreamLimiter: HybridRateLimiter | null = null;

function getUpstreamLimiter(): HybridRateLimiter {
	if (!upstreamLimiter) upstreamLimiter = new HybridRateLimiter(process.env.REDIS_URL);
	return upstreamLimiter;
}

/** Test-only: the limiter is a module singleton and its counters outlive a test. */
export function _resetUpstreamLimiterForTest(): void {
	upstreamLimiter = null;
}

/**
 * The indexers this query may actually be sent to.
 *
 * An indexer with no measured quota has no `pacing` and is always included — a
 * guessed cap is worse than none. One over its budget is skipped for this query,
 * which costs coverage on one search rather than the day-long backoff an *arr
 * applies when an indexer answers `Request limit reached`.
 */
async function pacedIndexers(indexers: UpstreamIndexer[]): Promise<UpstreamIndexer[]> {
	const verdicts = await Promise.all(
		indexers.map(async (indexer) => {
			if (!indexer.pacing) return true;
			const { success } = await getUpstreamLimiter().check(`upstream:${indexer.prefix}`, {
				name: `upstream-${indexer.prefix}`,
				rateLimit: indexer.pacing.rateLimit,
				windowSeconds: indexer.pacing.windowSeconds,
			});
			if (!success) {
				console.warn(`Newznab: skipping ${indexer.name}, over its configured pacing`);
			}
			return success;
		})
	);
	return indexers.filter((_, index) => verdicts[index]);
}

/**
 * One merged result as an RSS item, or null when its id cannot be routed back
 * to an indexer (which would make the guid ungrabbable).
 *
 * The id arrives indexer-qualified from `fanOut` (`ds:abc123`); the prefix and
 * the native id go into the opaque token and neither survives into the feed.
 */
function toRssItem(result: CachedUsenetResult, apiKey: string): NewznabRssItem | null {
	const split = result.id.indexOf(':');
	if (split <= 0) return null;

	const prefix = result.id.slice(0, split);
	const nativeId = result.id.slice(split + 1);
	if (!nativeId) return null;

	const token = encryptReleaseId(prefix, nativeId);
	const item: NewznabRssItem = {
		title: result.title,
		// The guid IS the grab token. Deterministic encryption keeps it stable
		// across syncs, which is what stops an *arr re-grabbing every release.
		guid: token,
		size: result.size,
		enclosureUrl: grabUrl(token, apiKey),
	};
	if (result.pubDate) item.pubDate = result.pubDate;
	if (result.category?.length) item.category = result.category;
	return item;
}

function toPage(
	results: CachedUsenetResult[],
	apiKey: string,
	{ limit, offset }: { limit: number; offset: number }
): SearchPage {
	const items = results
		.slice(offset, offset + limit)
		.flatMap((result) => toRssItem(result, apiKey) ?? []);
	return { items, offset, total: results.length };
}

/**
 * Runs one client search across every upstream indexer.
 *
 * `query` is the request's own query object with `apikey` guaranteed present —
 * the caller resolves it (a client may have authenticated by header), and it
 * goes into the enclosure URLs so the *arr's later grab arrives authenticated.
 * It is not part of the cache key: one sponsor's search serves every sponsor's.
 *
 * A total upstream outage falls back to a stale cache entry rather than
 * answering empty: an *arr reads an empty feed as "this release is gone".
 */
export async function runSearch(t: string, query: NewznabQuery): Promise<SearchPage> {
	const { params, limit, offset } = normalizeSearchQuery(query);
	const apiKey = firstValue(query.apikey);
	const key = searchCacheKey(t, params);

	// A query naming no title or id is an *arr RSS sync — "what's new" — whose
	// results are always freshly posted, so the age-scaled tiers would hold it
	// for 12h and every sponsor would see new releases half a day late. Cap it.
	const targeted =
		params.q !== undefined || params.imdbid !== undefined || params.tvdbid !== undefined;
	const cached = await db.getCachedNewznabApiSearch(key, targeted ? undefined : RSS_TTL_MS);
	if (cached?.isFresh) return toPage(cached.results, apiKey, { limit, offset });

	const indexers = await pacedIndexers(getUpstreamIndexers());
	const { ok, lists } = await fanOut(
		// `fanOut` types its callback on the narrower Indexer; every element it
		// passes back is one of the UpstreamIndexers handed in just above.
		(indexer: Indexer) => buildUpstreamUrl(indexer as UpstreamIndexer, t, params),
		`newznab ${t}`,
		indexers
	);

	if (!ok) {
		// Nothing answered — including the case where every indexer was over its
		// pacing budget. Whatever is cached, however old, beats an empty feed.
		if (cached) return toPage(cached.results, apiKey, { limit, offset });
		return { items: [], offset, total: 0 };
	}

	const merged = dedupeResults(lists) as CachedUsenetResult[];
	// Written even when empty: an hour of "nothing found" is the whole point of
	// the empty TTL, and it is what caps upstream calls for a query nobody can
	// satisfy. `set` swallows its own failures.
	await db.setCachedNewznabApiSearch(key, merged);
	return toPage(merged, apiKey, { limit, offset });
}
