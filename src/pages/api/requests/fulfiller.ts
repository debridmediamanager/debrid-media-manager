import { creditFulfiller, fulfillerStats } from '@/services/fulfillerRewards';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { torboxUserId } from '@/utils/torboxIdentity';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * A fulfiller's own sends, thanks and reward (`GET`), and tying them to the
 * gatekeeper sponsorship that collects the reward (`POST`).
 *
 * A fulfiller is known by whichever id they fulfilled under: their
 * Real-Debrid-derived DMM id when they had a session, their TorBox id when they
 * did not (see the fulfil route). Both are read here, so sends made either way
 * count for the same person. Keys are headers, as on the rest of the board.
 */

const RD_TOKEN_HEADER = 'x-rd-access-token';
const TB_KEY_HEADER = 'x-tb-api-key';

function header(req: NextApiRequest, name: string): string | null {
	const value = req.headers[name];
	const v = Array.isArray(value) ? value[0] : value;
	return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Every id the caller can prove, from their Real-Debrid session and TorBox key. */
async function fulfillerIdsOf(req: NextApiRequest): Promise<string[]> {
	const rdToken = header(req, RD_TOKEN_HEADER);
	const tbKey = header(req, TB_KEY_HEADER);
	const [rdId, tbId] = await Promise.all([
		rdToken ? generateUserId(rdToken).catch(() => null) : null,
		tbKey ? torboxUserId(tbKey) : null,
	]);
	return [rdId, tbId].filter((id): id is string => Boolean(id));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'POST') {
		res.setHeader('Allow', 'GET, POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const ids = await fulfillerIdsOf(req);
	if (ids.length === 0) {
		return res.status(401).json({ error: 'A TorBox key or Real-Debrid session is required' });
	}

	if (req.method === 'POST') {
		const { apiKey, showName } = (req.body ?? {}) as { apiKey?: unknown; showName?: unknown };
		const key = typeof apiKey === 'string' ? apiKey.trim() : '';
		if (!key) return res.status(400).json({ error: 'a DMM API key is required' });
		// Any gatekeeper account has a key, sponsor or not: earning sponsor time
		// is open to people who have never paid.
		const sponsorship = await db.getSponsorByDmmApiKey(key);
		if (!sponsorship) return res.status(404).json({ error: 'Unknown DMM API key' });
		try {
			await db.linkFulfillers(ids, sponsorship.shortId, showName === true);
			// Sends made before linking count too.
			await creditFulfiller(ids[0]);
		} catch (error) {
			console.error('Linking a fulfiller failed:', error);
			return res.status(500).json({ error: 'Failed to link' });
		}
	}

	try {
		return res.status(200).json(await fulfillerStats(ids));
	} catch (error) {
		console.error('Reading fulfiller stats failed:', error);
		return res.status(500).json({ error: 'Failed to read your sends' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
