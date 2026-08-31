import crypto from 'crypto';

// A minted token is presentable for this long. Matches the window the old
// client-side scheme allowed, so a slow availability sweep behaves exactly as
// it did before — a season page that takes four minutes to walk its rows still
// finishes on the token it started with.
const TOKEN_TTL_SECONDS = 300;

let warnedAboutMissingSecret = false;

/**
 * The server-only signing key. Unlike the salt it replaces, this never reaches
 * the browser: nothing under `pages/` outside an API route imports this module.
 */
export function getProblemSecret(): string | undefined {
	const secret = process.env.DMM_PROBLEM_SECRET;
	return secret && secret.length > 0 ? secret : undefined;
}

function sign(token: string, secret: string): string {
	return crypto.createHmac('sha256', secret).update(token).digest('base64url');
}

/**
 * Mint a fresh token/signature pair.
 *
 * The nonce is hex rather than base64url so the `<nonce>-<unixSeconds>` shape
 * stays unambiguously splittable on `-`; base64url's alphabet contains one.
 */
export function mintProblemToken(secret: string, now: number = Date.now()): [string, string] {
	const timestamp = Math.floor(now / 1000);
	const nonce = crypto.randomBytes(16).toString('hex');
	const token = `${nonce}-${timestamp}`;
	return [token, sign(token, secret)];
}

function timingSafeEquals(a: string, b: string): boolean {
	const bufferA = Buffer.from(a, 'utf-8');
	const bufferB = Buffer.from(b, 'utf-8');
	if (bufferA.length !== bufferB.length) {
		return false;
	}
	return crypto.timingSafeEqual(bufferA, bufferB);
}

function parseTimestamp(token: string): number | null {
	const separator = token.lastIndexOf('-');
	if (separator <= 0) {
		return null;
	}
	const timestamp = Number.parseInt(token.slice(separator + 1), 10);
	return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Validate a token presented as `dmmProblemKey` + `solution`.
 *
 * Replaced `validateTokenWithHash`, whose salt shipped in the browser bundle and
 * was therefore mintable offline by anyone — which left the `Available` table
 * open to writes and deletes from unauthenticated callers.
 *
 * The one-release grace period that also accepted those old client-signed tokens
 * ended on 2026-08-31; `legacyProblemToken.ts` is gone and a token is now valid
 * only if this server signed it. That makes `DMM_PROBLEM_SECRET` load-bearing:
 * without it nothing validates, which is why `getProblemSecret` shouts.
 */
export function validateProblemToken(
	token: unknown,
	hash: unknown,
	now: number = Date.now()
): boolean {
	if (typeof token !== 'string' || typeof hash !== 'string' || !token || !hash) {
		return false;
	}

	const timestamp = parseTimestamp(token);
	if (timestamp === null) {
		return false;
	}
	if (Math.abs(Math.floor(now / 1000) - timestamp) > TOKEN_TTL_SECONDS) {
		return false;
	}

	const secret = getProblemSecret();
	if (!secret) {
		// Loud once rather than per request. This is now fail-closed: with no
		// secret there is nothing to verify against, so every caller is refused.
		if (!warnedAboutMissingSecret) {
			warnedAboutMissingSecret = true;
			console.error(
				'DMM_PROBLEM_SECRET is not set — every availability token will be refused'
			);
		}
		return false;
	}

	return timingSafeEquals(sign(token, secret), hash);
}
