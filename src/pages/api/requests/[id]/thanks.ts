import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Thank whoever sent one's own request.
 *
 * Owned the same way a cancel is: the caller's Real-Debrid session becomes the
 * DMM id the row was filed under, and that id is part of the update's `where`.
 * Each send can be thanked once, and the fulfiller sees the count on the board.
 */

const RD_TOKEN_HEADER = 'x-rd-access-token';

function readToken(req: NextApiRequest): string | null {
	const header = req.headers[RD_TOKEN_HEADER];
	const token = Array.isArray(header) ? header[0] : header;
	return typeof token === 'string' && token.trim() !== '' ? token.trim() : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const id = req.query.id;
	if (typeof id !== 'string' || id === '') {
		return res.status(400).json({ error: 'request id is required' });
	}

	const token = readToken(req);
	if (!token) {
		return res.status(401).json({ error: 'A Real-Debrid session is required to say thanks' });
	}

	let requesterId: string;
	try {
		requesterId = await generateUserId(token);
	} catch {
		return res.status(401).json({ error: 'Real-Debrid session is not valid' });
	}

	try {
		const fulfillerId = await db.thankContentRequest(id, requesterId);
		if (!fulfillerId) {
			// One answer for every miss, as with a cancel: not yours, not sent by
			// anybody, or already thanked.
			return res.status(409).json({ error: 'that request cannot be thanked' });
		}
		return res.status(200).json({ thanked: true });
	} catch (error) {
		console.error('Thanking a fulfiller failed:', error);
		return res.status(500).json({ error: 'Failed to send thanks' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
