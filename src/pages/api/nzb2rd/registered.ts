import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

// Given the release ids shown in the Usenet section of a movie/show page, report
// which already have a transfer — completed (the content is in RD under the
// returned info hash) or still running. Lets the section show "In RD" / "Sending"
// instead of a Send button that would only be rejected as a duplicate, and makes
// one user's fetch visible to everyone else looking at the same title.
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { ids } = req.body ?? {};
	if (!Array.isArray(ids) || ids.length === 0) {
		return res.status(400).json({ error: 'ids must be a non-empty array' });
	}
	if (ids.length > 200) {
		return res.status(400).json({ error: 'too many ids (max 200)' });
	}

	const valid = ids.filter(
		(id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(id)
	);
	if (valid.length === 0) {
		return res.status(200).json({ transfers: [] });
	}

	try {
		const records = await db.getNzb2rdTransfers(valid);
		const transfers = records.map((r) => ({
			releaseId: r.releaseId,
			status: r.status,
			infoHash: r.infoHash ?? null,
			jobId: r.jobId,
		}));
		return res.status(200).json({ transfers });
	} catch (error) {
		console.error('nzb2rd transfer lookup failed:', error);
		return res.status(500).json({ error: 'lookup failed' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
