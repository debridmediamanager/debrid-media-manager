import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { getTorrentInfo } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import { validateProblemToken } from '@/utils/problemToken';
import { mostlyVideo } from '@/utils/selectable';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * POST /api/availability
 * Record a torrent cached on Real-Debrid. The page sends the user's RD token and the
 * torrent's id, never the torrent itself: DMM reads it from Real-Debrid, so what is
 * recorded is what RD says, not what a caller claims. The token is used for this one
 * read, as the RD proxy already uses it, and is not kept.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!validateOwnPageRequest(req, res)) return;

	try {
		const { dmmProblemKey, solution, rdKey, torrentId, imdbId } = req.body ?? {};

		if (typeof dmmProblemKey !== 'string' || typeof solution !== 'string') {
			return res.status(403).json({ errorMessage: 'Authentication not provided' });
		} else if (!validateProblemToken(dmmProblemKey, solution)) {
			return res.status(403).json({ errorMessage: 'Authentication error' });
		}

		if (typeof imdbId !== 'string' || !/^tt\d+$/.test(imdbId)) {
			return res.status(400).json({ error: 'Invalid IMDb ID format' });
		}
		if (typeof rdKey !== 'string' || !/^[A-Za-z0-9]{20,}$/.test(rdKey)) {
			return res.status(400).json({ error: 'Missing Real-Debrid token' });
		}
		if (typeof torrentId !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(torrentId)) {
			return res.status(400).json({ error: 'Invalid torrent id' });
		}

		let info;
		try {
			info = await getTorrentInfo(rdKey, torrentId, true);
		} catch {
			return res.status(502).json({ error: 'Real-Debrid did not answer for this torrent' });
		}

		if (info.status !== 'downloaded' || info.progress !== 100) {
			return res.status(400).json({ error: 'Torrent is not downloaded' });
		}
		if (!/^[a-f0-9]{40}$/i.test(info.hash ?? '')) {
			return res.status(400).json({ error: 'Invalid torrent hash format' });
		}
		if (!(info.bytes > 0) || !(info.original_bytes > 0)) {
			return res.status(400).json({ error: 'Bytes must be greater than 0' });
		}
		const selectedFiles = (info.files ?? []).filter((file) => file.selected === 1);
		if (selectedFiles.length === 0) {
			return res.status(400).json({ error: 'Torrent is fully expired' });
		} else if (selectedFiles.length !== (info.links ?? []).length) {
			return res.status(400).json({ error: 'Torrent is partially expired' });
		}
		if (!mostlyVideo(selectedFiles)) {
			return res.status(400).json({ error: 'Only films and shows are recorded' });
		}

		await db.upsertAvailability({
			hash: info.hash.toLowerCase(),
			imdbId,
			filename: info.filename,
			originalFilename: info.original_filename,
			bytes: info.bytes,
			originalBytes: info.original_bytes,
			host: 'real-debrid.com',
			progress: info.progress,
			status: info.status,
			ended: info.ended,
			selectedFiles,
			links: info.links,
		});

		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('Error saving available torrent:', error);
		return res.status(500).json({ error: 'Failed to save available torrent' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.availabilityWrite);
