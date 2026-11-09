import { kodiOrigin } from '@/pages/api/kodi/pair';
import {
	createPairing,
	formatUserCode,
	PAIRING_TTL_SECONDS,
	POLL_INTERVAL_SECONDS,
} from '@/services/devicePairing';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Starts a DMM Mobile pairing on a TV: the code the TV shows (and a QR of `verifyUrl`), and
 * the secret it polls `/api/tv/poll` with. Called by the app itself, which sends no Origin.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	try {
		const origin = kodiOrigin(req);
		const { userCode, deviceCode } = await createPairing(
			'tv',
			getClientIpFromRequest(req),
			origin
		);
		res.setHeader('Cache-Control', 'no-store');
		return res.status(200).json({
			userCode: formatUserCode(userCode),
			deviceCode,
			verifyUrl: `${origin}/tv?code=${userCode}`,
			interval: POLL_INTERVAL_SECONDS,
			expiresIn: PAIRING_TTL_SECONDS,
		});
	} catch (error) {
		console.error(
			'[tv/pair] could not start a pairing:',
			error instanceof Error ? error.message : error
		);
		return res.status(503).json({ error: 'Could not start pairing right now' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.tvPair);
