// Redis shared by the four Swarm instances, falling back to this process's
// memory, for the Torznab stores (`ProviderCacheMemo`, `NewlyCachedStore`): an
// outage costs sharing, never an answer.
//
// Three ways ioredis 5.11.1 with these options loses data or the connection
// without saying so, each of which a store here once got wrong:
//   * `retryStrategy: () => null` never reconnects, so after a failure the
//     client is dropped and a fresh one tried after `REDIS_RETRY_MS`.
//   * With Redis down, `pipeline().exec()` resolves with an error per command
//     rather than rejecting; those count as a failed write.
//   * A dropped client can still emit an error later, which must not drop the
//     client that replaced it.

import Redis from 'ioredis';

/** After a Redis failure, how long an instance runs on memory before trying again. */
export const REDIS_RETRY_MS = 30_000;

const MEMORY_MAX_ENTRIES = 50_000;

interface MemoryEntry {
	value: string;
	expiresAt: number;
}

export class RedisWithMemory {
	private redis: Redis | null = null;
	private retryAt = 0;
	/** Size-capped: the oldest entry goes first. */
	private memory = new Map<string, MemoryEntry>();
	/** Keys the cap must never evict. */
	private pinned = new Map<string, MemoryEntry>();

	constructor(
		private redisUrl: string | undefined,
		private commandTimeout: number,
		private isPinned: (key: string) => boolean = () => false
	) {}

	private client(): Redis | null {
		if (this.redis) return this.redis;
		if (!this.redisUrl || Date.now() < this.retryAt) return null;
		try {
			const client = new Redis(this.redisUrl, {
				maxRetriesPerRequest: 1,
				retryStrategy: () => null,
				connectTimeout: 2000,
				commandTimeout: this.commandTimeout,
				lazyConnect: true,
			});
			client.on('error', () => {
				if (this.redis === client) this.fail();
			});
			this.redis = client;
			return client;
		} catch {
			this.fail();
			return null;
		}
	}

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
		return this.isPinned(key) ? this.pinned : this.memory;
	}

	public fromMemory(key: string): string | null {
		const map = this.mapFor(key);
		const entry = map.get(key);
		if (!entry) return null;
		if (entry.expiresAt > Date.now()) return entry.value;
		map.delete(key);
		return null;
	}

	public toMemory(key: string, value: string, ttlSeconds: number): void {
		const map = this.mapFor(key);
		map.delete(key);
		if (map === this.memory && map.size >= MEMORY_MAX_ENTRIES) {
			map.delete(map.keys().next().value!);
		}
		map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
	}

	/** Redis's values, or this process's when Redis is unavailable. Never throws. */
	public async get(keys: string[]): Promise<Array<string | null>> {
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

	/** To Redis, or to memory when Redis does not take them. Never throws. */
	public async set(entries: Array<[key: string, value: string, ttlSeconds: number]>) {
		const client = this.client();
		if (client) {
			try {
				const pipeline = client.pipeline();
				for (const [key, value, ttl] of entries) pipeline.set(key, value, 'EX', ttl);
				const results = await pipeline.exec();
				if (!results || results.some(([error]) => error)) throw new Error('write failed');
				return;
			} catch {
				this.fail();
			}
		}
		for (const [key, value, ttl] of entries) this.toMemory(key, value, ttl);
	}

	/** `SET NX`: true for the one caller that set it, in Redis or else in memory. */
	public async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
		const client = this.client();
		if (client) {
			try {
				return (await client.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
			} catch {
				this.fail();
			}
		}
		if (this.fromMemory(key) !== null) return false;
		this.toMemory(key, value, ttlSeconds);
		return true;
	}
}
