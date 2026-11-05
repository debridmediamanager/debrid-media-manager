import { probeDlRelease } from '@/services/debridLink';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import { validateProblemToken } from '@/utils/problemToken';
import { mostlyVideo } from '@/utils/selectable';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * POST /api/availability/dl
 * Record a release Debrid-Link holds whole. The page names the hash and its title, nothing
 * else: DMM asks Debrid-Link itself (`probeDlRelease`) and records what it lists, path and
 * size only. A download URL is the file itself, keyless and long-lived, so none is kept.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!validateOwnPageRequest(req, res)) return;

	try {
		const { dmmProblemKey, solution, hash, imdbId } = req.body ?? {};

		if (typeof dmmProblemKey !== 'string' || typeof solution !== 'string') {
			return res.status(403).json({ errorMessage: 'Authentication not provided' });
		} else if (!validateProblemToken(dmmProblemKey, solution)) {
			return res.status(403).json({ errorMessage: 'Authentication error' });
		}

		if (typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash)) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}
		if (typeof imdbId !== 'string' || !/^tt\d{1,14}$/.test(imdbId)) {
			return res.status(400).json({ error: 'Invalid IMDb ID format' });
		}

		const answer = await probeDlRelease(hash);
		if (answer === null) {
			return res.status(503).json({ error: 'Debrid-Link did not answer for this release' });
		}
		if (!answer.cached) {
			return res.status(409).json({ error: 'Debrid-Link does not hold this release whole' });
		}
		const { torrent } = answer;
		const files = (torrent.files ?? []).map((f) => ({ path: f.name, bytes: f.size }));
		if (
			files.length === 0 ||
			(torrent.files ?? []).some((f) => f.downloadPercent !== 100 || !(f.size > 0))
		) {
			return res.status(409).json({ error: 'Debrid-Link does not hold this release whole' });
		}
		if (!mostlyVideo(files)) {
			return res.status(400).json({ error: 'Only films and shows are recorded' });
		}

		await db.upsertAvailabilityDl({
			hash: hash.toLowerCase(),
			imdbId,
			filename: torrent.name || hash.toLowerCase(),
			files,
		});
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error saving Debrid-Link availability:', error);
		return res.status(500).json({ error: 'Failed to save Debrid-Link availability' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.availabilityWrite);
