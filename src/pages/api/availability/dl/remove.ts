import { probeDlRelease } from '@/services/debridLink';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import { validateProblemToken } from '@/utils/problemToken';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * POST /api/availability/dl/remove
 * Forget a Debrid-Link release only when Debrid-Link itself, asked by DMM, no longer holds it
 * whole; never on a caller's word.
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

		const answer = await probeDlRelease(hash);
		if (answer === null) {
			return res.status(503).json({ error: 'Debrid-Link did not answer for this release' });
		}
		if (answer.cached) {
			return res.status(409).json({ error: 'Debrid-Link still holds this release' });
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
