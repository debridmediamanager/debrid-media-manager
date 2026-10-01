import { MAX_PLAYABLE_HASHES } from '@/utils/availability';
import { validateProblemToken } from '@/utils/problemToken';
import { NextApiRequest, NextApiResponse } from 'next';
import { repository as db } from '../../../services/repository';

const SERVICES = ['rd', 'ad'] as const;
type Service = (typeof SERVICES)[number];

function isValidTorrentHash(hash: unknown): hash is string {
	return typeof hash === 'string' && /^[a-fA-F0-9]{40}$/.test(hash);
}

// Which hashes are cached with a playable video, by hash alone. The hashlist
// page needs only that bit per row; check2 and ad/check2 answer the same
// question with every file row, 100 hashes at a time.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { dmmProblemKey, solution, service, hashes } = req.body ?? {};

		if (
			!dmmProblemKey ||
			typeof dmmProblemKey !== 'string' ||
			!solution ||
			typeof solution !== 'string'
		) {
			return res.status(403).json({ errorMessage: 'Authentication not provided' });
		}
		if (!validateProblemToken(dmmProblemKey, solution)) {
			return res.status(403).json({ errorMessage: 'Authentication error' });
		}

		if (!SERVICES.includes(service)) {
			return res.status(400).json({ error: 'Service must be rd or ad' });
		}
		if (!Array.isArray(hashes)) {
			return res.status(400).json({ error: 'Hashes must be an array' });
		}
		if (hashes.length > MAX_PLAYABLE_HASHES) {
			return res.status(400).json({ error: `Maximum ${MAX_PLAYABLE_HASHES} hashes allowed` });
		}
		const invalidHash = hashes.find((hash) => !isValidTorrentHash(hash));
		if (invalidHash !== undefined) {
			return res.status(400).json({ error: 'Invalid hash format', hash: invalidHash });
		}
		if (hashes.length === 0) {
			return res.status(200).json({ cached: [] });
		}

		const cached =
			(service as Service) === 'rd'
				? await db.filterPlayableCachedHashes(hashes)
				: await db.filterPlayableCachedHashesAd(hashes);

		return res.status(200).json({ cached: [...cached] });
	} catch (error) {
		console.error('Error checking playable cached hashes:', error);
		return res.status(500).json({ error: 'Failed to check available hashes' });
	}
}
