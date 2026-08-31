import { repository as db } from '@/services/repository';
import { isSponsorRequest } from '@/utils/requireSponsor';
import { maxOtherStreamsLimit } from '@/utils/sponsorLimits';
import { resolveTorBoxUser } from '@/utils/torboxCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey, movieMaxSize, episodeMaxSize, otherStreamsLimit, hideCastOption } = req.body;

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
		// One /user/me call answers both "is this key good" and "what is the id"
		const { valid, userId } = await resolveTorBoxUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Invalid TorBox API key',
			});
			return;
		}

		// Save the profile with settings
		const profile = await db.saveTorBoxCastProfile(
			userId,
			apiKey,
			typeof movieMaxSize === 'number' ? movieMaxSize : undefined,
			typeof episodeMaxSize === 'number' ? episodeMaxSize : undefined,
			typeof otherStreamsLimit === 'number' ? otherStreamsLimit : undefined,
			hideCastOption !== undefined ? Boolean(hideCastOption) : undefined
		);

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
		console.error('Error saving TorBox cast profile:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
