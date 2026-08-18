import type { CanaryKind } from '@/utils/canary';
import Redis from 'ioredis';

export interface CanaryHit {
	imdbId: string;
	kind: CanaryKind;
	path: string;
}

export interface CanaryRecord {
	count: number;
	firstSeen: number;
	lastSeen: number;
	kinds: CanaryKind[];
	lastImdbId: string;
	lastPath: string;
}

export const CANARY_TTL_SECONDS = 7 * 24 * 60 * 60;
const KEY_PREFIX = 'canary:hit:';
const MEMORY_MAX_ENTRIES = 10_000;

interface MemoryEntry extends CanaryRecord {
	expiresAt: number;
}

/**
 * Records canary hits per client identity.
 *
 * Recording is best-effort by design: a tripwire must never be able to fail a
 * request, so every path here swallows its errors and falls back to memory.
 */
export class CanaryStore {
	private redis: Redis | null = null;
	private redisAvailable = true;
	private memory = new Map<string, MemoryEntry>();

	constructor(
		private redisUrl?: string,
		private ttlSeconds: number = CANARY_TTL_SECONDS
	) {}

	private initRedis(): Redis | null {
		if (this.redis) return this.redis;
		if (!this.redisUrl) {
			this.redisAvailable = false;
			return null;
		}
		try {
			this.redis = new Redis(this.redisUrl, {
				maxRetriesPerRequest: 1,
				retryStrategy: () => null,
				connectTimeout: 2000,
				commandTimeout: 1000,
				lazyConnect: true,
			});
			this.redis.on('error', () => {
				this.redisAvailable = false;
			});
			this.redis.on('connect', () => {
				this.redisAvailable = true;
			});
			return this.redis;
		} catch {
			this.redisAvailable = false;
			return null;
		}
	}

	async record(identity: string, hit: CanaryHit, now: number = Date.now()): Promise<void> {
		const client = this.initRedis();
		if (client && this.redisAvailable) {
			try {
				const key = `${KEY_PREFIX}${identity}`;
				await client
					.multi()
					.hincrby(key, 'count', 1)
					.hincrby(key, `kind:${hit.kind}`, 1)
					.hsetnx(key, 'firstSeen', now)
					.hset(key, {
						lastSeen: now,
						lastImdbId: hit.imdbId,
						lastPath: hit.path,
					})
					.expire(key, this.ttlSeconds)
					.exec();
				return;
			} catch {
				this.redisAvailable = false;
			}
		}
		this.recordInMemory(identity, hit, now);
	}

	private recordInMemory(identity: string, hit: CanaryHit, now: number): void {
		this.pruneMemory(now);
		const existing = this.memory.get(identity);
		if (existing && existing.expiresAt > now) {
			existing.count += 1;
			existing.lastSeen = now;
			existing.lastImdbId = hit.imdbId;
			existing.lastPath = hit.path;
			if (!existing.kinds.includes(hit.kind)) existing.kinds.push(hit.kind);
			return;
		}
		this.memory.set(identity, {
			count: 1,
			firstSeen: now,
			lastSeen: now,
			kinds: [hit.kind],
			lastImdbId: hit.imdbId,
			lastPath: hit.path,
			expiresAt: now + this.ttlSeconds * 1000,
		});
	}

	private pruneMemory(now: number): void {
		if (this.memory.size < MEMORY_MAX_ENTRIES) return;
		for (const [identity, entry] of this.memory.entries()) {
			if (entry.expiresAt <= now) this.memory.delete(identity);
		}
		// Still full of live entries: drop the oldest so the map stays bounded.
		while (this.memory.size >= MEMORY_MAX_ENTRIES) {
			const oldest = this.memory.keys().next();
			if (oldest.done) break;
			this.memory.delete(oldest.value);
		}
	}

	async get(identity: string, now: number = Date.now()): Promise<CanaryRecord | null> {
		const client = this.initRedis();
		if (client && this.redisAvailable) {
			try {
				const raw = await client.hgetall(`${KEY_PREFIX}${identity}`);
				return parseRecord(raw);
			} catch {
				this.redisAvailable = false;
			}
		}
		const entry = this.memory.get(identity);
		if (!entry || entry.expiresAt <= now) return null;
		const { expiresAt: _expiresAt, ...record } = entry;
		return record;
	}

	async list(
		limit: number = 100,
		now: number = Date.now()
	): Promise<Array<{ identity: string; record: CanaryRecord }>> {
		const client = this.initRedis();
		if (client && this.redisAvailable) {
			try {
				const out: Array<{ identity: string; record: CanaryRecord }> = [];
				let cursor = '0';
				do {
					const [next, keys] = await client.scan(
						cursor,
						'MATCH',
						`${KEY_PREFIX}*`,
						'COUNT',
						200
					);
					cursor = next;
					for (const key of keys) {
						if (out.length >= limit) break;
						const record = parseRecord(await client.hgetall(key));
						if (record) {
							out.push({ identity: key.slice(KEY_PREFIX.length), record });
						}
					}
				} while (cursor !== '0' && out.length < limit);
				return out;
			} catch {
				this.redisAvailable = false;
			}
		}
		return Array.from(this.memory.entries())
			.filter(([, entry]) => entry.expiresAt > now)
			.slice(0, limit)
			.map(([identity, entry]) => {
				const { expiresAt: _expiresAt, ...record } = entry;
				return { identity, record };
			});
	}
}

function parseRecord(raw: Record<string, string> | null): CanaryRecord | null {
	if (!raw || !raw.count) return null;
	const kinds: CanaryKind[] = [];
	if (raw['kind:trap']) kinds.push('trap');
	if (raw['kind:void']) kinds.push('void');
	return {
		count: Number(raw.count),
		firstSeen: Number(raw.firstSeen ?? 0),
		lastSeen: Number(raw.lastSeen ?? 0),
		kinds,
		lastImdbId: raw.lastImdbId ?? '',
		lastPath: raw.lastPath ?? '',
	};
}

let store: CanaryStore | null = null;

export function getCanaryStore(): CanaryStore {
	if (!store) store = new CanaryStore(process.env.REDIS_URL);
	return store;
}
