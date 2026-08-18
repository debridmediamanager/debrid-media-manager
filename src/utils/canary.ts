/**
 * Impossible titles - IMDb ids that no path through DMM can produce.
 *
 * IMDb allocates ids sequentially and the frontier is already past tt40000000
 * (verified 2026-08-19: that id is a real episode), so any band close above the
 * frontier turns into real titles over time and would start flagging real
 * users. The canary space therefore sits an order of magnitude beyond it, in
 * the 9-digit range, where an id can never become a real title and can never
 * arrive from an external link - the browser extension, a shared URL, or a
 * search engine included.
 *
 * Canaries are published only where a machine reads (the sitemap) and are never
 * rendered in the UI, so a browser session cannot produce a request for one.
 * That makes a canary hit on the torrents API proof of enumeration rather than
 * a signal to weigh, which is what lets the rest of the anti-scraping work fire
 * without risking a real user.
 */

export type CanaryKind = 'trap' | 'void';

const IMDB_ID = /^tt(\d+)$/;

/** Lowest id considered unallocatable. Everything at or above this is a canary. */
export const CANARY_FLOOR = 900_000_000;
export const CANARY_CEILING = 999_999_999;

/** Traps are drawn from the canary space and published in the sitemap. */
const TRAP_POOL_SIZE = 64;
export const TRAPS_PER_ROTATION = 8;
const TRAP_SEED = 0x444d4d21; // "DMM!"

const DAY_MS = 86_400_000;

/**
 * Deterministic PRNG. The trap pool has to be identical on every web instance
 * without a shared table, so it is derived rather than stored.
 */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function buildTrapPool(): string[] {
	const rand = mulberry32(TRAP_SEED);
	const span = CANARY_CEILING - CANARY_FLOOR;
	const ids = new Set<string>();
	while (ids.size < TRAP_POOL_SIZE) {
		ids.add(`tt${CANARY_FLOOR + Math.floor(rand() * span)}`);
	}
	return Array.from(ids).sort();
}

/** Every trap ever published. Classification accepts all of them, not just the
 * current rotation, so a list harvested weeks ago still trips the wire. */
export const TRAP_POOL: readonly string[] = buildTrapPool();

const TRAP_SET = new Set(TRAP_POOL);

function voidFloor(): number {
	const raw = process.env.CANARY_VOID_FLOOR;
	if (!raw) return CANARY_FLOOR;
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) return CANARY_FLOOR;
	return parsed;
}

/**
 * Returns the canary kind for an id, or null when the id is one a real user
 * could plausibly ask for. Never throws - callers run this on every request.
 */
export function classifyCanary(imdbId: string | null | undefined): CanaryKind | null {
	if (!imdbId) return null;
	const id = imdbId.trim();
	const match = IMDB_ID.exec(id);
	if (!match) return null;
	if (TRAP_SET.has(id)) return 'trap';
	const numeric = Number(match[1]);
	// An id too long to be a safe integer is not a title anyone can reach.
	if (!Number.isSafeInteger(numeric)) return 'void';
	return numeric >= voidFloor() ? 'void' : null;
}

/**
 * The traps published today. Rotating them means a scraper that blocklists the
 * current set after being caught trips the next one.
 */
export function trapsForRotation(now: number = Date.now()): string[] {
	const day = Math.floor(now / DAY_MS);
	const start =
		(((day * TRAPS_PER_ROTATION) % TRAP_POOL.length) + TRAP_POOL.length) % TRAP_POOL.length;
	return Array.from(
		{ length: TRAPS_PER_ROTATION },
		(_, i) => TRAP_POOL[(start + i) % TRAP_POOL.length]
	);
}
