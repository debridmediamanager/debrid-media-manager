import { approvePairing, normalizeUserCode } from '@/services/devicePairing';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { BrowserState, isSyncedKey, MAX_STATE_BYTES, SIGN_IN_KEYS } from '@/utils/browserStateKeys';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * The signed-in browser approving a TV's code with what "remember across devices" carries:
 * the raw localStorage strings of the synced keys, logins included. DMM Mobile talks to the
 * providers itself, so the TV gets the logins, not DMM Cast addons as Kodi does. Anything
 * else the browser sends is dropped. Answers which services went over, never their keys.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userCode = normalizeUserCode(req.body?.userCode);
	if (!userCode) {
		return res.status(400).json({ error: 'That is not a TV code. It looks like ABCD-EFGH.' });
	}
	const sent: Record<string, unknown> =
		req.body?.state && typeof req.body.state === 'object' ? req.body.state : {};
	const state: BrowserState = Object.fromEntries(
		Object.entries(sent).filter(
			(entry): entry is [string, string] =>
				isSyncedKey(entry[0]) && typeof entry[1] === 'string'
		)
	);
	if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) {
		return res.status(413).json({
			error: 'This browser holds more DMM settings than a TV can be sent. Try again from another browser.',
		});
	}
	const services = [
		...new Set(SIGN_IN_KEYS.filter((key) => state[key]).map((key) => key.split(':')[0])),
	];
	if (!services.length) {
		return res.status(400).json({
			error: 'Nothing to link yet. Sign in to a debrid service on DMM first, then try again.',
		});
	}

	try {
		const result = await approvePairing(
			'tv',
			userCode,
			() => ({ state }),
			getClientIpFromRequest(req),
			req.body?.confirmOtherNetwork === true
		);
		if (result === 'other-network') {
			return res.status(428).json({
				otherNetwork: true,
				error: 'This TV is on a different internet connection from this browser. Link it only if the code is on your own TV right now. A link someone sent you could be theirs.',
			});
		}
		if (result === 'unknown') {
			return res.status(404).json({
				error: 'DMM Mobile does not know that code. Check it, or start signing in on the TV again for a new one.',
			});
		}
		if (result === 'used') {
			return res.status(409).json({
				error: 'That code was already used. DMM Mobile shows a new one if you start again.',
			});
		}
		return res.status(200).json({ services });
	} catch (error) {
		console.error('[tv/approve] failed:', error instanceof Error ? error.message : error);
		return res
			.status(503)
			.json({ error: 'Could not link your TV right now. Try again in a minute.' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.tvApprove);
