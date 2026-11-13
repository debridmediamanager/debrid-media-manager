import { validateLibraryCaller } from '@/pages/api/library/identify';
import { mediaInfoHandler } from '@/pages/api/sponsor/mediainfo';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The stored probes of the releases a library holds, as /api/sponsor/mediainfo answers
 * them, for a DMM page or the DMM Mobile app proving a provider login in `identity`
 * (validateLibraryCaller): the app shows each copy's HDR format, audio and subtitles.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!(await validateLibraryCaller(req, res))) return;
	return mediaInfoHandler(req, res);
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.libraryMediaInfo);
