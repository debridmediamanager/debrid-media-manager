import { identifyHandler } from '@/pages/api/library/identify';
import { validateDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The library page's filename identification, for a sponsor's own tools: the same
 * request, answers and HashIdentification cache as /api/library/identify, gated on
 * an active sponsor's DMM API key in `x-api-key`.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!(await validateDmmApiKeyHeader(req, res))) return;
	return identifyHandler(req, res);
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.sponsorIdentify);
