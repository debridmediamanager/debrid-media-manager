import { TakedownService } from '@/services/database/takedown';
import { normalizeReleaseName } from '@/utils/takedownParse';
import { createHash } from 'crypto';

export type Blocklist = {
	version: string;
	hashes: ReadonlySet<string>;
	releases: ReadonlySet<string>;
};

/**
 * Every replica reads the tables on its own, so an approval reaches the
 * replica that served it at once (invalidateBlocklist) and the other three
 * within this window.
 */
const TTL_MS = 60_000;

const RETRY_MS = 5_000;

const EMPTY: Blocklist = { version: 'empty', hashes: new Set(), releases: new Set() };

let service: TakedownService | null = null;
let current: Blocklist | null = null;
let loadedAt = 0;
let failedAt = 0;
let inflight: Promise<Blocklist> | null = null;

const versionOf = (hashes: string[], releases: string[]): string =>
	createHash('sha1')
		.update([...hashes].sort().join('\n'))
		.update('\0')
		.update([...releases].sort().join('\n'))
		.digest('hex')
		.slice(0, 16);

const load = async (): Promise<Blocklist> => {
	try {
		service ??= new TakedownService();
		const { hashes, releases } = await service.getBlocked();
		current = {
			version: versionOf(hashes, releases),
			hashes: new Set(hashes),
			releases: new Set(releases),
		};
		loadedAt = Date.now();
	} catch (error) {
		// Fail open on the last list we had: a database hiccup must not take
		// every search page down with it. Retry after a short pause rather than
		// on every request of an outage.
		failedAt = Date.now();
		console.warn(
			'Takedown blocklist load failed:',
			error instanceof Error ? error.message : 'Unknown error'
		);
	}
	return current ?? EMPTY;
};

export const getBlocklist = async (): Promise<Blocklist> => {
	const now = Date.now();
	if (current && now - loadedAt < TTL_MS) return current;
	if (now - failedAt < RETRY_MS) return current ?? EMPTY;
	inflight ??= load().finally(() => {
		inflight = null;
	});
	return inflight;
};

/** False until one load has succeeded, so a cold replica never serves an empty list as the truth. */
export const hasLoadedBlocklist = () => current !== null;

export const invalidateBlocklist = () => {
	loadedAt = 0;
	failedAt = 0;
};

/** Test seams. */
export const setBlocklistForTests = (hashes: string[], releases: string[] = []) => {
	current = {
		version: versionOf(hashes, releases),
		hashes: new Set(hashes),
		releases: new Set(releases),
	};
	// Pinned: fake timers must not age it out into a database read.
	loadedAt = Number.POSITIVE_INFINITY;
};

export const resetBlocklistForTests = () => {
	current = null;
	loadedAt = 0;
	failedAt = 0;
	service = null;
};

export const isHashBlockedIn = (list: Blocklist, hash: string | null | undefined): boolean =>
	!!hash && list.hashes.has(hash.toLowerCase());

export const isReleaseBlockedIn = (list: Blocklist, name: string | null | undefined): boolean =>
	!!name && list.releases.has(normalizeReleaseName(name));

export const isHashBlocked = async (hash: string | null | undefined) =>
	isHashBlockedIn(await getBlocklist(), hash);

export const isReleaseBlocked = async (name: string | null | undefined) =>
	isReleaseBlockedIn(await getBlocklist(), name);

/** Drops the rows whose hash is blocked. Non-arrays pass through untouched. */
export const withoutBlockedHashes = async <T>(
	value: T,
	hashOf: (row: any) => string | null | undefined = (row) => row?.hash
): Promise<T> => {
	if (!Array.isArray(value) || value.length === 0) return value;
	const list = await getBlocklist();
	if (list.hashes.size === 0) return value;
	return value.filter((row) => !isHashBlockedIn(list, hashOf(row))) as T;
};

/** Drops blocked hashes from a list of plain hash strings. */
export const withoutBlockedHashList = async (hashes: string[]): Promise<string[]> => {
	const list = await getBlocklist();
	if (list.hashes.size === 0) return hashes;
	return hashes.filter((hash) => !isHashBlockedIn(list, hash));
};

/** Drops Usenet results whose release name is blocked. */
export const withoutBlockedReleases = async <T extends { title?: string | null }>(
	results: T[]
): Promise<T[]> => {
	const list = await getBlocklist();
	if (list.releases.size === 0) return results;
	return results.filter((result) => !isReleaseBlockedIn(list, result.title));
};

const NZB_NAME_META = /<meta\b[^>]*\btype\s*=\s*["'](?:name|title)["'][^>]*>([\s\S]*?)<\/meta>/gi;

/**
 * Whether an NZB is a blocked release, judged by the names it declares and by
 * any the caller was told. A grab token or a client-supplied title alone is not
 * enough: the one names nothing, the other is whatever the client sent.
 */
export const isNzbBlocked = async (xml: string, ...names: Array<string | null | undefined>) => {
	const list = await getBlocklist();
	if (list.releases.size === 0) return false;
	const declared = [...xml.matchAll(NZB_NAME_META)].map((m) => m[1].trim());
	return [...declared, ...names].some((name) => isReleaseBlockedIn(list, name));
};

export const BLOCKED_MESSAGE = 'This content was removed in response to a copyright notice.';
