import { repository as db } from '@/services/repository';
import { getTorrinTorrentInfo } from '@/services/torrin';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { generateTorrinUserId } from '@/utils/torrinCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { torrentIdPlusHash, baseUrl, apiKey, imdbId: userProvidedImdbId } = req.query;

	if (!apiKey || typeof apiKey !== 'string' || !baseUrl || typeof baseUrl !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid Torrin baseUrl/apiKey',
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

	const tInfo = await getTorrinTorrentInfo(baseUrl, apiKey, torrentId);
	const selectedFiles = tInfo.files.filter((f) => f.selected);
	if (selectedFiles.length !== tInfo.links.length) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Cannot determine file link',
		});
		return;
	}

	let userid: string;
	try {
		userid = await generateTorrinUserId(baseUrl, apiKey);
	} catch (error) {
		res.status(500).json({
			status: 'error',
			errorMessage: 'Failed to generate user ID from Torrin credentials.',
			details: error instanceof Error ? error.message : String(error),
		});
		return;
	}

	let imdbid = '';
	try {
		imdbid = (await db.getIMDBIdByHash(hash)) || '';
	} catch (error) {
		res.status(500).json({
			status: 'error',
			errorMessage: 'Database error: Failed to retrieve IMDB ID from hash',
			details: error instanceof Error ? error.message : String(error),
		});
		return;
	}

	if (!imdbid && userProvidedImdbId && typeof userProvidedImdbId === 'string') {
		if (!/^tt\d{7,}$/.test(userProvidedImdbId)) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'Invalid IMDB ID format. Expected format: tt1234567',
			});
			return;
		}
		try {
			await db.saveIMDBIdMapping(tInfo.hash, userProvidedImdbId);
			imdbid = userProvidedImdbId;
		} catch (error) {
			res.status(500).json({
				status: 'error',
				errorMessage: 'Database error: Failed to save IMDB ID mapping',
				details: error instanceof Error ? error.message : String(error),
			});
			return;
		}
	}

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

	for (let i = 0; i < selectedFiles.length; i++) {
		const selectedFile = selectedFiles[i];
		let info;
		try {
			info = ptt.parse(selectedFile.path.split('/').pop() || '');
		} catch (error) {
			res.status(500).json({
				status: 'error',
				errorMessage: `Failed to parse filename: ${selectedFile.path}`,
				details: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		try {
			const stremioKey = `${imdbid}${info.season && info.episode ? `:${info.season}:${info.episode}` : ''}`;
			await db.saveTorrinCast(
				stremioKey,
				userid,
				tInfo.hash,
				selectedFile.path,
				tInfo.links[i],
				Math.ceil(selectedFile.bytes / 1024 / 1024)
			);
		} catch (error) {
			res.status(500).json({
				status: 'error',
				errorMessage: 'Database error: Failed to save cast information',
				details: error instanceof Error ? error.message : String(error),
			});
			return;
		}
	}

	const firstFileInfo = ptt.parse(selectedFiles[0].path.split('/').pop() || '');
	const season = firstFileInfo.season ? String(firstFileInfo.season) : '';
	const episode = firstFileInfo.episode ? String(firstFileInfo.episode) : '';

	let redirectUrl = getStremioDetailUrl(imdbid);
	let mediaType = 'movie';
	if (season && episode) {
		redirectUrl = getStremioDetailUrl(imdbid, { season, episode });
		mediaType = 'series';
	}

	res.status(200).json({
		status: 'success',
		redirectUrl,
		imdbId: imdbid,
		mediaType,
		season: season || undefined,
		episode: episode || undefined,
	});
}
