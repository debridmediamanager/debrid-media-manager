import { repository as db } from '@/services/repository';
import { resolveAllDebridUser } from '@/utils/allDebridCastApiHelpers';
import { isSponsorRequest } from '@/utils/requireSponsor';
import { maxOtherStreamsLimit } from '@/utils/sponsorLimits';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Updates cast settings for an AllDebrid profile.
 *
 * Two ways in:
 *   - `castToken`: settings-only update of a profile that already exists. Costs
 *     no AllDebrid call, so routine resyncs never make AllDebrid see our server
 *     using the member's key. 404s if the profile is gone, letting the client
 *     fall back to the `apiKey` path.
 *   - `apiKey`: full upsert that also refreshes the stored key. One AllDebrid
 *     call. Only needed on enrolment or after the member rotates their key.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, private');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey, castToken, movieMaxSize, episodeMaxSize, otherStreamsLimit, hideCastOption } =
		req.body;

	const hasCastToken = typeof castToken === 'string' && castToken.length > 0;

	if (!hasCastToken && (!apiKey || typeof apiKey !== 'string')) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "castToken" or "apiKey" in request body',
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

	const movie = typeof movieMaxSize === 'number' ? movieMaxSize : undefined;
	const episode = typeof episodeMaxSize === 'number' ? episodeMaxSize : undefined;
	const streams = typeof otherStreamsLimit === 'number' ? otherStreamsLimit : undefined;
	const hideCast = hideCastOption !== undefined ? Boolean(hideCastOption) : undefined;

	try {
		if (hasCastToken) {
			const updated = await db.updateAllDebridCastSettings(
				castToken,
				movie,
				episode,
				streams,
				hideCast
			);

			if (!updated) {
				res.status(404).json({
					status: 'error',
					errorMessage: 'No AllDebrid cast profile for that token',
				});
				return;
			}

			res.status(200).json({ status: 'success', profile: { userId: castToken } });
			return;
		}

		// Validates the key and derives the user id in a single AllDebrid call
		const { valid, userId } = await resolveAllDebridUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Invalid AllDebrid API key',
			});
			return;
		}

		const profile = await db.saveAllDebridCastProfile(
			userId,
			apiKey,
			movie,
			episode,
			streams,
			hideCast
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
		console.error('Error updating AllDebrid size limits:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
