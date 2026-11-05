import { repository as db } from '@/services/repository';
import { validateProblemToken } from '@/utils/problemToken';
import { mostlyVideo } from '@/utils/selectable';
import { NextApiRequest, NextApiResponse } from 'next';

const MAX_FILES = 10_000;

/**
 * POST /api/availability/dl
 * Record a Debrid-Link release the page saw whole: every file at 100%. Only paths and
 * sizes are taken; a file's download URL is keyless and outlives the torrent.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const { dmmProblemKey, solution, hash, imdbId, filename, files } = req.body ?? {};

		if (typeof dmmProblemKey !== 'string' || typeof solution !== 'string') {
			return res.status(403).json({ errorMessage: 'Authentication not provided' });
		} else if (!validateProblemToken(dmmProblemKey, solution)) {
			return res.status(403).json({ errorMessage: 'Authentication error' });
		}

		if (typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash)) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}
		if (typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId)) {
			return res.status(400).json({ error: 'Invalid IMDb ID format' });
		}
		if (typeof filename !== 'string' || !filename.trim()) {
			return res.status(400).json({ error: 'Missing filename' });
		}
		if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
			return res.status(400).json({ error: `Files must be 1-${MAX_FILES} entries` });
		}
		for (const file of files) {
			if (
				typeof file?.name !== 'string' ||
				!file.name ||
				typeof file.size !== 'number' ||
				!(file.size > 0)
			) {
				return res
					.status(400)
					.json({ error: 'Each file must have a name and a size above 0' });
			}
			if (file.downloadPercent !== 100) {
				return res.status(400).json({ error: 'Every file must be at 100%' });
			}
		}
		const kept = files.map((f: { name: string; size: number }) => ({
			path: f.name,
			bytes: f.size,
		}));
		if (!mostlyVideo(kept)) {
			return res.status(400).json({ error: 'Only films and shows are recorded' });
		}

		await db.upsertAvailabilityDl({ hash, imdbId, filename, files: kept });
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error saving Debrid-Link availability:', error);
		return res.status(500).json({ error: 'Failed to save Debrid-Link availability' });
	}
}
