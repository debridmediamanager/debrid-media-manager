import { Repository } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { getStreamUrl } from '@/utils/getStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

// cast: unrestricts a selected link and saves it to the database
// called in the showInfo component
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { imdbid, token, hash, fileId, mediaType } = req.query;
	if (!token || !hash || !fileId || !mediaType) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token", "hash", "fileId" or "mediaType" query parameter',
		});
		return;
	}
	if (
		typeof imdbid !== 'string' ||
		typeof token !== 'string' ||
		typeof hash !== 'string' ||
		typeof fileId !== 'string' ||
		typeof mediaType !== 'string'
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "token", "hash", "fileId" or "mediaType" query parameter',
		});
		return;
	}
	try {
		const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
		const [streamUrl, rdLink, seasonNumber, episodeNumber, fileSize] = await getStreamUrl(
			token,
			hash,
			parseInt(fileId, 10),
			ipAddress,
			mediaType
		);

		if (streamUrl) {
			let redirectUrl = `stremio://detail/movie/${imdbid}/${imdbid}`;
			let message = 'You can now stream the movie in Stremio';
			if (seasonNumber >= 0 && episodeNumber >= 0) {
				redirectUrl = `stremio://detail/series/${imdbid}/${imdbid}:${seasonNumber}:${episodeNumber}`;
				message = `You can now stream S${seasonNumber}E${episodeNumber} in Stremio`;
			}

			const castKey = `${imdbid}${
				seasonNumber >= 0 && episodeNumber >= 0 ? `:${seasonNumber}:${episodeNumber}` : ''
			}`;

			const userid = await generateUserId(token);

			await db.saveCast(castKey, userid, hash, streamUrl, rdLink, fileSize);

			// send an html
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
			return;
		}

		res.status(500).json({
			status: 'error',
			errorMessage: 'Failed to cast, no streamUrl',
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({
			status: 'error',
			errorMessage: `Failed to cast: ${error}`,
		});
	}
}
