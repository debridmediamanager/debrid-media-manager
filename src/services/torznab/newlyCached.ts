// What the Torznab RSS sync on the Real-Debrid and AllDebrid feeds is answered
// from: the releases DMM most recently recorded as cached, and what each cached
// hash resolved to in the library.
//
// The list is the same for every sponsor, so it is not built per request. One
// instance claims the build at most every `NEWLY_CACHED_BUILD_SECONDS`, builds
// it in the background, and every instance pages the copy it wrote, so an *arr
// paging across the four Swarm replicas reads one list. Redis-backed with an
// in-process fallback: an outage costs a build per instance, never the feed.

import Redis from 'ioredis';

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

/** After a Redis failure, how long an instance runs on memory before trying again. */
export const REDIS_RETRY_MS = 30_000;

/** Versioned: a change of format is a new key, never a misread old one. */
const KEY_PREFIX = 'torznab:newly:v2:';
const LISTS_KEY = `${KEY_PREFIX}lists`;
const BUILD_KEY = `${KEY_PREFIX}build`;
const MEMORY_MAX_ENTRIES = 50_000;

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
}

/** Newest listing first. Real-Debrid's leaves out what RD refuses by name. */
export interface NewlyCachedLists {
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
		typeof r.listedAt === 'number'
	);
};

const isLists = (value: unknown): value is NewlyCachedLists => {
	const lists = value as NewlyCachedLists;
	return (
		typeof lists === 'object' &&
		lists !== null &&
		Array.isArray(lists.rd) &&
		Array.isArray(lists.ad) &&
		lists.rd.every(isRelease) &&
		lists.ad.every(isRelease)
	);
};

interface MemoryEntry {
	value: string;
	expiresAt: number;
}

export class NewlyCachedStore {
	private redis: Redis | null = null;
	private retryAt = 0;
	/** The title memo, size-capped. */
	private memory = new Map<string, MemoryEntry>();
	/** The list and the build claim, kept apart so the cap never clears them. */
	private pinned = new Map<string, MemoryEntry>();

	constructor(private redisUrl?: string) {}

	private client(): Redis | null {
		if (this.redis) return this.redis;
		if (!this.redisUrl || Date.now() < this.retryAt) return null;
		try {
			this.redis = new Redis(this.redisUrl, {
				maxRetriesPerRequest: 1,
				retryStrategy: () => null,
				connectTimeout: 2000,
				commandTimeout: 1000,
				lazyConnect: true,
			});
			this.redis.on('error', () => this.fail());
			return this.redis;
		} catch {
			this.fail();
			return null;
		}
	}

	/**
	 * Drops the client and runs on memory for a while. The client is built not
	 * to reconnect, so a fresh one is the only way back once Redis returns.
	 */
	private fail(): void {
		const broken = this.redis;
		this.redis = null;
		this.retryAt = Date.now() + REDIS_RETRY_MS;
		try {
			broken?.disconnect();
		} catch {
			// Already gone.
		}
	}

	private mapFor(key: string): Map<string, MemoryEntry> {
		return key === LISTS_KEY || key === BUILD_KEY ? this.pinned : this.memory;
	}

	private fromMemory(key: string): string | null {
		const map = this.mapFor(key);
		const entry = map.get(key);
		if (!entry) return null;
		if (entry.expiresAt > Date.now()) return entry.value;
		map.delete(key);
		return null;
	}

	private toMemory(key: string, value: string, ttlSeconds: number): void {
		const map = this.mapFor(key);
		if (map === this.memory && map.size >= MEMORY_MAX_ENTRIES) map.clear();
		map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
	}

	private async get(keys: string[]): Promise<Array<string | null>> {
		const client = this.client();
		if (client) {
			try {
				return await client.mget(keys);
			} catch {
				this.fail();
			}
		}
		return keys.map((key) => this.fromMemory(key));
	}

	private async set(entries: Array<[key: string, value: string, ttlSeconds: number]>) {
		const client = this.client();
		if (client) {
			try {
				const pipeline = client.pipeline();
				for (const [key, value, ttl] of entries) pipeline.set(key, value, 'EX', ttl);
				// With Redis down, ioredis resolves this with an error per command
				// rather than rejecting, and the write would be lost.
				const results = await pipeline.exec();
				if (!results || results.some(([error]) => error)) throw new Error('write failed');
				return;
			} catch {
				this.fail();
			}
		}
		for (const [key, value, ttl] of entries) this.toMemory(key, value, ttl);
	}

	/**
	 * The last list built by any instance, else by this one. Anything not of
	 * the list's shape is no list. Never throws.
	 */
	public async readLists(): Promise<NewlyCachedLists | null> {
		const [shared] = await this.get([LISTS_KEY]);
		for (const raw of [shared, this.fromMemory(LISTS_KEY)]) {
			if (!raw) continue;
			try {
				const parsed: unknown = JSON.parse(raw);
				if (isLists(parsed)) return parsed;
			} catch {
				// Unreadable is no list.
			}
		}
		return null;
	}

	/** Kept in memory too, so an instance that loses Redis keeps its history. */
	public async writeLists(lists: NewlyCachedLists): Promise<void> {
		const value = JSON.stringify(lists);
		this.toMemory(LISTS_KEY, value, LISTS_TTL_SECONDS);
		await this.set([[LISTS_KEY, value, LISTS_TTL_SECONDS]]);
	}

	/**
	 * Whether this caller should build now. True for one caller per interval;
	 * the claim is not released, so a failed build waits out the interval too.
	 */
	public async claimBuild(): Promise<boolean> {
		const client = this.client();
		if (client) {
			try {
				return (
					(await client.set(BUILD_KEY, '1', 'EX', NEWLY_CACHED_BUILD_SECONDS, 'NX')) ===
					'OK'
				);
			} catch {
				this.fail();
			}
		}
		if (this.fromMemory(BUILD_KEY) !== null) return false;
		this.toMemory(BUILD_KEY, '1', NEWLY_CACHED_BUILD_SECONDS);
		return true;
	}

	/** What is known per `imdbId:hash`: a release, or null for none found. Never throws. */
	public async readResolved(keys: string[]): Promise<Map<string, ResolvedRelease | null>> {
		if (keys.length === 0) return new Map();
		const values = await this.get(keys.map((key) => `${KEY_PREFIX}title:${key}`));
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
		await this.set(
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
