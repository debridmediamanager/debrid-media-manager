import { Repository } from '@/services/repository';
import { validateTokenWithHash } from '@/utils/token';
import { NextApiRequest, NextApiResponse } from 'next';

function isValidTorrentHash(hash: string): boolean {
	return /^[a-fA-F0-9]{40}$/.test(hash);
}

const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { dmmProblemKey, solution, hash, reason } = req.body;

		// Validate authentication
		if (
			!dmmProblemKey ||
			!(typeof dmmProblemKey === 'string') ||
			!solution ||
			!(typeof solution === 'string')
		) {
			res.status(403).json({ errorMessage: 'Authentication not provided' });
			return;
		} else if (!(await validateTokenWithHash(dmmProblemKey.toString(), solution.toString()))) {
			res.status(403).json({ errorMessage: 'Authentication error' });
			return;
		}

		// Validate hash
		if (!hash || !isValidTorrentHash(hash)) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}

		// Remove availability record
		await db.removeAvailability(hash);

		console.log(`Removed false positive availability: ${hash}, reason: ${reason}`);

		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error removing availability:', error);
		return res.status(500).json({ error: 'Failed to remove availability' });
	}
}
