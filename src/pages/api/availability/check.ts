import { Repository } from '@/services/repository';
import { validateTokenWithHash } from '@/utils/token';
import { NextApiRequest, NextApiResponse } from 'next';

function isValidImdbId(imdbId: string): boolean {
	return /^tt\d+$/.test(imdbId);
}

function isValidTorrentHash(hash: string): boolean {
	return /^[a-fA-F0-9]{40}$/.test(hash);
}

const db = new Repository();

// check availability with IMDb ID and hashes
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { dmmProblemKey, solution, imdbId, hashes } = req.body;

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

		// Validate imdbId
		if (!imdbId || !isValidImdbId(imdbId)) {
			return res.status(400).json({ error: 'Invalid IMDb ID' });
		}

		// Validate hashes array
		if (!Array.isArray(hashes)) {
			return res.status(400).json({ error: 'Hashes must be an array' });
		}

		if (hashes.length === 0) {
			return res.status(200).json({ available: [] });
		}

		if (hashes.length > 100) {
			return res.status(400).json({ error: 'Maximum 100 hashes allowed' });
		}

		// Validate each hash
		const invalidHash = hashes.find((hash) => !isValidTorrentHash(hash));
		if (invalidHash) {
			return res.status(400).json({
				error: 'Invalid hash format',
				hash: invalidHash,
			});
		}

		const availableHashes = await db.checkAvailability(imdbId, hashes);

		// Return array of found hashes with their file details
		return res.status(200).json({ available: availableHashes });
	} catch (error) {
		console.error('Error checking available hashes:', error);
		return res.status(500).json({ error: 'Failed to check available hashes' });
	}
}
