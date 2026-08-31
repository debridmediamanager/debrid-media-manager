import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import {
	SPONSOR_TOKEN_TTL_SECONDS,
	signSponsorToken,
	verifySponsorToken,
} from '@/utils/sponsorToken';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Re-checks a sponsor token against the live Sponsors row and re-issues it.
 *
 * The client calls this to refresh before expiry. It is also the only place a
 * lapsed or reset sponsorship is noticed sooner than the token's own TTL: the
 * answer comes from the database, not from the token.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const payload = verifySponsorToken(req.headers?.['x-dmm-sponsor'] as string | undefined);
	if (!payload) {
		return res
			.status(401)
			.json({ isSponsor: false, error: 'Invalid or expired sponsor token' });
	}

	const lookup = await db.getSponsorByShortId(payload.shortId);

	// A version bump means the sponsor pressed Reset API Key in gatekeeper, which
	// has to invalidate tokens minted from the old key, not just the key.
	if (!lookup || !lookup.isSponsor || lookup.keyVersion !== payload.keyVersion) {
		return res.status(200).json({ isSponsor: false, sources: [] });
	}

	const token = signSponsorToken({
		shortId: lookup.shortId,
		githubUsername: lookup.githubUsername,
		sources: lookup.sources,
		keyVersion: lookup.keyVersion,
		exp: Date.now() + SPONSOR_TOKEN_TTL_SECONDS * 1000,
	});

	return res.status(200).json({
		isSponsor: true,
		sources: lookup.sources,
		githubUsername: lookup.githubUsername,
		token,
		expiresIn: SPONSOR_TOKEN_TTL_SECONDS,
	});
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.sponsor);
