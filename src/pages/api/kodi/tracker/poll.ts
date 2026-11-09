import {
	isTracker,
	isTrackerCode,
	pollDeviceLink,
	unavailableMessage,
} from '@/services/kodiTrackers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Kodi's poll for a Trakt or Simkl link: 202 until the member approves on the tracker,
 * then the tokens (200), or 410 once the code is dead. The device code is a POST body
 * so it never lands in an access log.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const { service, deviceCode } = req.body ?? {};
	if (!isTracker(service) || !isTrackerCode(deviceCode)) {
		return res.status(400).json({ error: 'Missing service or deviceCode' });
	}
	res.setHeader('Cache-Control', 'no-store');
	try {
		const result = await pollDeviceLink(service, deviceCode);
		if (result === 'pending') return res.status(202).json({ status: 'pending' });
		if (result === 'expired') return res.status(410).json({ status: 'expired' });
		return res.status(200).json({ status: 'linked', ...result });
	} catch (error) {
		console.error(
			`[kodi/tracker/poll] ${service}:`,
			error instanceof Error ? error.message : error
		);
		return res.status(503).json({ error: unavailableMessage(service, error) });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.kodiTrackerPoll);
