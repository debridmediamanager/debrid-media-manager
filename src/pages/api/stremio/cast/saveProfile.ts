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

		// Either credential is a complete Real-Debrid session: the device-code
		// triple, or a key pasted on `/realdebrid/login`, which stores nothing
		// else. Demanding a clientId is what left API-key users unable to save a
		// cast profile at all.
		const credentials = apiKey ? { apiKey } : { clientId, clientSecret, refreshToken };
		if (!credentials.apiKey && (!clientId || !clientSecret)) {
			return res.status(400).json({ error: 'Missing required fields' });
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
			// Only the message. `console.error(err)` on an AxiosError expands the
			// whole object, and `config.data` here is the OAuth POST body — so the
			// bare form wrote clientId, clientSecret *and* the refresh token into
			// the container logs every time Real-Debrid refused a refresh.
			// Interpolating into a string is safe: AxiosError.toString() is just
			// "Request failed with status code 400".
			console.error(
				'Failed to get a Real-Debrid token for a cast profile:',
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

		// Whitelisted, matching the TorBox and AllDebrid cast endpoints. The raw
		// Prisma row carries clientId/clientSecret/refreshToken, and returning it
		// echoed the caller's long-lived Real-Debrid credentials back over the
		// wire for no reason — nothing client-side reads this body beyond `res.ok`.
		return res.status(200).json({
			userId: profile.userId,
			movieMaxSize: profile.movieMaxSize,
			episodeMaxSize: profile.episodeMaxSize,
			otherStreamsLimit: profile.otherStreamsLimit,
			hideCastOption: profile.hideCastOption,
		});
	} catch (error) {
		console.error('Error saving cast profile:', error);
		return res.status(500).json({ error: `Internal Server Error: ${error}` });
	}
}
