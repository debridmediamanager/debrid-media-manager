import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { requireSponsor } from '@/utils/requireSponsor';
import type { WantedSummary } from '@/utils/wantedUnread';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The signed-in sponsor's wanted list in one row, `{count, since, lastPolledAt}`:
 * enough for a page to tell whether a zurg is reading it (see wantedUnread)
 * without loading every title on it.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const payload = await requireSponsor(req, res);
	if (!payload) return;
	if (
		!(await checkRateLimitFor(
			`wantedStatus:${payload.shortId}`,
			RATE_LIMIT_CONFIGS.wanted,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}
	try {
		const summary = await db.wantedSummary(payload.shortId);
		const body: WantedSummary = {
			count: summary.count,
			since: summary.since?.toISOString() ?? null,
			lastPolledAt: summary.lastPolledAt?.toISOString() ?? null,
		};
		return res.status(200).json(body);
	} catch (error) {
		console.error('Wanted status failed:', error);
		return res.status(500).json({ error: 'Could not read the wanted list' });
	}
}
