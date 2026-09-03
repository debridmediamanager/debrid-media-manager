import { repository as db } from '@/services/repository';
import { resolveDebridLinkUser } from '@/utils/debridLinkCastApiHelpers';
import { isSponsorRequest } from '@/utils/requireSponsor';
import { maxOtherStreamsLimit } from '@/utils/sponsorLimits';
import { NextApiRequest, NextApiResponse } from 'next';

// POST, not GET: the credential travels in the body so it never reaches an
// access log or a proxy cache key.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const {
		apiKey,
		refreshToken,
		movieMaxSize,
		episodeMaxSize,
		otherStreamsLimit,
		hideCastOption,
	} = req.body ?? {};

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
		// One account/infos call answers both "is this credential good" and "what
		// is the id" - and one call is the whole budget worth spending against a
		// provider whose throttle costs the endpoint for an hour.
		const { valid, userId } = await resolveDebridLinkUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({ status: 'error', errorMessage: 'Invalid Debrid-Link token' });
			return;
		}

		const profile = await db.saveDebridLinkCastProfile(
			userId,
			apiKey,
			typeof movieMaxSize === 'number' ? movieMaxSize : undefined,
			typeof episodeMaxSize === 'number' ? episodeMaxSize : undefined,
			typeof otherStreamsLimit === 'number' ? otherStreamsLimit : undefined,
			hideCastOption !== undefined ? Boolean(hideCastOption) : undefined,
			// Only a device-flow login sends one. `undefined` leaves a stored one
			// alone, so a member who later pastes an API token does not lose it.
			typeof refreshToken === 'string' && refreshToken ? refreshToken : undefined
		);

		// Whitelisted: the raw row carries the credential and the refresh token.
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
		// Message only: an expanded AxiosError carries `config.data`, which here
		// is the POST body with the credential in it.
		console.error(
			'Error saving Debrid-Link cast profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
