import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Withdraw one's own request.
 *
 * The board is public and its ids travel with it, so ownership cannot be taken
 * on trust: the caller's Real-Debrid session is turned into the same DMM id the
 * row was filed under, and the id is part of the `where` clause rather than
 * something checked first. A stranger holding the id changes nothing.
 *
 * Only `open` and `failed` rows can be withdrawn — the same pair a fulfiller
 * may claim. Cancelling a `claimed` row would leave somebody mid-transfer
 * spending their own quota on a request that no longer exists, and a
 * `fulfilled` one has already landed in the asker's library.
 */

const RD_TOKEN_HEADER = 'x-rd-access-token';

function readToken(req: NextApiRequest): string | null {
	const header = req.headers[RD_TOKEN_HEADER];
	const token = Array.isArray(header) ? header[0] : header;
	return typeof token === 'string' && token.trim() !== '' ? token.trim() : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'DELETE') {
		res.setHeader('Allow', 'DELETE');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const id = req.query.id;
	if (typeof id !== 'string' || id === '') {
		return res.status(400).json({ error: 'request id is required' });
	}

	const token = readToken(req);
	if (!token) {
		return res.status(401).json({ error: 'A Real-Debrid session is required to cancel' });
	}

	let requesterId: string;
	try {
		requesterId = await generateUserId(token);
	} catch {
		return res.status(401).json({ error: 'Real-Debrid session is not valid' });
	}

	try {
		const cancelled = await db.cancelContentRequest(id, requesterId);
		if (!cancelled) {
			// One answer for "not yours", "not there" and "already taken". Telling
			// them apart would let anyone holding an id learn whether it exists and
			// who it belongs to, and the caller can do nothing differently either way.
			return res.status(409).json({ error: 'that request is not yours to cancel' });
		}
		return res.status(200).json({ cancelled: true });
	} catch (error) {
		console.error('Cancelling a content request failed:', error);
		return res.status(500).json({ error: 'Failed to cancel the request' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
