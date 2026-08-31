import crypto from 'crypto';

import { validateLegacyProblemToken } from './legacyProblemToken';

// A minted token is presentable for this long. Matches the window the old
// client-side scheme allowed, so a slow availability sweep behaves exactly as
// it did before — a season page that takes four minutes to walk its rows still
// finishes on the token it started with.
const TOKEN_TTL_SECONDS = 300;

let warnedAboutMissingSecret = false;

/**
 * Whether a token from the old client-side scheme is still accepted.
 *
 * On by default for the changeover. Set `DMM_PROBLEM_LEGACY=off` to refuse them
 * — which is the end state, and what the tests exercise to prove the forgeable
 * scheme is genuinely closed rather than merely superseded.
 */
function legacyTokensAccepted(): boolean {
	return process.env.DMM_PROBLEM_LEGACY !== 'off';
}

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
 * Replaces `validateTokenWithHash`, whose salt shipped in the browser bundle and
 * was therefore mintable offline by anyone — which left the `Available` table
 * open to writes and deletes from unauthenticated callers.
 *
 * The legacy branch is transitional: it keeps a tab that loaded the previous
 * bundle working until it reloads. Remove it, and `legacyProblemToken.ts`, next
 * release — at which point a missing `DMM_PROBLEM_SECRET` starts refusing every
 * caller, so the env var must be provisioned before that lands.
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
	if (secret) {
		if (timingSafeEquals(sign(token, secret), hash)) {
			return true;
		}
	} else if (!warnedAboutMissingSecret) {
		// Loud once rather than per request: without the secret only the legacy
		// (forgeable) branch can pass, which is the state this change exists to
		// end.
		warnedAboutMissingSecret = true;
		console.error(
			'DMM_PROBLEM_SECRET is not set — availability tokens fall back to the legacy forgeable scheme'
		);
	}

	if (!legacyTokensAccepted()) {
		return false;
	}

	return validateLegacyProblemToken(token, hash, now);
}
