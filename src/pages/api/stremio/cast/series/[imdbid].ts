import { repository as db } from '@/services/repository';
import { extractToken, generateUserId } from '@/utils/castApiHelpers';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getStreamUrl } from '@/utils/getStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

// TV SHOW cast: unrestricts a selected link and saves it to the database
// called in the show page
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { imdbid, hash, fileIds } = req.query;
	const token = extractToken(req);
	if (!token || !hash || !fileIds) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token", "hash" or "fileIds" parameter',
		});
		return;
	}
	if (
		typeof imdbid !== 'string' ||
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
				'tv'
			);

			// Without a season and episode there is no key to file this under: the
			// bare imdb id is the *movie* key, and the cast table is unique on
			// (imdbId, userId, hash), so every unparsed episode of a pack landed
			// on the same row and overwrote the one before it.
			if (streamUrl && seasonNumber >= 0 && episodeNumber >= 0) {
				const castKey = `${imdbid}:${seasonNumber}:${episodeNumber}`;
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
