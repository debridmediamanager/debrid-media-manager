import { PlanetScaleCache } from '@/services/planetscale';
import { getStreamUrl } from '@/utils/getStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

// TV SHOW cast: unrestricts a selected link and saves it to the database
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, imdbid, token, hash, fileIds } = req.query;
	if (!token || !hash || !fileIds) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token", "hash" or "fileIds" query parameter',
		});
		return;
	}
	if (
		typeof userid !== 'string' ||
		typeof imdbid !== 'string' ||
		typeof token !== 'string' ||
		typeof hash !== 'string' ||
		(!Array.isArray(fileIds) && typeof fileIds !== 'string')
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "token", "hash" or "fileIds" query parameter',
		});
		return;
	}
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
	const errorEpisodes: string[] = [];

	const fileIdsArr = Array.isArray(fileIds) ? fileIds : [fileIds];
	for (const fileId of fileIdsArr) {
		try {
			const [streamUrl, seasonNumber, episodeNumber, fileSize] = await getStreamUrl(
				token,
				hash,
				parseInt(fileId, 10),
				ipAddress,
				'tv'
			);

			if (streamUrl) {
				const castKey = `${imdbid}${
					seasonNumber >= 0 && episodeNumber >= 0
						? `:${seasonNumber}:${episodeNumber}`
						: ''
				}`;
				await db.saveCast(castKey, userid, hash, streamUrl, 0, 0, fileSize, null);
			} else {
				if (seasonNumber >= 0 && episodeNumber >= 0) {
					errorEpisodes.push(`S${seasonNumber}E${episodeNumber}`);
				} else {
					errorEpisodes.push(`fileId:${fileId}`);
				}
			}
		} catch (e) {
			errorEpisodes.push(`fileId:${fileId}`);
		}
	}

	res.status(200).json({
		errorEpisodes,
	});
}
