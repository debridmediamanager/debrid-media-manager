import { collectPairing } from '@/services/kodiPairing';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Kodi's poll: 202 until the member approves, then the link once (200), then 410.
 * The device code is a POST body so it never lands in an access log.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const deviceCode = req.body?.deviceCode;
	if (typeof deviceCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(deviceCode)) {
		return res.status(400).json({ error: 'Missing deviceCode' });
	}
	res.setHeader('Cache-Control', 'no-store');
	try {
		const result = await collectPairing(deviceCode);
		if (result === 'pending') return res.status(202).json({ status: 'pending' });
		if (result === 'expired') return res.status(410).json({ status: 'expired' });
		return res.status(200).json({ status: 'linked', ...result });
	} catch (error) {
		console.error('[kodi/poll] lookup failed:', error instanceof Error ? error.message : error);
		return res.status(503).json({ error: 'Could not check the pairing right now' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.kodiPoll);
