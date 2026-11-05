import { identifyHandler } from '@/pages/api/library/identify';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { hasInternalSecret } from '@/utils/internalAuth';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The library page's filename identification for DMM's own scrapers (scraps' hashlist
 * ingest): the same `{"items": [{filename, hash?}]}` request, answers and HashIdentification
 * cache as /api/library/identify, behind the internal metadata secret. One budget for every
 * caller, so a backfill never takes the identifier from the library page and zurg.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!hasInternalSecret(req, process.env.METADATA_API_SECRET)) {
		return res.status(401).json({ error: 'Unauthorized' });
	}
	if (!(await checkRateLimitFor('internal', RATE_LIMIT_CONFIGS.metadataIdentify, res))) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}
	return identifyHandler(req, res);
}
