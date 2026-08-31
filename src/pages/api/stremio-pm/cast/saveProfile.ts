import { repository as db } from '@/services/repository';
import { resolvePremiumizeUser } from '@/utils/premiumizeCastApiHelpers';
import { isSponsorRequest } from '@/utils/requireSponsor';
import { maxOtherStreamsLimit } from '@/utils/sponsorLimits';
import { NextApiRequest, NextApiResponse } from 'next';

// POST, not GET: the API key travels in the body so it never reaches an access
// log or a proxy cache key.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey, movieMaxSize, episodeMaxSize, otherStreamsLimit, hideCastOption } =
		req.body ?? {};

	if (!apiKey || typeof apiKey !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "apiKey" in request body',
		});
		return;
	}

	if (otherStreamsLimit !== undefined) {
		// Sponsors may raise this; everyone else stays at the standard ceiling.
		const maxLimit = maxOtherStreamsLimit(isSponsorRequest(req));
		const limit = Number(otherStreamsLimit);
		if (!Number.isInteger(limit) || limit < 0 || limit > maxLimit) {
			res.status(400).json({
				status: 'error',
				errorMessage: `otherStreamsLimit must be an integer between 0 and ${maxLimit}`,
			});
			return;
		}
	}

	try {
		// One account/info call answers both "is this key good" and "what is the id"
		const { valid, userId } = await resolvePremiumizeUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({ status: 'error', errorMessage: 'Invalid Premiumize API key' });
			return;
		}

		const profile = await db.savePremiumizeCastProfile(
			userId,
			apiKey,
			typeof movieMaxSize === 'number' ? movieMaxSize : undefined,
			typeof episodeMaxSize === 'number' ? episodeMaxSize : undefined,
			typeof otherStreamsLimit === 'number' ? otherStreamsLimit : undefined,
			hideCastOption !== undefined ? Boolean(hideCastOption) : undefined
		);

		// Whitelisted: the raw row carries the API key.
		res.status(200).json({
			status: 'success',
			profile: {
				userId: profile.userId,
				movieMaxSize: profile.movieMaxSize,
				episodeMaxSize: profile.episodeMaxSize,
				otherStreamsLimit: profile.otherStreamsLimit,
				hideCastOption: profile.hideCastOption,
			},
		});
	} catch (error) {
		console.error('Error saving Premiumize cast profile:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
