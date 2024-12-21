import { getTorrentInfo } from '@/services/realDebrid';
import { Repository } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { padWithZero } from '@/utils/checks';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import ptt from 'parse-torrent-title';

interface Stream {
	url: string;
}

interface Video {
	id: string;
	title: string;
	streams: Stream[];
}

interface TorrentioResponse {
	meta: {
		videos: Video[];
		infoHash: string;
	};
}

const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { torrentIdPlusHash, rdToken } = req.query;

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

	let imdbid = '',
		season = '',
		episode = '';

	try {
		const userid = await generateUserId(rdToken);

		imdbid = (await db.getIMDBIdByHash(hash)) || '';
		if (imdbid) {
			for (let i = 0; i < selectedFiles.length; i++) {
				const selectedFile = selectedFiles[i];
				const info = ptt.parse(selectedFile.path.split('/').pop() || '');
				const stremioKey = `${imdbid}${info.season && info.episode ? `:${info.season}:${info.episode}` : ''}`;
				await db.saveCast(
					stremioKey,
					userid,
					tInfo.hash,
					selectedFile.path,
					tInfo.links[i],
					Math.ceil(selectedFile.bytes / 1024 / 1024)
				);
			}
		} else {
			const response = await fetch(
				`https://torrentio.strem.fun/realdebrid=${rdToken}/meta/other/realdebrid%3A${torrentIdPlusHash}.json`
			);
			const data: TorrentioResponse = await response.json();

			if (!data.meta || !data.meta.videos || !data.meta.videos.length) {
				res.status(404).json({
					status: 'error',
					errorMessage: 'No valid streams found',
				});
				return;
			}

			const castableStreams: Video[] = data.meta.videos.filter((video: Video) =>
				video.id.startsWith('tt')
			);
			if (castableStreams.length === 0) {
				res.status(400).json({
					status: 'error',
					errorMessage: 'Cannot determine IMDB ID of the video',
				});
				return;
			}
			// Process first stream (we'll redirect to the first episode)
			const firstVideo = castableStreams[0];
			const [firstVideoImdb, firstVideoSeason, firstVideoEpisode] = firstVideo.id.split(':');

			imdbid = firstVideoImdb;
			season = firstVideoSeason;
			episode = firstVideoEpisode;

			// Save all streams to database
			for (const video of castableStreams) {
				const [vImdbid, vSeason, vEpisode] = video.id.split(':');
				const vStreamUrl = video.streams[0].url;
				const stremioKey = `${vImdbid}${vSeason && vEpisode ? `:${vSeason}:${vEpisode}` : ''}`;
				const headResp = await axios.head(vStreamUrl, { maxRedirects: 1 });
				const vRedirectUrl = headResp.request.res.responseUrl || vStreamUrl;
				const selectedFile = selectedFiles.find((f) => f.path === video.title);
				const fileIndex = selectedFile ? selectedFiles.indexOf(selectedFile) : -1;
				const rdLink = fileIndex !== -1 ? tInfo.links[fileIndex] : '';
				const fileSize =
					(headResp.headers['content-length']
						? parseInt(headResp.headers['content-length'])
						: 0) /
					1024 /
					1024;
				await db.saveCast(
					stremioKey,
					userid,
					tInfo.hash,
					vRedirectUrl,
					rdLink,
					Math.ceil(fileSize / 1024 / 1024)
				);
			}
		}

		// Prepare redirect URL and message
		let redirectUrl = `stremio://detail/movie/${imdbid}/${imdbid}`;
		let message = `You can now stream the movie ${imdbid} in Stremio`;

		if (season && episode) {
			redirectUrl = `stremio://detail/series/${imdbid}/${imdbid}:${season}:${episode}`;
			message = `You can now stream ${imdbid} S${padWithZero(parseInt(season, 10))}E${padWithZero(parseInt(episode, 10))} in Stremio`;
		}

		// Send HTML response with redirect
		res.setHeader('Content-Type', 'text/html');
		res.status(200).send(`
            <!doctype html>
            <html>
                <head>
                    <meta http-equiv="refresh" content="1;url=${redirectUrl}" />
                </head>
                <body>
                    ${message}
                </body>
            </html>
        `);
	} catch (error) {
		console.error(error);
		res.status(500).json({
			status: 'error',
			errorMessage: 'Failed to process torrent metadata',
		});
	}
}
