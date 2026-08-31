// Client-side handle on the availability token.
//
// This file used to compute the token *and* its signature in the browser, from a
// hardcoded salt — which meant the salt shipped in the bundle and anyone could
// forge a valid token offline, leaving the `Available` table's writes and
// deletes open to unauthenticated callers. Signing now happens server-side in
// `GET /api/challenge`; this is just a cache in front of it.
//
// `generateTokenAndHash()` keeps its exact signature so all ~20 call sites in the
// hooks and pages are unchanged. It is also cheaper than what it replaces: the
// old version fetched a Real-Debrid timestamp (`getTimeISO`) on every single
// call, once per row per service during a sweep.

interface CachedToken {
	token: string;
	hash: string;
	expiresAt: number;
}

// Held for well under the server's 5-minute TTL so that a token handed out here
// always has a wide margin left when the request carrying it actually lands. The
// margin is what matters: reusing for the near-full TTL would hand a caller a
// token with seconds to live, and a slow sweep on a large library would start
// silently collecting 403s. It also bounds how long a stale token can linger if
// the signing secret is ever rotated under a running tab.
const TOKEN_REUSE_MS = 2 * 60 * 1000;

let cached: CachedToken | null = null;
let inFlight: Promise<[string, string]> | null = null;

async function fetchToken(): Promise<[string, string]> {
	const response = await fetch('/api/challenge');
	if (!response.ok) {
		throw new Error(`Failed to obtain an availability token: ${response.status}`);
	}

	const payload = await response.json();
	if (typeof payload?.token !== 'string' || typeof payload?.hash !== 'string') {
		throw new Error('Malformed availability token response');
	}

	cached = {
		token: payload.token,
		hash: payload.hash,
		expiresAt: Date.now() + TOKEN_REUSE_MS,
	};

	return [payload.token, payload.hash];
}

/**
 * A token/signature pair to send as `dmmProblemKey` + `solution`.
 *
 * Concurrent callers share one in-flight request: a page that starts several
 * sweeps at once should cost one mint, not one per sweep.
 */
export async function generateTokenAndHash(): Promise<[string, string]> {
	if (cached && Date.now() < cached.expiresAt) {
		return [cached.token, cached.hash];
	}

	if (!inFlight) {
		inFlight = fetchToken().finally(() => {
			inFlight = null;
		});
	}

	return inFlight;
}

/** Test seam: drops the cached token and any in-flight mint. */
export function resetTokenCache(): void {
	cached = null;
	inFlight = null;
}
