import { repository as db } from '@/services/repository';
import { castAccessToken } from '@/utils/castRdToken';

/**
 * Delivering a request without a transfer.
 *
 * Some requests never needed a fulfiller. On 2026-09-24, 72 of the open ones
 * were for a release Real-Debrid already had cached, and 15 more matched a
 * transfer somebody else had already completed. Either way one `addMagnet` on
 * the asker's account lands it instantly and spends nobody's TorBox. The
 * direct transfer route already did this; the board never did.
 */

/**
 * The hash to add for each release that is already on Real-Debrid.
 *
 * The original hash when `Available` has it. Otherwise the *rewritten* hash of
 * a completed transfer: the uploader renames and salts what it moves, so the
 * content sits in RD under a hash no search result carries. That one counts
 * only while it is still available, the same test `isTransferStillValid` uses,
 * so a pruned transfer is not handed out as a dead magnet.
 */
export async function alreadyOnRealDebrid(hashes: string[]): Promise<Map<string, string>> {
	const wanted = [...new Set(hashes.map((h) => h.toLowerCase()))];
	const result = new Map<string, string>();
	if (wanted.length === 0) return result;

	const direct = await db.checkAvailabilityByHashes(wanted);
	for (const row of direct) result.set(row.hash.toLowerCase(), row.hash.toLowerCase());

	const rest = wanted.filter((h) => !result.has(h));
	if (rest.length === 0) return result;
	const transfers = (await db.getDebridTransfers(rest)).filter(
		(t) => t.status === 'completed' && t.rewrittenHash
	);
	if (transfers.length === 0) return result;
	const live = new Set(
		(await db.checkAvailabilityByHashes(transfers.map((t) => t.rewrittenHash!))).map((row) =>
			row.hash.toLowerCase()
		)
	);
	for (const t of transfers) {
		const rewritten = t.rewrittenHash!.toLowerCase();
		if (live.has(rewritten)) result.set(t.originalHash.toLowerCase(), rewritten);
	}
	return result;
}

/**
 * Add an RD-cached hash to an account and select every file. Instant for
 * cached content, which is the only kind this is called with.
 */
export async function addHashToRd(rdKey: string, hash: string): Promise<boolean> {
	try {
		const addRes = await fetch('https://app.real-debrid.com/rest/1.0/torrents/addMagnet', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${rdKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: `magnet=${encodeURIComponent(`magnet:?xt=urn:btih:${hash}`)}`,
			signal: AbortSignal.timeout(15000),
		});
		if (addRes.status !== 201) return false;
		const { id } = await addRes.json();
		await fetch(`https://app.real-debrid.com/rest/1.0/torrents/selectFiles/${id}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${rdKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: 'files=all',
			signal: AbortSignal.timeout(15000),
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * A Real-Debrid access token for the *requester*, minted now.
 *
 * Not the token they filed the request with. Real-Debrid expires an access
 * token 24 hours after minting, and a request may sit on the board for days —
 * nzb2rd learned this the expensive way, where stale tokens were 1298 of 1952
 * Usenet failures. The OAuth triple in `CastProfile` does not expire, so the
 * token is minted at the moment it is needed instead of being carried.
 */
export async function mintRequesterToken(requesterId: string): Promise<string | null> {
	const profile = await db.getCastProfile(requesterId);
	if (!profile) return null;
	try {
		return await castAccessToken(profile);
	} catch (error) {
		// Only the message: an AxiosError expands to include `config.data`, which
		// here is the OAuth POST body — the triple itself.
		console.error(
			'Minting a Real-Debrid token for a request failed:',
			error instanceof Error ? error.message : String(error)
		);
		return null;
	}
}

/** How many open requests the cron delivers for free per tick. */
export const FREE_DELIVERY_BATCH = 10;
/** How much of the board one tick looks at for free deliveries. */
const FREE_DELIVERY_SCAN = 2000;

/**
 * Deliver open requests whose release has reached Real-Debrid since they were
 * filed. Runs from the cron, because nobody on the board can tell those rows
 * apart from the ones that need a fulfiller.
 */
export async function deliverFreeRequests(
	batch: number = FREE_DELIVERY_BATCH
): Promise<{ delivered: number; skipped: number }> {
	const open = await db.listOpenContentRequests(FREE_DELIVERY_SCAN, 0);
	const onRd = await alreadyOnRealDebrid(open.map((row) => row.hash));
	let delivered = 0;
	let skipped = 0;
	for (const row of open) {
		if (delivered + skipped >= batch) break;
		const hash = onRd.get(row.hash.toLowerCase());
		if (!hash) continue;
		const token = await mintRequesterToken(row.requesterId);
		if (
			token &&
			(await addHashToRd(token, hash)) &&
			(await db.markContentRequestDelivered(row.id))
		) {
			delivered++;
		} else {
			skipped++;
		}
	}
	return { delivered, skipped };
}
