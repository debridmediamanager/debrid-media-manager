import { getToken } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
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

		if (otherStreamsLimit !== undefined) {
			const limit = Number(otherStreamsLimit);
			if (!Number.isInteger(limit) || limit < 0 || limit > 5) {
				return res.status(400).json({
					error: 'otherStreamsLimit must be an integer between 0 and 5',
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
			console.error(error);
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

		return res.status(200).json(profile);
	} catch (error) {
		console.error('Error saving cast profile:', error);
		return res.status(500).json({ error: `Internal Server Error: ${error}` });
	}
}
