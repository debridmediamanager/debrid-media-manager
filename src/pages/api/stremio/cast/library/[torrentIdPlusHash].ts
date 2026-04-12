import { getTorrentInfo } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { torrentIdPlusHash, rdToken, imdbId: userProvidedImdbId } = req.query;

	if (!rdToken || typeof rdToken !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid RD token',
		});
		return;
	}

	if (!torrentIdPlusHash || typeof torrentIdPlusHash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid torrentid',
		});
		return;
	}

	const [torrentId, hash] = torrentIdPlusHash.split(':');

	// get torrent info
	const tInfo = await getTorrentInfo(rdToken, torrentId, true);
	const selectedFiles = tInfo.files.filter((f) => f.selected);
	// check if length of selected files is equal to length of links
	if (selectedFiles.length !== tInfo.links.length) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Cannot determine file link',
		});
		return;
	}

	let imdbid = '';

	// Step 1: Generate user ID from RD token
	let userid: string;
	try {
		userid = await generateUserId(rdToken);
	} catch (error) {
		console.error('Failed to generate user ID:', error);
		res.status(500).json({
			status: 'error',
			errorMessage:
				'Failed to generate user ID from RD token. Please check your RD token is valid.',
			details: error instanceof Error ? error.message : String(error),
		});
		return;
	}

	// Step 2: Get IMDB ID from database or user input
	try {
		imdbid = (await db.getIMDBIdByHash(hash)) || '';
	} catch (error) {
		console.error('Failed to retrieve IMDB ID from database:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: 'Database error: Failed to retrieve IMDB ID from hash',
			details: error instanceof Error ? error.message : String(error),
		});
		return;
	}

	// If IMDB ID not in database, check if user provided it
	if (!imdbid && userProvidedImdbId && typeof userProvidedImdbId === 'string') {
		// Validate IMDB ID format (tt followed by 7+ digits)
		if (!/^tt\d{7,}$/.test(userProvidedImdbId)) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'Invalid IMDB ID format. Expected format: tt1234567',
			});
			return;
		}

		// Save the mapping for future users (use tInfo.hash, not the URL hash parameter)
		try {
			await db.saveIMDBIdMapping(tInfo.hash, userProvidedImdbId);
			imdbid = userProvidedImdbId;
		} catch (error) {
			console.error('Failed to save IMDB ID mapping:', error);
			res.status(500).json({
				status: 'error',
				errorMessage: 'Database error: Failed to save IMDB ID mapping',
				details: error instanceof Error ? error.message : String(error),
			});
			return;
		}
	}

	// If still no IMDB ID, request user input
	if (!imdbid) {
		res.status(200).json({
			status: 'need_imdb_id',
			torrentInfo: {
				title: tInfo.filename || tInfo.original_filename,
				filename: tInfo.original_filename || tInfo.filename,
				hash: tInfo.hash,
				files: selectedFiles.map((f) => ({
					path: f.path,
					bytes: f.bytes,
				})),
			},
		});
		return;
	}

	// Step 3: Process files with IMDB ID
	for (let i = 0; i < selectedFiles.length; i++) {
		const selectedFile = selectedFiles[i];

		// Parse filename to extract season/episode info
		let info;
		try {
			info = ptt.parse(selectedFile.path.split('/').pop() || '');
		} catch (error) {
			console.error(`Failed to parse filename "${selectedFile.path}":`, error);
			res.status(500).json({
				status: 'error',
				errorMessage: `Failed to parse filename: ${selectedFile.path}`,
				details: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		// Save cast information to database
		try {
			const stremioKey = `${imdbid}${info.season && info.episode ? `:${info.season}:${info.episode}` : ''}`;
			await db.saveCast(
				stremioKey,
				userid,
				tInfo.hash,
				selectedFile.path,
				tInfo.links[i],
				Math.ceil(selectedFile.bytes / 1024 / 1024)
			);
		} catch (error) {
			console.error('Failed to save cast information to database:', error);
			res.status(500).json({
				status: 'error',
				errorMessage: 'Database error: Failed to save cast information',
				details: error instanceof Error ? error.message : String(error),
			});
			return;
		}
	}

	// Determine season/episode from first file for redirect
	const firstFileInfo = ptt.parse(selectedFiles[0].path.split('/').pop() || '');
	const season = firstFileInfo.season ? String(firstFileInfo.season) : '';
	const episode = firstFileInfo.episode ? String(firstFileInfo.episode) : '';

	// Prepare redirect URL
	let redirectUrl = `stremio://detail/movie/${imdbid}/${imdbid}`;
	let mediaType = 'movie';

	if (season && episode) {
		redirectUrl = `stremio://detail/series/${imdbid}/${imdbid}:${season}:${episode}`;
		mediaType = 'series';
	}

	// Return JSON response with redirect URL
	res.status(200).json({
		status: 'success',
		redirectUrl,
		imdbId: imdbid,
		mediaType,
		season: season || undefined,
		episode: episode || undefined,
	});
}
