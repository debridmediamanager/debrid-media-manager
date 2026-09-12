import { randomBytes } from 'crypto';
import Redis from 'ioredis';

/**
 * Serializes writers of the shared Jellyfin plugin catalog.
 *
 * The catalog is one stored document that a publish reads, merges one plugin into
 * and writes back, and four web replicas accept publishes. Two release jobs that
 * arrive together each merge into the catalog as it was before the other wrote, so
 * the later write drops the earlier plugin's new version while both jobs report
 * success. On 2026-09-13 seven concurrent tag releases lost RD zurg 1.0.4.0 that
 * way. Redis is what every replica shares, so the lock lives there.
 */

export const CATALOG_LOCK_KEY = 'jellyfin-plugins:catalog-lock';

// Longer than a catalog read and write ever take, so the lock outlives its holder
// only when that holder died.
const LOCK_TTL_MS = 60_000;
const WAIT_LIMIT_MS = 45_000;
const RETRY_MS = 200;

// Deletes the key only while it still holds this holder's token, so a holder whose
// lock expired cannot release the next holder's.
const RELEASE_SCRIPT =
	'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export type CatalogLockResult<T> =
	| { acquired: true; value: T; waitedMs: number }
	| { acquired: false; waitedMs: number };

let client: Redis | null = null;

function redis(): Redis | null {
	if (client) return client;
	const url = process.env.REDIS_URL;
	if (!url) return null;
	client = new Redis(url, {
		maxRetriesPerRequest: 1,
		connectTimeout: 2000,
		commandTimeout: 2000,
	});
	// A connection failure surfaces as a rejected command below; without a listener
	// ioredis also reports it as an unhandled error event.
	client.on('error', () => {});
	return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `work` while holding the catalog lock.
 *
 * Refuses rather than running unlocked: when Redis is unreachable or the lock stays
 * taken past the wait limit, `work` does not run and the caller is told so.
 */
export async function withCatalogLock<T>(work: () => Promise<T>): Promise<CatalogLockResult<T>> {
	const started = Date.now();
	const connection = redis();
	if (!connection) return { acquired: false, waitedMs: 0 };

	const token = randomBytes(16).toString('hex');

	for (;;) {
		let taken: string | null;
		try {
			taken = await connection.set(CATALOG_LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
		} catch {
			return { acquired: false, waitedMs: Date.now() - started };
		}

		if (taken === 'OK') break;
		if (Date.now() - started >= WAIT_LIMIT_MS) {
			return { acquired: false, waitedMs: Date.now() - started };
		}
		await sleep(RETRY_MS);
	}

	const waitedMs = Date.now() - started;
	try {
		return { acquired: true, value: await work(), waitedMs };
	} finally {
		try {
			await connection.eval(RELEASE_SCRIPT, 1, CATALOG_LOCK_KEY, token);
		} catch {
			// The TTL frees it.
		}
	}
}
