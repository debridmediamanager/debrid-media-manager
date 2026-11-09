import { isTracker, startDeviceLink, unavailableMessage } from '@/services/kodiTrackers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Starts linking Trakt or Simkl from Kodi: the tracker's own code and approve page,
 * and the device code Kodi polls `/api/kodi/tracker/poll` with.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const service = req.body?.service;
	if (!isTracker(service)) {
		return res.status(400).json({ error: 'DMM links trakt or simkl' });
	}
	res.setHeader('Cache-Control', 'no-store');
	try {
		return res.status(200).json({ service, ...(await startDeviceLink(service)) });
	} catch (error) {
		console.error(
			`[kodi/tracker/start] ${service}:`,
			error instanceof Error ? error.message : error
		);
		return res.status(503).json({ error: unavailableMessage(service, error) });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.kodiTrackerStart);
