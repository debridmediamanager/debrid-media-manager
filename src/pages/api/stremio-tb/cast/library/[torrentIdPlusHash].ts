import { repository as db } from '@/services/repository';
import {
	getTorrentList,
	getWebDownloadList,
	requestDownloadLink,
	requestWebDownloadLink,
} from '@/services/torbox';
import { TorBoxTorrentInfo, TorBoxWebDownload } from '@/services/types';
import { planLibraryCast } from '@/utils/castLibraryPlan';
import { delay } from '@/utils/delay';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { isVideo } from '@/utils/selectable';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { generateTorBoxUserId } from '@/utils/torboxCastApiHelpers';
import { parseTorBoxCastTarget } from '@/utils/torboxWebDownload';
import { NextApiRequest, NextApiResponse } from 'next';

// `requestdl` starts refusing at roughly 100 calls, well below the rest of the
// TorBox API's ceiling.
const REQUESTDL_SPACING_MS = 250;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { torrentIdPlusHash, imdbId: userProvidedImdbId } = req.query;
	const apiKey = readProviderKey(req, ['apiKey']);

	if (!apiKey) {
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

	// `w`-prefixed ids name a web download, which lives in a separate TorBox list
	const [torrentIdStr, hash] = torrentIdPlusHash.split(':');
	const target = parseTorBoxCastTarget(torrentIdStr);
	if (!target) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid torrent ID',
		});
		return;
	}
	const { id: torrentId, isWebDownload } = target;

	try {
		const result = isWebDownload
			? await getWebDownloadList(apiKey, { id: torrentId })
			: await getTorrentList(apiKey, { id: torrentId });
		if (!result.success || !result.data) {
			res.status(400).json({
				status: 'error',
				errorMessage: 'Failed to get torrent info from TorBox',
			});
			return;
		}

		const torrent: TorBoxTorrentInfo | TorBoxWebDownload = Array.isArray(result.data)
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

		const failedFiles: string[] = [];
		const plan = planLibraryCast(imdbid, videoFiles, (file) => ({
			filename: file.name || file.short_name || '',
			size: file.size || 0,
		}));

		for (let i = 0; i < plan.length; i++) {
			const { file, stremioKey } = plan[i];
			// `requestdl` has a much lower rate ceiling than the rest of the
			// TorBox API - around 100 calls before it starts answering 429 - and a
			// full season pack walks straight into it. Space the calls out.
			if (i > 0) {
				await delay(REQUESTDL_SPACING_MS);
			}

			const downloadResult = isWebDownload
				? await requestWebDownloadLink(apiKey, {
						web_id: torrentId,
						file_id: file.id,
					})
				: await requestDownloadLink(apiKey, {
						torrent_id: torrentId,
						file_id: file.id,
					});

			if (!downloadResult.success || !downloadResult.data) {
				console.error(`Failed to get download link for file ${file.id}`);
				failedFiles.push(file.name || file.short_name || String(file.id));
				continue;
			}

			const streamUrl = downloadResult.data;
			const filename = (file.name || file.short_name || '').split('/').pop() || 'Unknown';
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

		const season = plan[0]?.season != null ? String(plan[0].season) : '';
		const episode = plan[0]?.episode != null ? String(plan[0].episode) : '';

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
			// Dropping files silently reads as "everything was cast"
			failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
		});
	} catch (error) {
		console.error('TorBox library cast error:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Internal server error',
		});
	}
}
