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
		const {
			dmmProblemKey,
			solution,
			filename,
			original_filename,
			hash,
			bytes,
			original_bytes,
			host,
			progress,
			status,
			files,
			links,
			ended,
			imdbId,
		} = req.body;

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

		// Validate required fields and conditions
		if (!hash || !filename || !imdbId) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		// Validate host
		if (host !== 'real-debrid.com') {
			return res.status(400).json({ error: 'Invalid host. Only real-debrid.com is allowed' });
		}

		// Validate progress
		if (progress !== 100) {
			return res.status(400).json({ error: 'Invalid progress. Must be 100' });
		}

		// Validate hash format
		if (!isValidTorrentHash(hash)) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}

		// Validate bytes
		if (!bytes || bytes <= 0 || !original_bytes || original_bytes <= 0) {
			return res.status(400).json({ error: 'Bytes must be greater than 0' });
		}

		// Validate files and links
		if (!Array.isArray(files) || !Array.isArray(links)) {
			return res.status(400).json({ error: 'Files and links must be arrays' });
		}

		// Get selected files
		const selectedFiles = files.filter((file) => file.selected === 1);

		// Validate link distribution
		if (selectedFiles.length === 0) {
			return res.status(400).json({ error: 'Torrent is fully expired' });
		} else if (selectedFiles.length !== links.length) {
			return res.status(400).json({ error: 'Torrent is partially expired' });
		}

		// Create available record with only selected files
		await db.upsertAvailability({
			hash,
			imdbId,
			filename,
			originalFilename: original_filename,
			bytes,
			originalBytes: original_bytes,
			host,
			progress,
			status,
			ended,
			selectedFiles,
			links,
		});

		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error saving available torrent:', error);
		return res.status(500).json({ error: 'Failed to save available torrent' });
	}
}
