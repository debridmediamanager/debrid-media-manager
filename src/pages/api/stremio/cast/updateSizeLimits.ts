import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { castAccessToken } from '@/utils/castRdToken';
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
			apiKey,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption,
		} = req.body;

		// Same either/or as `saveProfile.ts`: an API-key session has no clientId
		// to send, and rejecting it here made the settings panel a no-op for
		// those users rather than an error they could see.
		const credentials = apiKey ? { apiKey } : { clientId, clientSecret, refreshToken };
		if (!credentials.apiKey && (!clientId || !clientSecret)) {
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

		let accessToken: string | null = null;
		try {
			accessToken = await castAccessToken(credentials);
			if (!accessToken) {
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

		const userid = await generateUserId(accessToken);

		const profile = await db.saveCastProfile(
			userid,
			credentials,
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
