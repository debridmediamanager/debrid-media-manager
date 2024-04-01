import { PlanetScaleCache } from '@/services/planetscale';
import { getStreamUrl } from '@/utils/getStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, imdbid, token, hash, fileId } = req.query;
	if (!userid || !imdbid || !token || !hash || !fileId) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "userid", "imdbid", "token", "hash" or "fileId" query parameter',
		});
		return;
	}
	if (
		typeof userid !== 'string' ||
		typeof imdbid !== 'string' ||
		typeof token !== 'string' ||
		typeof hash !== 'string' ||
		typeof fileId !== 'string'
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid", "imdbid", "token", "hash" or "fileId" query parameter',
		});
		return;
	}
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
	const [streamUrl, seasonNumber, episodeNumber] = await getStreamUrl(
		token,
		hash,
		parseInt(fileId, 10),
		ipAddress
	);

	if (streamUrl) {
		let redirectUrl = `stremio://detail/movie/${imdbid}/${imdbid}`;
		let message = 'You can now cast the movie in Stremio';
		if (seasonNumber > 0 && episodeNumber > 0) {
			redirectUrl = `stremio://detail/series/${imdbid}/${imdbid}:${seasonNumber}:${episodeNumber}`;
			message = `You can now cast S${seasonNumber}E${episodeNumber} in Stremio`;
		}

		const castKey = `${imdbid}${
			seasonNumber > 0 && episodeNumber > 0 ? `:${seasonNumber}:${episodeNumber}` : ''
		}`;
		await db.saveCast(castKey, userid, hash, streamUrl);

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
		errorMessage: 'Internal Server Error',
	});
}
