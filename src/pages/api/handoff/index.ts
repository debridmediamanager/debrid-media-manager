import { createHandoff, HANDOFF_TTL_SECONDS } from '@/services/devicePairing';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { MAX_STATE_BYTES, pickSyncedState, signedInServices } from '@/utils/browserStateKeys';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * DMM Mobile, about to open a DMM page in the phone's browser, leaves its synced state
 * (logins included, as "remember across devices" carries them) behind a one-time code.
 * The app puts the code in the page link's fragment, `#handoff=<code>`, and the page
 * takes the state through /api/handoff/redeem.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const state = pickSyncedState(req.body?.state);
	if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) {
		return res.status(413).json({ error: 'State too large' });
	}
	if (!signedInServices(state).length) {
		return res.status(400).json({ error: 'No debrid login to hand over' });
	}
	try {
		const code = await createHandoff(state);
		res.setHeader('Cache-Control', 'no-store');
		return res.status(200).json({ code, expiresIn: HANDOFF_TTL_SECONDS });
	} catch (error) {
		console.error('[handoff] failed:', error instanceof Error ? error.message : error);
		return res.status(503).json({ error: 'Could not hand over right now' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.handoff);
