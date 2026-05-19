import { getMagnetFiles, getMagnetStatusAd, isAdStatusReady } from '@/services/allDebrid';
import { repository as db } from '@/services/repository';
import { generateAllDebridUserId } from '@/utils/allDebridCastApiHelpers';
import { selectSortedVideos } from '@/utils/allDebridCastClientPipeline';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { magnetIdPlusHash, apiKey, imdbId: userProvidedImdbId } = req.query;

	if (!apiKey || typeof apiKey !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid AllDebrid API key',
		});
		return;
	}

	if (!magnetIdPlusHash || typeof magnetIdPlusHash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid magnetId',
		});
		return;
	}

	const [magnetIdStr, hash] = magnetIdPlusHash.split(':');
	const magnetId = parseInt(magnetIdStr, 10);
	if (isNaN(magnetId)) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid magnet ID',
		});
		return;
	}

	try {
		const status = await getMagnetStatusAd(apiKey, magnetId);
		if (!status || !isAdStatusReady(status)) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'Magnet is not ready',
			});
			return;
		}

		const filesResult = await getMagnetFiles(apiKey, [magnetId]);
		const magnetFiles = filesResult.magnets?.[0];
		if (!magnetFiles || magnetFiles.error || !magnetFiles.files) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'Failed to get magnet files from AllDebrid',
			});
			return;
		}

		const videoFiles = selectSortedVideos(magnetFiles.files);
		if (videoFiles.length === 0) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'No video files found in magnet',
			});
			return;
		}

		let userid: string;
		try {
			userid = await generateAllDebridUserId(apiKey);
		} catch (error) {
			console.error('Failed to generate AllDebrid user ID:', error);
			res.status(500).json({
				status: 'error',
				errorMessage: 'Failed to generate user ID from AllDebrid API key',
			});
			return;
		}

		const magnetHash = status.hash || hash;

		let imdbid = '';
		try {
			imdbid = (await db.getIMDBIdByHashAd(magnetHash)) || '';
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
				await db.saveIMDBIdMapping(magnetHash, userProvidedImdbId);
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
					title: status.filename,
					filename: status.filename,
					hash: magnetHash,
					files: videoFiles.map((f) => ({
						path: f.path,
						bytes: f.size,
					})),
				},
			});
			return;
		}

		for (let i = 0; i < videoFiles.length; i++) {
			const file = videoFiles[i];
			const filename = file.path.split('/').pop() || 'Unknown';
			const info = ptt.parse(filename);
			const stremioKey = `${imdbid}${info.season && info.episode ? `:${info.season}:${info.episode}` : ''}`;
			const fileSize = Math.round(file.size / 1024 / 1024);

			await db.saveAllDebridCast(
				stremioKey,
				userid,
				magnetHash,
				filename,
				file.link,
				fileSize,
				magnetId,
				i
			);
		}

		const firstFileInfo = ptt.parse(videoFiles[0].path.split('/').pop() || '');
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
		console.error('AllDebrid library cast error:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Internal server error',
		});
	}
}
