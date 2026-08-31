import { getToken } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { isSponsorRequest } from '@/utils/requireSponsor';
import { maxOtherStreamsLimit } from '@/utils/sponsorLimits';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const {
			clientId,
			clientSecret,
			refreshToken,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption,
		} = req.body;

		if (!clientId || !clientSecret) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		if (
			movieMaxSize === undefined &&
			episodeMaxSize === undefined &&
			otherStreamsLimit === undefined &&
			hideCastOption === undefined
		) {
			return res.status(400).json({
				error: 'At least one setting must be provided',
			});
		}

		if (otherStreamsLimit !== undefined) {
			// Sponsors may raise this; everyone else stays at the standard ceiling.
			const maxLimit = maxOtherStreamsLimit(isSponsorRequest(req));
			const limit = Number(otherStreamsLimit);
			if (!Number.isInteger(limit) || limit < 0 || limit > maxLimit) {
				return res.status(400).json({
					error: `otherStreamsLimit must be an integer between 0 and ${maxLimit}`,
				});
			}
		}

		let response: { access_token: string } | null = null;
		try {
			response = await getToken(clientId, clientSecret, refreshToken, true);
			if (!response) {
				throw new Error(`no token found`);
			}
		} catch (error) {
			// Message only — see the same catch in `saveProfile.ts`. Expanding an
			// AxiosError prints `config.data`, which here is the OAuth POST body
			// carrying the caller's clientSecret and refresh token.
			console.error(
				'Failed to get a Real-Debrid token while updating size limits:',
				error instanceof Error ? error.message : String(error)
			);
			res.status(500).json({ error: `Failed to get Real-Debrid token: ${error}` });
			return;
		}

		const userid = await generateUserId(response.access_token);

		const profile = await db.saveCastProfile(
			userid,
			clientId,
			clientSecret,
			refreshToken || null,
			movieMaxSize !== undefined ? Number(movieMaxSize) : undefined,
			episodeMaxSize !== undefined ? Number(episodeMaxSize) : undefined,
			otherStreamsLimit !== undefined ? Number(otherStreamsLimit) : undefined,
			hideCastOption !== undefined ? Boolean(hideCastOption) : undefined
		);

		// Whitelisted — the raw row carries the credentials. See `saveProfile.ts`.
		return res.status(200).json({
			userId: profile.userId,
			movieMaxSize: profile.movieMaxSize,
			episodeMaxSize: profile.episodeMaxSize,
			otherStreamsLimit: profile.otherStreamsLimit,
			hideCastOption: profile.hideCastOption,
		});
	} catch (error) {
		console.error('Error updating size limits:', error);
		return res.status(500).json({ error: `Internal Server Error: ${error}` });
	}
}
