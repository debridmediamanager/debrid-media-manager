import { repository as db } from '@/services/repository';
import { extractToken, generateUserId } from '@/utils/castApiHelpers';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getStreamUrl } from '@/utils/getStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { anidbid, hash, fileIds } = req.query;
	const token = extractToken(req);
	if (!token || !hash || !fileIds) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token", "hash" or "fileIds" parameter',
		});
		return;
	}
	if (
		typeof anidbid !== 'string' ||
		typeof hash !== 'string' ||
		(!Array.isArray(fileIds) && typeof fileIds !== 'string')
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "token", "hash" or "fileIds" parameter',
		});
		return;
	}
	const ipAddress = getClientIpFromRequest(req);
	const errorEpisodes: string[] = [];

	const fileIdsArr = Array.isArray(fileIds) ? fileIds : [fileIds];

	const userid = await generateUserId(token);

	for (const fileId of fileIdsArr) {
		try {
			const [streamUrl, rdLink, seasonNumber, episodeNumber, fileSize] = await getStreamUrl(
				token,
				hash,
				parseInt(fileId, 10),
				ipAddress,
				'anime'
			);

			// See the same guard in cast/series: the bare id is the movie key, so
			// an unparsed episode overwrites whatever was cast before it.
			if (streamUrl && seasonNumber >= 0 && episodeNumber >= 0) {
				const castKey = `${anidbid}:${seasonNumber}:${episodeNumber}`;
				await db.saveCast(castKey, userid, hash, streamUrl, rdLink, fileSize);
			} else if (streamUrl) {
				errorEpisodes.push(`fileId:${fileId} (no episode number in filename)`);
			} else if (seasonNumber >= 0 && episodeNumber >= 0) {
				errorEpisodes.push(`S${seasonNumber}E${episodeNumber}`);
			} else {
				errorEpisodes.push(`fileId:${fileId}`);
			}
		} catch (e) {
			console.error(e);
			errorEpisodes.push(`fileId:${fileId}`);
		}
	}

	res.status(200).json({
		errorEpisodes,
	});
}
