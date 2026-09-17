// @vitest-environment node
//
// Node, not jsdom: the client aborts its own timeouts with an AbortController,
// and jsdom's AbortSignal is a different realm's object than the undici fetch
// underneath it, which rejects it outright. A browser has one realm for both.
import { describe, expect, it } from 'vitest';
import { checkDebridLinkCache, listAllSeedboxTorrents } from './debridLink';

/**
 * Opt-in live check of the bare-hash cache probe against the real API.
 *
 * Skipped unless DL_LIVE_TOKEN is set, so `npm run test` never touches a real
 * account. It spends nothing: a hit is content Debrid-Link already holds (and
 * is removed again), a miss is refused before anything is created.
 */
const TOKEN = process.env.DL_LIVE_TOKEN;
const CACHED = process.env.DL_LIVE_CACHED_HASH ?? 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

describe.skipIf(!TOKEN)('Integration: debrid-link live cache probe', () => {
	it('answers a hit and a miss, and leaves the library exactly as it found it', async () => {
		const before = await listAllSeedboxTorrents(TOKEN!);
		const beforeIds = new Set(before.map((t) => t.id));

		const miss = '7f'.repeat(20);
		const sweep = await checkDebridLinkCache(TOKEN!, [CACHED, miss], { concurrency: 1 });

		const hit = sweep.results.find((r) => r.hash === CACHED)!;
		const gone = sweep.results.find((r) => r.hash === miss)!;

		expect(hit.checked).toBe(true);
		expect(hit.cached).toBe(true);
		expect(gone.checked).toBe(true);
		expect(gone.cached).toBe(false);
		expect(sweep.floodLockedOut).toBe(false);
		expect(sweep.leftBehindIds).toEqual([]);

		const after = await listAllSeedboxTorrents(TOKEN!);
		expect(new Set(after.map((t) => t.id))).toEqual(beforeIds);

		console.log(
			`live: hit=${hit.cached} id=${hit.torrentId} removed=${hit.removed} | ` +
				`miss=${gone.cached} | library ${before.length} -> ${after.length}`
		);
	}, 60_000);
});
