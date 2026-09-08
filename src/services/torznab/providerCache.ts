// Availability for the Torznab feeds that DMM cannot answer out of its own
// database.
//
// Real-Debrid and AllDebrid are answered from `Available` and `AvailableAd`,
// which DMM fills itself, so `/rd/cached` costs one indexed query and nothing
// else. TorBox, Premiumize and Offcloud have no such table: the only way to
// learn whether one of them holds a hash is to ask it, with an account key.
//
// Three things follow from that, and all three shape what is below.
//
//   * The answer is not private. A provider's cache is one shared pool, so
//     "is this hash cached" has the same answer for every account on it. That
//     makes the result memoisable across sponsors, which is the only reason
//     asking is affordable at all: the first sponsor to search a title pays for
//     it and everyone after them reads the memo.
//   * A search's hash list is unbounded. A popular film's library page runs to
//     thousands, and a provider probe is a network round trip per hundred. So a
//     single request probes a bounded slice and leaves the rest unresolved,
//     converging over the repeated searches an *arr issues anyway.
//   * A failed probe is not an empty cache. Answering "nothing is cached" when
//     the key is dead or the provider is down would silently empty a `cached`
//     feed, which reads to an *arr as "this release does not exist" rather than
//     as a broken indexer. Failures raise instead.

import { checkOffcloudCache } from '@/services/offcloud';
import { checkPremiumizeCache } from '@/services/premiumize';
import { checkCachedStatus } from '@/services/torbox';
import type { TorBoxCachedItem } from '@/services/types';
import type { TorznabLiveService } from '@/utils/sponsorProviders';
import { LIVE_SERVICE_LABELS } from '@/utils/sponsorProviders';
import Redis from 'ioredis';

/**
 * How many unknown hashes one request may spend on live probes.
 *
 * Sized so the worst case is a handful of round trips rather than dozens: at
 * TorBox's hundred-per-call this is four, which the memo then absorbs for every
 * later search of the same title.
 */
export const LIVE_PROBE_LIMIT = 400;

/** TorBox joins hashes into a GET query, so its batch is the smallest. */
const TORBOX_BATCH = 100;

/** Premiumize and Offcloud take a POST body and are already chunked internally. */
const BULK_BATCH = 1000;

/**
 * A hit is remembered far longer than a miss.
 *
 * A cached hash rarely stops being cached, and if it does the cost is one
 * release an *arr grabs slightly slower. A miss is the answer that changes —
 * that is what happens every time somebody adds the torrent — so it is re-asked
 * often enough that a newly cached release reaches the feed the same day.
 */
export const HIT_TTL_SECONDS = 6 * 60 * 60;
export const MISS_TTL_SECONDS = 30 * 60;

const KEY_PREFIX = 'torznab:pcache:';
const MEMORY_MAX_ENTRIES = 50_000;

/**
 * A provider-backed feed was asked for without that provider's key linked.
 *
 * Separate from a probe failure because the fix is different and the caller
 * says so: one is "link your TorBox key in DMM Settings", the other is "TorBox
 * said no". An *arr shows the description and nothing else.
 */
export class MissingProviderKeyError extends Error {
	constructor(public readonly service: TorznabLiveService) {
		super(`No ${LIVE_SERVICE_LABELS[service]} key linked`);
		this.name = 'MissingProviderKeyError';
	}
}

export class ProviderProbeError extends Error {
	constructor(
		public readonly service: TorznabLiveService,
		message: string
	) {
		super(message);
		this.name = 'ProviderProbeError';
	}
}

interface MemoryEntry {
	cached: boolean;
	expiresAt: number;
}

/**
 * The cross-sponsor memo of provider cache answers.
 *
 * Redis-backed so the four Swarm instances share one memo, with an in-process
 * fallback so a Redis outage costs extra provider calls rather than a broken
 * feed. Modelled on `CanaryStore`, which makes the same trade for the same
 * reason.
 */
export class ProviderCacheMemo {
	private redis: Redis | null = null;
	private redisAvailable = true;
	private memory = new Map<string, MemoryEntry>();

	constructor(private redisUrl?: string) {}

	private client(): Redis | null {
		if (this.redis) return this.redis;
		if (!this.redisUrl || !this.redisAvailable) return null;
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
			return this.redis;
		} catch {
			this.redisAvailable = false;
			return null;
		}
	}

	private key(service: TorznabLiveService, hash: string): string {
		return `${KEY_PREFIX}${service}:${hash}`;
	}

	private readMemory(service: TorznabLiveService, hashes: string[]): Map<string, boolean> {
		const now = Date.now();
		const known = new Map<string, boolean>();
		for (const hash of hashes) {
			const entry = this.memory.get(this.key(service, hash));
			if (!entry) continue;
			if (entry.expiresAt <= now) {
				this.memory.delete(this.key(service, hash));
				continue;
			}
			known.set(hash, entry.cached);
		}
		return known;
	}

	/** What is already known, keyed by the normalised hash. Never throws. */
	public async read(
		service: TorznabLiveService,
		hashes: string[]
	): Promise<Map<string, boolean>> {
		if (hashes.length === 0) return new Map();

		const client = this.client();
		if (!client) return this.readMemory(service, hashes);

		try {
			const values = await client.mget(hashes.map((hash) => this.key(service, hash)));
			const known = new Map<string, boolean>();
			values.forEach((value, index) => {
				if (value === '1') known.set(hashes[index], true);
				else if (value === '0') known.set(hashes[index], false);
			});
			return known;
		} catch {
			this.redisAvailable = false;
			return this.readMemory(service, hashes);
		}
	}

	/** Best-effort: a memo that cannot be written costs a re-probe, nothing more. */
	public async write(service: TorznabLiveService, entries: Map<string, boolean>): Promise<void> {
		if (entries.size === 0) return;

		const client = this.client();
		if (client) {
			try {
				const pipeline = client.pipeline();
				for (const [hash, cached] of entries) {
					pipeline.set(
						this.key(service, hash),
						cached ? '1' : '0',
						'EX',
						cached ? HIT_TTL_SECONDS : MISS_TTL_SECONDS
					);
				}
				await pipeline.exec();
				return;
			} catch {
				this.redisAvailable = false;
			}
		}

		const now = Date.now();
		for (const [hash, cached] of entries) {
			if (this.memory.size >= MEMORY_MAX_ENTRIES) this.memory.clear();
			this.memory.set(this.key(service, hash), {
				cached,
				expiresAt: now + (cached ? HIT_TTL_SECONDS : MISS_TTL_SECONDS) * 1000,
			});
		}
	}
}

let memo: ProviderCacheMemo | null = null;

export function providerCacheMemo(): ProviderCacheMemo {
	if (!memo) memo = new ProviderCacheMemo(process.env.REDIS_URL);
	return memo;
}

/** Test seam: swap the memo, and restore it. */
export function setProviderCacheMemo(next: ProviderCacheMemo | null): void {
	memo = next;
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let start = 0; start < items.length; start += size) {
		out.push(items.slice(start, start + size));
	}
	return out;
}

function asMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'unknown error';
}

/** TorBox's own explanation, when it sent one under an error status. */
function torboxDetail(error: unknown): string | null {
	const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data
		?.detail;
	return typeof detail === 'string' && detail.trim() ? detail : null;
}

/**
 * One provider's answer for a batch, as the set of hashes it holds.
 *
 * Every branch reports hits only, so a hash the provider did not name is a miss
 * rather than an unknown — the batch was asked about all of them.
 */
async function probeBatch(
	service: TorznabLiveService,
	apiKey: string,
	hashes: string[]
): Promise<Set<string>> {
	if (service === 'tb') {
		let response;
		try {
			response = await checkCachedStatus({ hash: hashes, format: 'object' }, apiKey);
		} catch (error) {
			// A rejected key comes back as an HTTP 403, which axios throws on, so
			// TorBox's own sentence about it is in the response body rather than
			// in the error message. It is the one worth showing.
			throw new ProviderProbeError('tb', torboxDetail(error) ?? asMessage(error));
		}
		if (!response.success) {
			throw new ProviderProbeError('tb', response.detail || 'TorBox refused the check');
		}
		const data = response.data;
		if (!data) return new Set();
		// `format: 'object'` keys by hash; the list form is accepted too because
		// TorBox has answered with one when asked about a single hash.
		const keys = Array.isArray(data)
			? (data as TorBoxCachedItem[]).map((item) => item.hash)
			: Object.keys(data);
		return new Set(keys.map((hash) => hash.toLowerCase()));
	}

	if (service === 'pm') {
		const results = await checkPremiumizeCache(apiKey, hashes);
		return new Set(
			results.filter((result) => result.cached).map((result) => result.hash.toLowerCase())
		);
	}

	const results = await checkOffcloudCache(apiKey, hashes);
	return new Set(
		results.filter((result) => result.cached).map((result) => result.hash.toLowerCase())
	);
}

/**
 * A well-known, long-lived public-domain torrent, used only as something to ask
 * about. Every provider's cache probe needs a hash; whether this one is cached
 * is irrelevant, only whether the call is accepted.
 */
const PROBE_CANARY_HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

/**
 * Whether a key works, checked with the exact call the feed will make.
 *
 * Validating with a cheap `/user` call instead would accept a key that cannot
 * reach the cache endpoint, and the sponsor would find out days later as an
 * empty feed. Throws `ProviderProbeError` with the provider's own words.
 */
export async function validateProviderKey(
	service: TorznabLiveService,
	apiKey: string
): Promise<void> {
	try {
		await probeBatch(service, apiKey, [PROBE_CANARY_HASH]);
	} catch (error) {
		if (error instanceof ProviderProbeError) throw error;
		throw new ProviderProbeError(
			service,
			`${LIVE_SERVICE_LABELS[service]} rejected that key: ${asMessage(error)}`
		);
	}
}

export interface ProviderCacheAnswer {
	/** The hashes, in the caller's own spelling, the provider holds. */
	cached: Set<string>;
	/** How many the budget did not reach. Excluded from a `cached` feed. */
	unresolved: number;
}

/**
 * Which of these hashes the provider already holds.
 *
 * Reads the shared memo first, probes a bounded slice of what is left and
 * writes what it learns back. The returned set is spelled the way the caller
 * spelled its hashes, so it can be tested against library rows directly.
 */
export async function probeProviderCache(
	service: TorznabLiveService,
	apiKey: string,
	hashes: string[],
	limit: number = LIVE_PROBE_LIMIT
): Promise<ProviderCacheAnswer> {
	if (hashes.length === 0) return { cached: new Set(), unresolved: 0 };

	// One hash can appear under two spellings across library pages; the memo and
	// every provider are case-insensitive, so normalise once and map back after.
	const spellings = new Map<string, string[]>();
	for (const hash of hashes) {
		const normalized = hash.toLowerCase();
		const existing = spellings.get(normalized);
		if (existing) existing.push(hash);
		else spellings.set(normalized, [hash]);
	}
	const normalized = [...spellings.keys()];

	const memoized = await providerCacheMemo().read(service, normalized);
	const unknown = normalized.filter((hash) => !memoized.has(hash));

	const probing = unknown.slice(0, limit);
	const learned = new Map<string, boolean>();

	if (probing.length > 0) {
		const batchSize = service === 'tb' ? TORBOX_BATCH : BULK_BATCH;
		for (const batch of chunk(probing, batchSize)) {
			let hits: Set<string>;
			try {
				hits = await probeBatch(service, apiKey, batch);
			} catch (error) {
				if (error instanceof ProviderProbeError) throw error;
				throw new ProviderProbeError(
					service,
					`${LIVE_SERVICE_LABELS[service]} availability check failed: ${asMessage(error)}`
				);
			}
			for (const hash of batch) learned.set(hash, hits.has(hash));
		}
		await providerCacheMemo().write(service, learned);
	}

	const cached = new Set<string>();
	for (const [hash, isCached] of [...memoized, ...learned]) {
		if (!isCached) continue;
		for (const spelling of spellings.get(hash) ?? []) cached.add(spelling);
	}

	return { cached, unresolved: unknown.length - probing.length };
}
