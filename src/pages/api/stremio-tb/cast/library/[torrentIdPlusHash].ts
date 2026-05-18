import { repository as db } from '@/services/repository';
import { getTorrentList, requestDownloadLink } from '@/services/torbox';
import { TorBoxTorrentInfo } from '@/services/types';
import { isVideo } from '@/utils/selectable';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { generateTorBoxUserId } from '@/utils/torboxCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { torrentIdPlusHash, apiKey, imdbId: userProvidedImdbId } = req.query;

	if (!apiKey || typeof apiKey !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid TorBox API key',
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

	const [torrentIdStr, hash] = torrentIdPlusHash.split(':');
	const torrentId = parseInt(torrentIdStr, 10);
	if (isNaN(torrentId)) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid torrent ID',
		});
		return;
	}

	try {
		const result = await getTorrentList(apiKey, { id: torrentId });
		if (!result.success || !result.data) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'Failed to get torrent info from TorBox',
			});
			return;
		}

		const torrent: TorBoxTorrentInfo = Array.isArray(result.data)
			? result.data[0]
			: result.data;

		if (!torrent || !torrent.files || torrent.files.length === 0) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'Torrent has no files',
			});
			return;
		}

		const videoFiles = torrent.files.filter((f) =>
			isVideo({ path: f.name || f.short_name || '' })
		);
		if (videoFiles.length === 0) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'No video files found in torrent',
			});
			return;
		}

		let userid: string;
		try {
			userid = await generateTorBoxUserId(apiKey);
		} catch (error) {
			console.error('Failed to generate TorBox user ID:', error);
			res.status(500).json({
				status: 'error',
				errorMessage: 'Failed to generate user ID from TorBox API key',
			});
			return;
		}

		let imdbid = '';
		try {
			imdbid = (await db.getIMDBIdByHash(hash)) || '';
		} catch (error) {
			console.error('Failed to retrieve IMDB ID from database:', error);
			res.status(500).json({
				status: 'error',
				errorMessage: 'Database error: Failed to retrieve IMDB ID from hash',
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
				await db.saveIMDBIdMapping(torrent.hash || hash, userProvidedImdbId);
				imdbid = userProvidedImdbId;
			} catch (error) {
				console.error('Failed to save IMDB ID mapping:', error);
				res.status(500).json({
					status: 'error',
					errorMessage: 'Database error: Failed to save IMDB ID mapping',
				});
				return;
			}
		}

		if (!imdbid) {
			res.status(200).json({
				status: 'need_imdb_id',
				torrentInfo: {
					title: torrent.name,
					filename: torrent.name,
					hash: torrent.hash || hash,
					files: videoFiles.map((f) => ({
						path: f.name || f.short_name || '',
						bytes: f.size,
					})),
				},
			});
			return;
		}

		for (const file of videoFiles) {
			const downloadResult = await requestDownloadLink(apiKey, {
				torrent_id: torrentId,
				file_id: file.id,
			});

			if (!downloadResult.success || !downloadResult.data) {
				console.error(`Failed to get download link for file ${file.id}`);
				continue;
			}

			const streamUrl = downloadResult.data;
			const filename = (file.name || file.short_name || '').split('/').pop() || 'Unknown';
			const info = ptt.parse(filename);
			const stremioKey = `${imdbid}${info.season && info.episode ? `:${info.season}:${info.episode}` : ''}`;
			const fileSize = Math.round((file.size || 0) / 1024 / 1024);

			await db.saveTorBoxCast(
				stremioKey,
				userid,
				torrent.hash || hash,
				filename,
				streamUrl,
				fileSize,
				torrentId,
				file.id
			);
		}

		const firstFileInfo = ptt.parse(
			(videoFiles[0].name || videoFiles[0].short_name || '').split('/').pop() || ''
		);
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
	} catch (error) {
		console.error('TorBox library cast error:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Internal server error',
		});
	}
}
