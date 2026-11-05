import { repository as db } from '@/services/repository';
import { validateProblemToken } from '@/utils/problemToken';
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
		} else if (!validateProblemToken(dmmProblemKey, solution)) {
			res.status(403).json({ errorMessage: 'Authentication error' });
			return;
		}

		// Validate required fields
		if (!hash || (statusCode === 4 && (!filename || !imdbId))) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		// Validate hash format
		if (!isValidTorrentHash(hash)) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}

		// Validate IMDb ID format
		if (statusCode === 4 && !/^tt\d+$/.test(imdbId)) {
			return res.status(400).json({ error: 'Invalid IMDb ID format' });
		}

		// Successful non-Ready observations invalidate a previously cached release.
		if (
			typeof status !== 'string' ||
			!Number.isInteger(statusCode) ||
			statusCode < 0 ||
			(statusCode === 4) !== (status === 'Ready')
		) {
			return res.status(400).json({ error: 'Invalid AllDebrid status' });
		}

		// Validate size
		if (statusCode === 4 && (!size || size <= 0)) {
			return res.status(400).json({ error: 'Size must be greater than 0' });
		}

		// Validate completionDate (must be a valid Unix timestamp)
		if (
			statusCode === 4 &&
			(completionDate === undefined ||
				completionDate === null ||
				typeof completionDate !== 'number' ||
				isNaN(completionDate) ||
				completionDate < 0)
		) {
			return res
				.status(400)
				.json({ error: 'Invalid completionDate. Must be a valid Unix timestamp (number)' });
		}

		// Validate files array
		if (!Array.isArray(files) || (statusCode === 4 && files.length === 0)) {
			return res
				.status(400)
				.json({ error: 'Ready torrents require a non-empty files array' });
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
