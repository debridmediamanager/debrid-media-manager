import { checkEasynewsLogin, EasynewsAuthError, readCredentials } from '@/services/easynews';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

// Checks an Easynews login before Settings keeps it, so a typo is not saved.
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const credentials = readCredentials(req.body);
	if (!credentials) {
		return res.status(400).json({ error: 'Easynews username and password are required' });
	}

	try {
		await checkEasynewsLogin(credentials);
		res.setHeader('Cache-Control', 'private, no-store');
		return res.status(200).json({ ok: true });
	} catch (error) {
		if (error instanceof EasynewsAuthError) {
			return res.status(401).json({ error: error.message });
		}
		console.error('Easynews login check failed:', error);
		return res.status(502).json({ error: 'Could not reach Easynews' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
