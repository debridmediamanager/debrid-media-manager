import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import { validateProblemToken } from '@/utils/problemToken';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * POST /api/availability/dl/remove
 * Forget a release an add found uncached on Debrid-Link, as /api/availability/remove does
 * for Real-Debrid.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!validateOwnPageRequest(req, res)) return;

	try {
		const { dmmProblemKey, solution, hash, reason } = req.body ?? {};

		if (typeof dmmProblemKey !== 'string' || typeof solution !== 'string') {
			return res.status(403).json({ errorMessage: 'Authentication not provided' });
		} else if (!validateProblemToken(dmmProblemKey, solution)) {
			return res.status(403).json({ errorMessage: 'Authentication error' });
		}
		if (typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash)) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}

		await db.removeAvailabilityDl(hash);
		console.log(`Removed false positive Debrid-Link availability: ${hash}, reason: ${reason}`);
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error removing Debrid-Link availability:', error);
		return res.status(500).json({ error: 'Failed to remove Debrid-Link availability' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.availabilityWrite);
