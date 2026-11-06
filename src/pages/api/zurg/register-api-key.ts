import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { validForDays } = req.body;

		// Authentication validation - check for DMMCAST_SALT header
		const authHeader = req.headers['authorization'];
		if (!authHeader || typeof authHeader !== 'string') {
			return res.status(401).json({ error: 'Missing Authorization header' });
		}

		// Validate the salt matches environment variable
		const expectedSalt = process.env.DMMCAST_SALT;
		if (!expectedSalt || expectedSalt === 'your-random-salt-here') {
			console.error('DMMCAST_SALT environment variable is not set securely');
			return res.status(500).json({ error: 'Server configuration error: DMMCAST_SALT must be configured securely' });
		}

		if (authHeader !== expectedSalt) {
			return res.status(401).json({ error: 'Invalid authorization' });
		}

		// Validate validForDays
		const days = validForDays ?? 30; // Default to 30 days
		if (typeof days !== 'number' || days < 1 || days > 365) {
			return res.status(400).json({
				error: 'validForDays must be a number between 1 and 365',
			});
		}

		// Calculate expiration date
		const validUntil = new Date();
		validUntil.setDate(validUntil.getDate() + days);

		// Create the API key
		const apiKey = await db.createZurgApiKey(validUntil);

		return res.status(200).json({
			apiKey,
			validUntil: validUntil.toISOString(),
			createdAt: new Date().toISOString(),
			expiresInDays: days,
		});
	} catch (error) {
		console.error('Error creating Zurg API key:', error);
		return res.status(500).json({
			error: 'Failed to create API key',
			details: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.zurgAdmin);
