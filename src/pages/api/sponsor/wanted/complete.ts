import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * zurg's acknowledgement that it fetched a wanted title: `{"id": "<item id>"}`.
 * Safe to repeat; the first date stands. A film is then left off the list zurg
 * reads, a show stays on it. 404 for an id that is not this sponsor's, which
 * includes one the sponsor removed in the meantime.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const sponsor = await sponsorOfDmmApiKeyHeader(req, res);
	if (!sponsor) return;
	if (
		!(await checkRateLimitFor(
			`sponsor:${sponsor.shortId}`,
			RATE_LIMIT_CONFIGS.sponsorWanted,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}
	const id = (req.body as { id?: unknown } | undefined)?.id;
	if (typeof id !== 'string' || !ITEM_ID.test(id)) {
		return res.status(400).json({ error: 'Expected {"id": "<wanted item id>"}' });
	}

	try {
		if (!(await db.markWantedFulfilled(sponsor.shortId, id))) {
			return res.status(404).json({ error: 'Not on this wanted list' });
		}
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error('[sponsor/wanted/complete] failed', error);
		return res.status(500).json({ error: 'Could not record the acknowledgement' });
	}
}
