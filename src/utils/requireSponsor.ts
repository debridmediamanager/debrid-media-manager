import { NextApiRequest, NextApiResponse } from 'next';
import { SponsorTokenPayload, verifySponsorToken } from './sponsorToken';

export const SPONSOR_HEADER = 'x-dmm-sponsor';

/**
 * Server-side gate for sponsor-only endpoints. Mirrors validateDmmApiKeyHeader
 * in pages/api/zurg/auth.ts: returns the payload on success, and has already
 * written the 401 when it returns null.
 *
 * The badge is decorative and lives in localStorage where anyone can forge it.
 * Anything that actually costs something has to come through here instead.
 */
export function requireSponsor(
	req: NextApiRequest,
	res: NextApiResponse
): SponsorTokenPayload | null {
	const payload = verifySponsorToken(req.headers?.[SPONSOR_HEADER] as string | undefined);
	if (!payload) {
		res.status(401).json({ error: 'Sponsors only' });
		return null;
	}
	return payload;
}

/**
 * Whether a request carries a valid sponsor token, without writing a response.
 *
 * For endpoints that stay open to everyone but widen a limit for sponsors: a
 * missing or bad token is a non-sponsor, not an error.
 */
export function isSponsorRequest(req: NextApiRequest): boolean {
	return verifySponsorToken(req.headers?.[SPONSOR_HEADER] as string | undefined) !== null;
}
