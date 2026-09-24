// Which releases TorBox can serve right now, asked with the caller's own key.
//
// The request board used to leave this to the fulfiller's browser, and the
// Fulfil button did not wait for the answer. 219 of the 369 requests shown as
// sent by 2026-09-24 had failed on the uploader as `uncached`. TorBox's cache
// is shared across accounts, so an uncached release is one nobody on the board
// can send until TorBox has it.

const CHECKCACHED_URL =
	'https://api.torbox.app/v1/api/torrents/checkcached?format=list&list_files=false';
const TIMEOUT_MS = 8000;
/** Hashes per call. TorBox accepts more; 100 keeps one slow answer small. */
export const CHECKCACHED_CHUNK = 100;

/**
 * The subset of `hashes` TorBox reports cached, lowercased.
 *
 * `null` means no answer: a timeout, a refusal, a body without `success`. A
 * caller must treat that as unknown rather than uncached, so a TorBox hiccup
 * never takes every request off the board.
 *
 * A bare fetch for the same reasons as `isFreeTorBoxPlan`: the shared client
 * waits out a 429 for minutes and records every answer on the status page.
 */
export async function torboxCachedHashes(
	apiKey: string,
	hashes: string[]
): Promise<Set<string> | null> {
	const wanted = [...new Set(hashes.map((h) => h.toLowerCase()))];
	const cached = new Set<string>();
	for (let i = 0; i < wanted.length; i += CHECKCACHED_CHUNK) {
		const chunk = wanted.slice(i, i + CHECKCACHED_CHUNK);
		try {
			const res = await fetch(CHECKCACHED_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ hashes: chunk }),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			const body = await res.json().catch(() => null);
			if (!res.ok || body?.success !== true) return null;
			const data = body.data ?? [];
			// `format=list` is asked for, but the object form keys by hash; read both.
			const items: unknown[] = Array.isArray(data) ? data : Object.values(data);
			for (const item of items) {
				const hash = (item as { hash?: unknown })?.hash;
				if (typeof hash === 'string') cached.add(hash.toLowerCase());
			}
		} catch {
			return null;
		}
	}
	return cached;
}
