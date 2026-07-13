import { repository as db } from '@/services/repository';
import { getTorrinStreamUrl } from '@/utils/getTorrinStreamUrl';
import { generateTorrinUserId, validateTorrinApiKey } from '@/utils/torrinCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { imdbid, hash, fileIds, baseUrl, apiKey } = req.query;

	if (
		!apiKey ||
		typeof apiKey !== 'string' ||
		!baseUrl ||
		typeof baseUrl !== 'string' ||
		!hash ||
		typeof hash !== 'string' ||
		typeof imdbid !== 'string' ||
		!fileIds ||
		(!Array.isArray(fileIds) && typeof fileIds !== 'string')
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "baseUrl", "apiKey", "hash", "imdbid" or "fileIds"',
		});
		return;
	}

	const validation = await validateTorrinApiKey(baseUrl, apiKey);
	if (!validation.valid) {
		res.status(401).json({
			status: 'error',
			errorMessage: 'Invalid Torrin credentials',
		});
		return;
	}

	const errorEpisodes: string[] = [];
	const fileIdsArr = Array.isArray(fileIds) ? fileIds : [fileIds];
	const userid = await generateTorrinUserId(baseUrl, apiKey);

	for (const fileId of fileIdsArr) {
		try {
			const [streamUrl, trLink, seasonNumber, episodeNumber, fileSize] =
				await getTorrinStreamUrl(baseUrl, apiKey, hash, parseInt(fileId, 10), 'tv');

			if (streamUrl) {
				const castKey = `${imdbid}${
					seasonNumber >= 0 && episodeNumber >= 0
						? `:${seasonNumber}:${episodeNumber}`
						: ''
				}`;
				await db.saveTorrinCast(castKey, userid, hash, streamUrl, trLink, fileSize);
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
