import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { userid } = req.query;
		const { clientId, clientSecret, refreshToken } = req.body;

		if (!userid || typeof userid !== 'string') {
			return res.status(400).json({ error: 'Invalid userId' });
		}

		if (!clientId || !clientSecret) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		const profile = await db.saveCastProfile(
			userid,
			clientId,
			clientSecret,
			refreshToken || null
		);

		return res.status(200).json(profile);
	} catch (error) {
		console.error('Error saving cast profile:', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}
