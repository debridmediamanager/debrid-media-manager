// The upstream indexers the aggregation endpoint fans a search out to.
//
// Deliberately separate from `getIndexers()` in @/services/nzb2rd: that list is
// what the Usenet section of a media page searches, hard-codes two servers and
// exists to feed nzb2rd. This one lives in the `NewznabIndexer` table, edited at
// `/admin/newznab`, so a sponsor-facing aggregator can carry the whole *arr
// indexer fleet without a code change or a redeploy. The `NEWZNAB_INDEXERS` env
// JSON is the fallback while that table is empty. Every field here is a secret —
// an entry's `url` and `apiKey` name an account the whole site shares, so
// nothing in this module may reach the browser.

import type { NewznabIndexerRow } from '@/services/database/newznabIndexers';
import { NewznabIndexerService } from '@/services/database/newznabIndexers';
import { getIndexers, Indexer } from '@/services/nzb2rd';

/**
 * One upstream Newznab server. `url` is the FULL API endpoint
 * (`https://drunkenslug.com/api`), not a host — the indexers here disagree on
 * the path (House-of-Usenet answers on `/api/v1/api`), so there is no prefix
 * this code could append.
 *
 * `prefix` is baked into every opaque release id this indexer produces, so it
 * is a stored value: changing one invalidates the guids already handed to a
 * client, and an *arr dedupes by guid.
 */
export interface UpstreamIndexer extends Indexer {
	/**
	 * Set when the server searches without a key (AnimeTosho's `.org` mirror).
	 * Without it an entry with an empty `apiKey` is dropped, which is what keeps
	 * a half-filled config from silently querying a server as an anonymous user.
	 */
	keyless?: boolean;
	/**
	 * Per-indexer pacing, when the operator has measured one. Shaped like a
	 * RateLimitConfig so a caller can hand it straight to the limiter; left
	 * unset when the quota is unknown, because a guessed cap is worse than none.
	 */
	pacing?: { rateLimit: number; windowSeconds: number };
	/**
	 * How many NZBs DMM may fetch from this indexer per window, across every
	 * sponsor. For an account whose download allowance is shared with other
	 * consumers, so the aggregator can be held to its part of it. Only upstream
	 * fetches count; a grab the NZB store answers never reaches the indexer.
	 */
	grabLimit?: { rateLimit: number; windowSeconds: number };
}

/**
 * Parsed once per process. The env var is read inside the accessor rather than
 * at module scope: Next.js evaluates a module before the runtime env is in
 * place on some deploy paths, so a top-level read sees undefined for the life
 * of the process.
 */
let cachedIndexers: UpstreamIndexer[] | null = null;
let warnedAboutMalformedConfig = false;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLimit(value: unknown): UpstreamIndexer['pacing'] {
	if (!isRecord(value)) return undefined;
	const { rateLimit, windowSeconds } = value;
	if (typeof rateLimit !== 'number' || !Number.isFinite(rateLimit) || rateLimit <= 0) {
		return undefined;
	}
	if (
		typeof windowSeconds !== 'number' ||
		!Number.isFinite(windowSeconds) ||
		windowSeconds <= 0
	) {
		return undefined;
	}
	return { rateLimit, windowSeconds };
}

function toIndexer(entry: unknown): UpstreamIndexer | null {
	if (!isRecord(entry)) return null;

	const prefix = typeof entry.prefix === 'string' ? entry.prefix.trim() : '';
	const url = typeof entry.url === 'string' ? entry.url.trim() : '';
	if (!prefix || !url) return null;

	const apiKey = typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '';
	const keyless = entry.keyless === true;
	// A missing key is a misconfiguration, not a keyless server: dropping the
	// entry keeps the aggregator working on the indexers that are configured
	// instead of sending every search to a server that will answer 100/101.
	if (!apiKey && !keyless) return null;

	const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : prefix;
	const pacing = parseLimit(entry.pacing);
	const grabLimit = parseLimit(entry.grabLimit);

	const indexer: UpstreamIndexer = {
		prefix,
		name,
		url: url.replace(/\/+$/, ''),
		apiKey,
	};
	if (keyless) indexer.keyless = true;
	if (pacing) indexer.pacing = pacing;
	if (grabLimit) indexer.grabLimit = grabLimit;
	return indexer;
}

function parseConfig(raw: string): UpstreamIndexer[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;

	const indexers: UpstreamIndexer[] = [];
	for (const entry of parsed) {
		const indexer = toIndexer(entry);
		if (!indexer) continue;
		// The prefix is how an opaque release id routes back to its indexer, so a
		// duplicate would make a token ambiguous. First one wins, matching the
		// priority order the operator wrote.
		if (indexers.some((existing) => existing.prefix === indexer.prefix)) continue;
		indexers.push(indexer);
	}
	return indexers;
}

/**
 * Every upstream indexer, in the order the operator configured them.
 *
 * Falls back to the media-page indexer list when `NEWZNAB_INDEXERS` is unset or
 * unparseable — a dev convenience, so a local checkout with only
 * NEWZNAB_API_KEY set still returns results. A malformed value is logged once
 * rather than per request; the endpoint is polled on a timer by every client.
 */
export function getUpstreamIndexers(): UpstreamIndexer[] {
	if (cachedIndexers !== null) return cachedIndexers;

	const raw = (process.env.NEWZNAB_INDEXERS || '').trim();
	if (!raw) {
		cachedIndexers = getIndexers();
		return cachedIndexers;
	}

	const parsed = parseConfig(raw);
	if (parsed === null) {
		if (!warnedAboutMalformedConfig) {
			warnedAboutMalformedConfig = true;
			console.error(
				'NEWZNAB_INDEXERS is not a JSON array — falling back to the media-page indexers'
			);
		}
		cachedIndexers = getIndexers();
		return cachedIndexers;
	}

	cachedIndexers = parsed;
	return cachedIndexers;
}

/**
 * A table row as an upstream indexer, through the same checks as an env entry,
 * so a row the admin page let through half-filled is dropped rather than asked.
 */
export function rowToIndexer(row: NewznabIndexerRow): UpstreamIndexer | null {
	return toIndexer({
		prefix: row.prefix,
		name: row.name,
		url: row.url,
		apiKey: row.apiKey,
		keyless: row.keyless,
		pacing: { rateLimit: row.pacingRate, windowSeconds: row.pacingWindow },
		grabLimit: { rateLimit: row.grabRate, windowSeconds: row.grabWindow },
	});
}

/** How long one instance trusts its copy of the table; the admin page's own instance clears it on save. */
export const DB_INDEXERS_TTL_MS = 30_000;

// `indexers` null = the table is empty, so the env list applies.
let dbIndexers: { at: number; indexers: UpstreamIndexer[] | null } | null = null;
let dbRead: Promise<UpstreamIndexer[]> | null = null;
let indexerService: NewznabIndexerService | null = null;

async function readTable(): Promise<UpstreamIndexer[]> {
	try {
		indexerService ??= new NewznabIndexerService();
		const rows = await indexerService.listIndexers();
		const indexers =
			Array.isArray(rows) && rows.length > 0
				? rows
						.filter((row) => row.enabled)
						.map(rowToIndexer)
						.filter((indexer): indexer is UpstreamIndexer => indexer !== null)
				: null;
		dbIndexers = { at: Date.now(), indexers };
	} catch (error) {
		// Keep serving the last list read; with none, the env list. Retried after
		// the TTL rather than on every search while the database is down.
		console.error('Newznab indexers: reading the table failed, keeping the last list:', error);
		dbIndexers = { at: Date.now(), indexers: dbIndexers?.indexers ?? null };
	}
	return dbIndexers.indexers ?? getUpstreamIndexers();
}

/**
 * The enabled upstream indexers, in the order the admin page set: the
 * `NewznabIndexer` table, read at most every 30 s per instance, or the env
 * list while the table has no rows. A disabled indexer is neither searched nor
 * grabbed from; its stored NZBs are still served.
 */
export async function loadUpstreamIndexers(): Promise<UpstreamIndexer[]> {
	if (dbIndexers && Date.now() - dbIndexers.at < DB_INDEXERS_TTL_MS) {
		return dbIndexers.indexers ?? getUpstreamIndexers();
	}
	dbRead ??= readTable().finally(() => {
		dbRead = null;
	});
	return dbRead;
}

/** After an admin save, so this instance reads the table again on its next request. */
export function invalidateUpstreamIndexers(): void {
	dbIndexers = null;
}

/** Clears the per-process memos. Tests only. */
export function _resetUpstreamIndexersForTest(): void {
	cachedIndexers = null;
	warnedAboutMalformedConfig = false;
	dbIndexers = null;
	dbRead = null;
	indexerService = null;
}
