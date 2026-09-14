import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';
import { SponsorTokenPayload, verifySponsorToken } from './sponsorToken';

export const SPONSOR_HEADER = 'x-dmm-sponsor';

/**
 * Re-checks the sponsorship a verified token names, against the live row.
 *
 * The signature alone only proves the token was minted by us, not that the
 * sponsorship behind it still exists. A token lives SPONSOR_TOKEN_TTL_SECONDS
 * and the client refreshes it only inside the last day, so trusting the
 * signature let a lapsed sponsor keep every gated endpoint for up to a week
 * after their pledge ended, while `pages/api/zurg/auth.ts` and the Newznab and
 * Jellyfin gates — which resolve the row on every request — had already shut.
 * This closes that gap: the token is an identity, and entitlement is read from
 * the database each time, so revocation lands on the next request.
 *
 * Deliberately uncached. `Sponsors.shortId` is unique-indexed and every caller
 * is a person doing something (saving a profile, queueing a job, storing a
 * provider key), never a per-stream path, so the lookup is cheap — and any
 * cache window would be exactly the thing this removes.
 *
 * A version mismatch counts as revoked: gatekeeper's Reset API Key button bumps
 * `dmmApiKeyVersion`, which has to invalidate the tokens minted from the old
 * key and not just the key itself.
 */
async function sponsorshipStillActive(payload: SponsorTokenPayload): Promise<boolean> {
	const lookup = await db.getSponsorByShortId(payload.shortId);
	return !!lookup && lookup.isSponsor && lookup.keyVersion === payload.keyVersion;
}

/**
 * Server-side gate for sponsor-only endpoints. Mirrors validateDmmApiKeyHeader
 * in pages/api/zurg/auth.ts: returns the payload on success, and has already
 * written the response when it returns null.
 *
 * The badge is decorative and lives in localStorage where anyone can forge it.
 * Anything that actually costs something has to come through here instead.
 *
 * The three answers stay apart on purpose, the same way the Newznab gate splits
 * 100 from 101: a sponsor whose pledge lapsed is told so rather than being told
 * their token is bad, and a lookup we could not perform is never reported as a
 * sponsorship that ended.
 */
export async function requireSponsor(
	req: NextApiRequest,
	res: NextApiResponse
): Promise<SponsorTokenPayload | null> {
	const payload = verifySponsorToken(req.headers?.[SPONSOR_HEADER] as string | undefined);
	if (!payload) {
		res.status(401).json({ error: 'Sponsors only' });
		return null;
	}

	let active: boolean;
	try {
		active = await sponsorshipStillActive(payload);
	} catch {
		res.status(503).json({ error: 'Could not verify sponsorship right now' });
		return null;
	}

	if (!active) {
		res.status(401).json({ error: 'Sponsorship is no longer active' });
		return null;
	}

	return payload;
}

/**
 * Whether a request carries a token for a sponsorship that is still active,
 * without writing a response.
 *
 * For endpoints that stay open to everyone but widen a limit for sponsors: a
 * missing, bad or lapsed token is a non-sponsor, not an error. A failed lookup
 * is answered the same way rather than thrown, because these endpoints have to
 * keep working at the ordinary limit when the sponsorship cannot be read.
 */
export async function isSponsorRequest(req: NextApiRequest): Promise<boolean> {
	const payload = verifySponsorToken(req.headers?.[SPONSOR_HEADER] as string | undefined);
	if (!payload) return false;

	try {
		return await sponsorshipStillActive(payload);
	} catch {
		return false;
	}
}
