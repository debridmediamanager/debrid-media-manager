import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Where a sponsorship comes from. Mirrors the three sources gatekeeper tracks
 * on the shared `Sponsors` row.
 */
export type SponsorSource = 'github' | 'patreon' | 'onetime';

export interface SponsorTokenPayload {
	/** gatekeeper's 4-character Sponsorship ID, used to re-check on refresh. */
	shortId: string;
	/** GitHub account behind the sponsorship, for the badge. */
	githubUsername: string;
	sources: SponsorSource[];
	/**
	 * `Sponsors.dmmApiKeyVersion` at mint time. gatekeeper's Reset API Key button
	 * bumps it, so a refresh that finds a different version knows the key it was
	 * minted from has been revoked. Without this, Reset would revoke the key but
	 * not the tokens already issued from it.
	 */
	keyVersion: number;
	/** Expiry, epoch milliseconds. */
	exp: number;
}

/**
 * How long a minted token stays valid.
 *
 * This doubles as the revocation window: dmm has no channel for gatekeeper to
 * push "this sponsorship lapsed", so a token that outlives the sponsorship is
 * the failure mode. Seven days keeps a lapsed sponsor's access short-lived
 * while still letting an active one go a week without re-authorising.
 */
export const SPONSOR_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function base64url(input: Buffer | string): string {
	return Buffer.from(input)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function fromBase64url(input: string): Buffer {
	const padded = input.replace(/-/g, '+').replace(/_/g, '/');
	return Buffer.from(padded, 'base64');
}

function getSecret(): string {
	const secret = process.env.DMM_SPONSOR_SECRET;
	if (!secret) {
		throw new Error('DMM_SPONSOR_SECRET environment variable is not set');
	}
	return secret;
}

function sign(body: string, secret: string): string {
	return base64url(createHmac('sha256', secret).update(body).digest());
}

/**
 * Mints a `<payload>.<signature>` token the client stores and replays.
 *
 * The payload is readable by the client on purpose - the badge needs the
 * username and sources without a round trip - but only the signature is
 * trusted, and only ever on the server.
 */
export function signSponsorToken(payload: SponsorTokenPayload): string {
	const body = base64url(JSON.stringify(payload));
	return `${body}.${sign(body, getSecret())}`;
}

/**
 * Verifies a token and returns its payload, or null if it is missing, malformed,
 * forged or expired.
 *
 * Fails closed: an unset secret means nobody is a sponsor, never everybody.
 */
export function verifySponsorToken(token: string | undefined | null): SponsorTokenPayload | null {
	if (!token || typeof token !== 'string') return null;

	const separator = token.lastIndexOf('.');
	if (separator <= 0 || separator === token.length - 1) return null;

	const body = token.slice(0, separator);
	const signature = token.slice(separator + 1);

	let expected: string;
	try {
		expected = sign(body, getSecret());
	} catch {
		return null;
	}

	const given = Buffer.from(signature);
	const want = Buffer.from(expected);
	if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

	let payload: SponsorTokenPayload;
	try {
		payload = JSON.parse(fromBase64url(body).toString('utf8'));
	} catch {
		return null;
	}

	if (
		!payload ||
		typeof payload.shortId !== 'string' ||
		typeof payload.keyVersion !== 'number' ||
		!Array.isArray(payload.sources) ||
		typeof payload.exp !== 'number'
	) {
		return null;
	}

	if (payload.exp <= Date.now()) return null;

	return payload;
}
