import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import {
	SPONSOR_TOKEN_TTL_SECONDS,
	signSponsorToken,
	type SponsorSource,
} from '@/utils/sponsorToken';
import { NextApiRequest, NextApiResponse } from 'next';

export interface SponsorLinkResponse {
	isSponsor: boolean;
	sources: SponsorSource[];
	githubUsername?: string;
	/** Signed token, only present for an active sponsor. */
	token?: string;
	expiresIn?: number;
	error?: string;
}

/**
 * Exchanges a gatekeeper DMM API key for a signed sponsor token.
 *
 * The key itself is never stored by dmm - it is checked once, and what the
 * browser keeps afterwards is a short-lived token bound to the Sponsorship ID
 * and the key version.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
	if (!apiKey) {
		return res.status(400).json({ error: 'Missing API key' });
	}

	const lookup = await db.getSponsorByDmmApiKey(apiKey);

	// One message for "no such key" and "key belongs to a lapsed sponsorship"
	// would be friendlier to a lapsed sponsor but tells a guesser which of their
	// keys exist, so the two stay apart only where it costs nothing.
	if (!lookup) {
		return res.status(404).json({ isSponsor: false, sources: [], error: 'Unknown API key' });
	}

	if (!lookup.isSponsor) {
		return res.status(200).json({
			isSponsor: false,
			sources: [],
			githubUsername: lookup.githubUsername,
			error: 'That key belongs to a sponsorship that is no longer active',
		});
	}

	const token = signSponsorToken({
		shortId: lookup.shortId,
		githubUsername: lookup.githubUsername,
		sources: lookup.sources,
		keyVersion: lookup.keyVersion,
		exp: Date.now() + SPONSOR_TOKEN_TTL_SECONDS * 1000,
	});

	const body: SponsorLinkResponse = {
		isSponsor: true,
		sources: lookup.sources,
		githubUsername: lookup.githubUsername,
		token,
		expiresIn: SPONSOR_TOKEN_TTL_SECONDS,
	};
	return res.status(200).json(body);
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.sponsor);
