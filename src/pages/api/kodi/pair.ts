import {
	createPairing,
	formatUserCode,
	PAIRING_TTL_SECONDS,
	POLL_INTERVAL_SECONDS,
} from '@/services/kodiPairing';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { NextApiRequest, NextApiResponse } from 'next';

/** Starts a Kodi pairing: the code Kodi shows, and the secret it polls `/api/kodi/poll` with. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	try {
		const { userCode, deviceCode } = await createPairing(getClientIpFromRequest(req));
		const origin = process.env.DMM_ORIGIN || 'https://debridmediamanager.com';
		res.setHeader('Cache-Control', 'no-store');
		return res.status(200).json({
			userCode: formatUserCode(userCode),
			deviceCode,
			verifyUrl: `${origin}/kodi?code=${userCode}`,
			interval: POLL_INTERVAL_SECONDS,
			expiresIn: PAIRING_TTL_SECONDS,
		});
	} catch (error) {
		console.error(
			'[kodi/pair] could not start a pairing:',
			error instanceof Error ? error.message : error
		);
		return res.status(503).json({ error: 'Could not start pairing right now' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.kodiPair);
