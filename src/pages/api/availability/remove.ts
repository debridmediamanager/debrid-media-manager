import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getTorrentInfo } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { isRdBlockedName } from '@/utils/deInfringe';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import { validateProblemToken } from '@/utils/problemToken';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * RD states that mean the add started a real download: files chosen and RD fetching them,
 * so the release was not in its cache. `waiting_files_selection` is not one of them: a
 * selection that failed on a 429 or a dropped connection leaves a cached release there.
 */
const DOWNLOAD_STATES = new Set(['queued', 'downloading', 'compressing', 'uploading', 'dead']);

/**
 * POST /api/availability/remove
 * Forget a Real-Debrid row only on proof DMM can check itself, never on a caller's word:
 * - `rdKey` + `torrentId`: DMM reads the user's add from RD, and removes the row when RD
 *   is downloading it rather than holding it;
 * - the hash alone: removes the row when its own recorded name is one RD refuses to add.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!validateOwnPageRequest(req, res)) return;

	try {
		const { dmmProblemKey, solution, hash, reason, rdKey, torrentId } = req.body ?? {};

		if (typeof dmmProblemKey !== 'string' || typeof solution !== 'string') {
			return res.status(403).json({ errorMessage: 'Authentication not provided' });
		} else if (!validateProblemToken(dmmProblemKey, solution)) {
			return res.status(403).json({ errorMessage: 'Authentication error' });
		}
		if (typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash)) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}

		if (rdKey !== undefined || torrentId !== undefined) {
			if (
				typeof rdKey !== 'string' ||
				typeof torrentId !== 'string' ||
				!/^[A-Za-z0-9]{1,32}$/.test(torrentId)
			) {
				return res.status(400).json({ error: 'Invalid Real-Debrid proof' });
			}
			let info;
			try {
				info = await getTorrentInfo(rdKey, torrentId, true);
			} catch {
				return res
					.status(502)
					.json({ error: 'Real-Debrid did not answer for this torrent' });
			}
			const selected = (info.files ?? []).some((file) => file.selected === 1);
			if (info.hash?.toLowerCase() !== hash.toLowerCase()) {
				return res.status(400).json({ error: 'The torrent is not this release' });
			}
			if (!selected || !DOWNLOAD_STATES.has(info.status)) {
				return res.status(409).json({ error: 'Real-Debrid has not shown it uncached' });
			}
		} else {
			const names = (await db.getCachedRdNames([hash])).get(hash.toLowerCase());
			if (!names || !isRdBlockedName(names.originalFilename, [names.filename])) {
				return res.status(409).json({ error: 'Nothing shows this release uncached' });
			}
		}

		await db.removeAvailability(hash);
		console.log(`Removed false positive availability: ${hash}, reason: ${reason}`);
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error removing availability:', error);
		return res.status(500).json({ error: 'Failed to remove availability' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.availabilityWrite);
