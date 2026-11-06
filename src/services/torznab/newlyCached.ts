// What the Torznab RSS sync on the Real-Debrid and AllDebrid feeds is answered
// from: the releases DMM most recently recorded as cached, and what each cached
// hash resolved to in the library.
//
// The list is the same for every sponsor, so it is not built per request. One
// instance claims the build at most every `NEWLY_CACHED_BUILD_SECONDS`, builds
// it in the background, and every instance pages the copy it wrote, so an *arr
// paging across the four Swarm replicas reads one list. Redis-backed with an
// in-process fallback: an outage costs a build per instance, never the feed.

import { RedisWithMemory } from './redisWithMemory';

export { REDIS_RETRY_MS } from './redisWithMemory';

/** The newest cache rows read per provider, and how far back they may reach. */
export const NEWLY_CACHED_DEPTH = 3000;
export const NEWLY_CACHED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How often the list may be rebuilt, across all instances. */
export const NEWLY_CACHED_BUILD_SECONDS = 5 * 60;

/**
 * How many unknown hashes one build may look up in the library, newest first.
 * Since 2026-11-05 `Available` gains 500 to 2,300 rows an hour, so a build
 * normally finds a few hundred; a burst converges over the builds that follow.
 */
export const NEWLY_CACHED_RESOLVE_LIMIT = 1000;

/**
 * What a hash resolved to, found or not. Long enough that a release RD refuses,
 * or one on no page of its title, is not looked up every build; short enough
 * that a report or a trash verdict, and a release scraped later, reach the list
 * within hours.
 */
export const RESOLVED_TTL_SECONDS = 6 * 60 * 60;

/** As long as the window: the list is the history new items are dated against. */
const LISTS_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Versioned: a change of format is a new key, never a misread old one. */
const KEY_PREFIX = 'torznab:newly:v4:';
const LISTS_KEY = `${KEY_PREFIX}lists`;
const BUILD_KEY = `${KEY_PREFIX}build`;

/** A library release as the feed serves it, minus its dates. */
export interface ResolvedRelease {
	hash: string;
	title: string;
	/** Bytes. */
	size: number;
	categories: number[];
}

export interface NewlyCachedRelease extends ResolvedRelease {
	/** Epoch ms: when DMM first recorded the hash as cached on this provider. */
	cachedAt: number;
	/** Epoch ms: the build that first listed it, which is its `pubDate`. */
	listedAt: number;
	/** The cache row's title as DMM files it (`tt…`; a show's for TV). */
	imdbId: string;
}

/** Newest listing first. Real-Debrid's leaves out what RD refuses by name. */
export interface NewlyCachedLists {
	/** Epoch ms: when the build that made it ran, so the later of two copies wins. */
	builtAt: number;
	rd: NewlyCachedRelease[];
	ad: NewlyCachedRelease[];
}

const isRelease = (item: unknown): item is NewlyCachedRelease => {
	const r = item as NewlyCachedRelease;
	return (
		typeof r === 'object' &&
		r !== null &&
		typeof r.hash === 'string' &&
		typeof r.title === 'string' &&
		typeof r.size === 'number' &&
		Array.isArray(r.categories) &&
		r.categories.every((id) => typeof id === 'number') &&
		typeof r.cachedAt === 'number' &&
		typeof r.listedAt === 'number' &&
		typeof r.imdbId === 'string'
	);
};

const isLists = (value: unknown): value is NewlyCachedLists => {
	const lists = value as NewlyCachedLists;
	return (
		typeof lists === 'object' &&
		lists !== null &&
		typeof lists.builtAt === 'number' &&
		Array.isArray(lists.rd) &&
		Array.isArray(lists.ad) &&
		lists.rd.every(isRelease) &&
		lists.ad.every(isRelease)
	);
};

export class NewlyCachedStore {
	private store: RedisWithMemory;

	constructor(redisUrl?: string) {
		this.store = new RedisWithMemory(
			redisUrl,
			// A stalled event loop is not a Redis failure, and the list read is over a megabyte.
			5000,
			// The list and the build claim, so the memo's cap never evicts them.
			(key) => key === LISTS_KEY || key === BUILD_KEY
		);
	}

	/**
	 * The later-built of the shared list and this instance's own copy. A write
	 * the client reported failed can still have reached Redis, or not, so the
	 * shared copy may be older than what this instance last built; serving it
	 * would take the feed backward. Anything not of the list's shape is no
	 * list. Never throws.
	 */
	public async readLists(): Promise<NewlyCachedLists | null> {
		const [shared] = await this.store.get([LISTS_KEY]);
		let newest: NewlyCachedLists | null = null;
		for (const raw of [shared, this.store.fromMemory(LISTS_KEY)]) {
			if (!raw) continue;
			try {
				const parsed: unknown = JSON.parse(raw);
				if (isLists(parsed) && (!newest || parsed.builtAt > newest.builtAt))
					newest = parsed;
			} catch {
				// Unreadable is no list.
			}
		}
		return newest;
	}

	/** Kept in memory too, so an instance that loses Redis keeps its history. */
	public async writeLists(lists: NewlyCachedLists): Promise<void> {
		const value = JSON.stringify(lists);
		this.store.toMemory(LISTS_KEY, value, LISTS_TTL_SECONDS);
		await this.store.set([[LISTS_KEY, value, LISTS_TTL_SECONDS]]);
	}

	/**
	 * Whether this caller should build now. True for one caller per interval;
	 * the claim is not released, so a failed build waits out the interval too.
	 */
	public claimBuild(): Promise<boolean> {
		return this.store.setIfAbsent(BUILD_KEY, '1', NEWLY_CACHED_BUILD_SECONDS);
	}

	/** What is known per `imdbId:hash`: a release, or null for none found. Never throws. */
	public async readResolved(keys: string[]): Promise<Map<string, ResolvedRelease | null>> {
		if (keys.length === 0) return new Map();
		const values = await this.store.get(keys.map((key) => `${KEY_PREFIX}title:${key}`));
		const known = new Map<string, ResolvedRelease | null>();
		values.forEach((value, index) => {
			if (value === '0') known.set(keys[index], null);
			else if (value) {
				try {
					known.set(keys[index], JSON.parse(value) as ResolvedRelease);
				} catch {
					// Unreadable is unknown: it is looked up again.
				}
			}
		});
		return known;
	}

	public async writeResolved(entries: Map<string, ResolvedRelease | null>): Promise<void> {
		if (entries.size === 0) return;
		await this.store.set(
			[...entries].map(([key, release]) => [
				`${KEY_PREFIX}title:${key}`,
				release ? JSON.stringify(release) : '0',
				RESOLVED_TTL_SECONDS,
			])
		);
	}
}

let store: NewlyCachedStore | null = null;

export function newlyCachedStore(): NewlyCachedStore {
	if (!store) store = new NewlyCachedStore(process.env.REDIS_URL);
	return store;
}

/** Test seam: swap the store, and restore it. */
export function setNewlyCachedStore(next: NewlyCachedStore | null): void {
	store = next;
}
