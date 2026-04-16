import { repository as db } from '@/services/repository';
import { requestDownloadLink } from '@/services/torbox';
import {
	getBiggestFileTorBoxStreamUrl,
	getFileByNameTorBoxStreamUrl,
} from '@/utils/getTorBoxStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

// Play a TorBox file from an existing torrent
// Supports two formats:
// 1. torrentId:fileId (e.g., "123456:789") - direct lookup (with ?h=hash&file=filename fallback)
// 2. hash (e.g., "fbadffe5476df0674dbec75e81426895e40b6427") - legacy format
//    - With ?file=filename: matches specific file by name (for TV episodes)
//    - Without ?file: uses biggest file (for movies)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, hash, file, h: fallbackHash } = req.query;
	if (typeof userid !== 'string' || typeof hash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "hash" query parameter',
		});
		return;
	}

	// Get user's TorBox profile with API key
	let profile: { apiKey: string } | null = null;
	try {
		profile = await db.getTorBoxCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get TorBox profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get TorBox profile for user ${userid}` });
		return;
	}

	const apiKey = profile.apiKey;
	const filename = typeof file === 'string' ? file : undefined;

	try {
		let streamUrl: string | undefined;

		// Check if it's torrentId:fileId format or a torrent hash
		if (hash.includes(':')) {
			// Format: torrentId:fileId
			const parts = hash.split(':');
			if (parts.length !== 2) {
				res.status(400).json({
					status: 'error',
					errorMessage: 'Invalid format. Expected torrentId:fileId',
				});
				return;
			}

			const torrentId = parseInt(parts[0], 10);
			const fileId = parseInt(parts[1], 10);

			if (isNaN(torrentId) || isNaN(fileId)) {
				res.status(400).json({
					status: 'error',
					errorMessage: 'Invalid torrentId or fileId',
				});
				return;
			}

			// Try direct lookup first. Skip retries so a 500 from TorBox (e.g.
			// when torrentId belongs to a different user) falls back to the hash
			// path immediately instead of stalling on ~2min of exponential backoff.
			try {
				const downloadResult = await requestDownloadLink(
					apiKey,
					{ torrent_id: torrentId, file_id: fileId },
					{ skipRetry: true, timeout: 8000 }
				);

				if (downloadResult.success && downloadResult.data) {
					streamUrl = downloadResult.data;
				}
			} catch (directError) {
				console.log(
					'[TorBox Play] Direct lookup failed, trying hash fallback:',
					directError instanceof Error ? directError.message : 'Unknown error'
				);
			}

			// If direct lookup failed and we have a fallback hash, use it
			if (!streamUrl && typeof fallbackHash === 'string') {
				if (filename) {
					const [url] = await getFileByNameTorBoxStreamUrl(
						apiKey,
						fallbackHash,
						filename
					);
					streamUrl = url;
				} else {
					const [url] = await getBiggestFileTorBoxStreamUrl(apiKey, fallbackHash);
					streamUrl = url;
				}
			}

			if (!streamUrl) {
				throw new Error('Failed to get download link');
			}
		} else {
			// Legacy format: torrent hash
			if (filename) {
				// Match by filename (for TV episodes from season packs)
				const [url] = await getFileByNameTorBoxStreamUrl(apiKey, hash, filename);
				if (!url) {
					throw new Error(`Failed to find file "${filename}" in torrent`);
				}
				streamUrl = url;
			} else {
				// No filename provided - use biggest file (for movies)
				const [url] = await getBiggestFileTorBoxStreamUrl(apiKey, hash);
				if (!url) {
					throw new Error('Failed to get stream URL for torrent');
				}
				streamUrl = url;
			}
		}

		// Redirect to the download URL
		res.redirect(streamUrl);
	} catch (error: any) {
		console.error(
			'Failed to play TorBox link:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to play link' });
	}
}
