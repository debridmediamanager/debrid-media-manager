import { getToken } from '@/services/realDebrid';
import { Repository } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { clientId, clientSecret, refreshToken } = req.body;

		if (!clientId || !clientSecret) {
			return res.status(400).json({ error: 'Missing required fields' });
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
			refreshToken || null
		);

		return res.status(200).json(profile);
	} catch (error) {
		console.error('Error saving cast profile:', error);
		return res.status(500).json({ error: `Internal Server Error: ${error}` });
	}
}
