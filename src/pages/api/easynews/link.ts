import {
	EasynewsAuthError,
	isEasynewsPath,
	readCredentials,
	resolveEasynewsLink,
} from '@/services/easynews';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

// One Easynews result as a signed download link, minted with the caller's own
// account. The link carries no login, so it can go to a browser or player as is.
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const credentials = readCredentials(req.body);
	if (!credentials) {
		return res.status(400).json({ error: 'Easynews username and password are required' });
	}
	const path = req.body?.path;
	if (!isEasynewsPath(path)) {
		return res.status(400).json({ error: 'path must be an Easynews result path' });
	}

	try {
		const url = await resolveEasynewsLink(credentials, path);
		res.setHeader('Cache-Control', 'private, no-store');
		return res.status(200).json({ url });
	} catch (error) {
		if (error instanceof EasynewsAuthError) {
			return res.status(401).json({ error: error.message });
		}
		console.error('Easynews link failed:', error);
		return res.status(502).json({ error: 'Easynews did not hand out a link' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
