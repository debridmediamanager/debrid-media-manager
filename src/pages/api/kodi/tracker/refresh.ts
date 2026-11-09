import { isTracker, isTrackerCode, refreshLink, unavailableMessage } from '@/services/kodiTrackers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Renews a Kodi's Trakt or Simkl access token. 401 `relink` means the tracker refused
 * the grant, so Kodi forgets it and offers to link again. Trakt rotates the refresh
 * token on every use; Simkl hands the same one back. Either way Kodi keeps what we return.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const { service, refreshToken } = req.body ?? {};
	if (!isTracker(service) || !isTrackerCode(refreshToken)) {
		return res.status(400).json({ error: 'Missing service or refreshToken' });
	}
	res.setHeader('Cache-Control', 'no-store');
	try {
		const result = await refreshLink(service, refreshToken);
		if (result === 'relink') return res.status(401).json({ error: 'relink' });
		return res.status(200).json(result);
	} catch (error) {
		console.error(
			`[kodi/tracker/refresh] ${service}:`,
			error instanceof Error ? error.message : error
		);
		return res.status(503).json({ error: unavailableMessage(service, error) });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.kodiTrackerRefresh);
