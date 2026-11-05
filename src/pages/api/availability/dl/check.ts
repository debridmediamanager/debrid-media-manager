import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import { validateProblemToken } from '@/utils/problemToken';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * POST /api/availability/dl/check
 * Which of up to 100 hashes DMM has seen whole on Debrid-Link, under `imdbId` when one is
 * given (the movie and show pages) or by hash alone (anime pages and the library visit).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!validateOwnPageRequest(req, res)) return;

	try {
		const { dmmProblemKey, solution, imdbId, hashes } = req.body ?? {};

		if (typeof dmmProblemKey !== 'string' || typeof solution !== 'string') {
			return res.status(403).json({ errorMessage: 'Authentication not provided' });
		} else if (!validateProblemToken(dmmProblemKey, solution)) {
			return res.status(403).json({ errorMessage: 'Authentication error' });
		}

		if (imdbId !== undefined && (typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId))) {
			return res.status(400).json({ error: 'Invalid IMDb ID' });
		}
		if (!Array.isArray(hashes)) {
			return res.status(400).json({ error: 'Hashes must be an array' });
		}
		if (hashes.length > 100) {
			return res.status(400).json({ error: 'Maximum 100 hashes allowed' });
		}
		const invalidHash = hashes.find(
			(hash) => typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash)
		);
		if (invalidHash !== undefined) {
			return res.status(400).json({ error: 'Invalid hash format', hash: invalidHash });
		}
		if (hashes.length === 0) return res.status(200).json({ available: [] });

		return res.status(200).json({ available: await db.checkAvailabilityDl(hashes, imdbId) });
	} catch (error) {
		console.error('Error checking Debrid-Link availability:', error);
		return res.status(500).json({ error: 'Failed to check Debrid-Link availability' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.availabilityDl);
