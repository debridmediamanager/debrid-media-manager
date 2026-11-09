import { isSyncedKey, SIGN_IN_KEYS, SYNC_ENABLED_KEY } from './browserStateKeys';

/**
 * DMM Mobile opens DMM pages as `<page>#handoff=<code>` (see /api/handoff). The fragment
 * reaches no server and no Referer; the code works once, for two minutes.
 */
const HANDOFF = /(?:^#|[#&])handoff=([A-Za-z0-9_-]{43})(?:&|$)/;

export function hasBrowserHandoff(): boolean {
	return typeof window !== 'undefined' && HANDOFF.test(window.location.hash);
}

/**
 * Takes the handed-over logins and reloads the page without the fragment, signed in.
 *
 * A link with a code is easy to send someone, so the code is always spent but its logins
 * land only in a browser signed in to nothing, and never turn on "remember across
 * devices": otherwise a planted login could carry the victim's own logins, saved behind
 * it, back to whoever sent the link.
 */
export async function redeemBrowserHandoff(): Promise<void> {
	const code = HANDOFF.exec(window.location.hash)?.[1];
	if (!code) return;
	let state: Record<string, unknown> | null = null;
	try {
		const response = await fetch('/api/handoff/redeem', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code }),
		});
		if (response.ok) state = (await response.json()).state ?? null;
	} catch {
		// Opens signed out, as without a code.
	}
	if (state && !SIGN_IN_KEYS.some((key) => localStorage.getItem(key) !== null)) {
		for (const [key, value] of Object.entries(state)) {
			if (isSyncedKey(key) && key !== SYNC_ENABLED_KEY && typeof value === 'string') {
				localStorage.setItem(key, value);
			}
		}
	}
	// A reload, so every hook reads the logins from the start and none sees them arrive.
	window.history.replaceState(null, '', window.location.pathname + window.location.search);
	window.location.reload();
}
