import { takeHandoff } from '@/services/devicePairing';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import { NextApiRequest, NextApiResponse } from 'next';

/** A DMM page taking the state DMM Mobile handed over: once (200), then 410. */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!validateOwnPageRequest(req, res)) return;
	const code = req.body?.code;
	if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
		return res.status(400).json({ error: 'Missing code' });
	}
	res.setHeader('Cache-Control', 'no-store');
	try {
		const state = await takeHandoff(code);
		return state
			? res.status(200).json({ state })
			: res.status(410).json({ status: 'expired' });
	} catch (error) {
		console.error('[handoff/redeem] failed:', error instanceof Error ? error.message : error);
		return res.status(503).json({ error: 'Could not take the handoff right now' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.handoffRedeem);
