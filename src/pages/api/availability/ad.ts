import { repository as db } from '@/services/repository';
import { validateTokenWithHash } from '@/utils/token';
import { NextApiRequest, NextApiResponse } from 'next';

function isValidTorrentHash(hash: string): boolean {
	return /^[a-fA-F0-9]{40}$/i.test(hash);
}

/**
 * POST /api/availability/ad
 * Store AllDebrid cached torrent availability
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const {
			dmmProblemKey,
			solution,
			hash,
			imdbId,
			filename,
			size,
			status,
			statusCode,
			completionDate,
			files,
		} = req.body;

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

		// Validate required fields
		if (!hash || !filename || !imdbId) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		// Validate hash format
		if (!isValidTorrentHash(hash)) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}

		// Validate IMDb ID format
		if (!/^tt\d+$/.test(imdbId)) {
			return res.status(400).json({ error: 'Invalid IMDb ID format' });
		}

		// Validate AllDebrid-specific fields
		if (statusCode !== 4) {
			return res.status(400).json({
				error: 'Invalid statusCode. Only instant torrents (statusCode 4) allowed',
			});
		}

		if (status !== 'Ready') {
			return res.status(400).json({ error: 'Invalid status. Must be "Ready"' });
		}

		// Validate size
		if (!size || size <= 0) {
			return res.status(400).json({ error: 'Size must be greater than 0' });
		}

		// Validate completionDate (must be a valid Unix timestamp)
		if (
			completionDate === undefined ||
			completionDate === null ||
			typeof completionDate !== 'number' ||
			isNaN(completionDate) ||
			completionDate < 0
		) {
			return res
				.status(400)
				.json({ error: 'Invalid completionDate. Must be a valid Unix timestamp (number)' });
		}

		// Validate files array
		if (!Array.isArray(files) || files.length === 0) {
			return res.status(400).json({ error: 'Files must be a non-empty array' });
		}

		// Validate file structure (n and s required, l is optional)
		for (const file of files) {
			if (!file.n || !file.s) {
				return res.status(400).json({
					error: 'Invalid file structure. Each file must have n (name) and s (size)',
				});
			}
		}

		// Store in database
		await db.upsertAvailabilityAd({
			hash: hash.toLowerCase(), // AllDebrid returns lowercase hashes
			imdbId,
			filename,
			size,
			status,
			statusCode,
			completionDate,
			files,
		});

		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error saving AllDebrid availability:', error);
		return res.status(500).json({ error: 'Failed to save AllDebrid availability' });
	}
}
