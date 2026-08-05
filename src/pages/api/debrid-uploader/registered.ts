import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

// Given a batch of original torrent hashes shown on a movie/show page, report
// which already have a COMPLETED TB → RD transfer (and the rewritten hash the
// user should redeem instead). Lets the UI suppress the redundant "TB → RD"
// button on rows whose content is already in RD under a rewritten hash.
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { hashes } = req.body ?? {};
	if (!Array.isArray(hashes) || hashes.length === 0) {
		return res.status(400).json({ error: 'hashes must be a non-empty array' });
	}
	if (hashes.length > 200) {
		return res.status(400).json({ error: 'too many hashes (max 200)' });
	}

	const valid = hashes.filter(
		(h: unknown): h is string => typeof h === 'string' && /^[a-fA-F0-9]{40}$/.test(h)
	);
	if (valid.length === 0) {
		return res.status(200).json({ transferred: [] });
	}

	try {
		const records = await db.getDebridTransfers(valid);
		const transferred = records
			.filter((r) => r.status === 'completed' && r.rewrittenHash)
			.map((r) => ({ originalHash: r.originalHash, rewrittenHash: r.rewrittenHash }));
		return res.status(200).json({ transferred });
	} catch (error) {
		console.error('Debrid transfer lookup failed:', error);
		return res.status(500).json({ error: 'lookup failed' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
