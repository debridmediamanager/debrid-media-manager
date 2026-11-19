import { subtitleLanguagesOfRelease } from '@/utils/subtitleLanguages';

// The subtitle languages of search results, asked of /api/library/mediainfo (the
// stored probes a DMM page may read without a provider login) for the hashes on
// the page once its results have rendered, and kept in localStorage by hash so a
// release is asked about once. A hash with no stored probe is kept too, for less
// time: zurg may probe it any day, while a stored probe of a release only gains files.

/** Hashes per request; the route's own ceiling. */
export const MEDIAINFO_BATCH = 100;
const ROUTE = '/api/library/mediainfo';
/** Refusals per batch before it is given up; the route allows ten calls a minute. */
const MAX_REFUSALS = 3;

export const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MISS_TTL_MS = 12 * 60 * 60 * 1000;
/** Entries kept; past it the soonest to expire are dropped first. */
export const MAX_ENTRIES = 5000;
export const STORAGE_KEY = 'dmm:subtitleLanguages';

/** languages (null when the hash has no stored probe) and when the entry expires. */
type Entry = [string[] | null, number];
type Store = Record<string, Entry>;

export interface CacheDeps {
	storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
	now?: () => number;
}

function storageOf(deps: CacheDeps) {
	if (deps.storage !== undefined) return deps.storage;
	try {
		return typeof window === 'undefined' ? null : window.localStorage;
	} catch {
		return null;
	}
}

function readStore(deps: CacheDeps): Store {
	try {
		const raw = storageOf(deps)?.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : {};
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? parsed
			: {};
	} catch {
		return {};
	}
}

function writeStore(store: Store, deps: CacheDeps) {
	const now = (deps.now ?? Date.now)();
	let entries = Object.entries(store).filter(([, [, expires]]) => expires > now);
	if (entries.length > MAX_ENTRIES) {
		entries = entries.sort((a, b) => b[1][1] - a[1][1]).slice(0, MAX_ENTRIES);
	}
	try {
		storageOf(deps)?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
	} catch {
		// a full or blocked storage only costs asking again next visit
	}
}

/**
 * What the cache already knows of `hashes`: `known` holds each hash with a stored
 * probe and its languages, `unknown` each hash cached as having none, and `missing`
 * the hashes to ask about.
 */
export function cachedSubtitleLanguages(hashes: string[], deps: CacheDeps = {}) {
	const now = (deps.now ?? Date.now)();
	const store = readStore(deps);
	const known = new Map<string, string[]>();
	const unknown = new Set<string>();
	const missing: string[] = [];
	for (const hash of hashes) {
		const entry = store[hash];
		if (!Array.isArray(entry) || !(entry[1] > now)) missing.push(hash);
		else if (Array.isArray(entry[0])) known.set(hash, entry[0]);
		else unknown.add(hash);
	}
	return { known, unknown, missing };
}

/** Keep each asked hash's answer: its languages, or null when it had no stored probe. */
export function cacheSubtitleLanguages(
	answers: Map<string, string[] | null>,
	deps: CacheDeps = {}
) {
	if (!answers.size) return;
	const now = (deps.now ?? Date.now)();
	const store = readStore(deps);
	for (const [hash, languages] of answers) {
		store[hash] = [languages, now + (languages ? HIT_TTL_MS : MISS_TTL_MS)];
	}
	writeStore(store, deps);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FetchDeps extends CacheDeps {
	post?: typeof fetch;
	wait?: (ms: number) => Promise<unknown>;
	signal?: AbortSignal;
}

/**
 * Ask the route about `hashes` (lowercase info hashes) in batches of 100, caching
 * and handing each batch's answers to `onBatch` as it lands: languages for a hash
 * with a stored probe, null for one without. A batch the rate limit refuses waits
 * out its Retry-After; any other failure skips the batch and leaves its hashes
 * uncached, so they stay unknown until the next search.
 */
export async function fetchSubtitleLanguages(
	hashes: string[],
	onBatch: (answers: Map<string, string[] | null>) => void,
	deps: FetchDeps = {}
): Promise<void> {
	const post = deps.post ?? fetch;
	const wait = deps.wait ?? sleep;
	for (let at = 0; at < hashes.length; at += MEDIAINFO_BATCH) {
		const batch = hashes.slice(at, at + MEDIAINFO_BATCH);
		for (let refusals = 0; refusals < MAX_REFUSALS; refusals++) {
			if (deps.signal?.aborted) return;
			try {
				const response = await post(ROUTE, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ hashes: batch }),
					signal: deps.signal,
				});
				if (response.status === 429) {
					const seconds = Number(response.headers.get('retry-after')) || 10;
					await wait(Math.min(seconds, 60) * 1000);
					continue;
				}
				if (!response.ok) break;
				const { releases } = (await response.json()) as {
					releases?: Record<string, unknown>;
				};
				const answers = new Map<string, string[] | null>();
				for (const hash of batch) {
					const release = releases?.[hash];
					answers.set(hash, release ? subtitleLanguagesOfRelease(release) : null);
				}
				cacheSubtitleLanguages(answers, deps);
				onBatch(answers);
			} catch {
				// flags are a nicety; the results work without them
			}
			break;
		}
	}
}
