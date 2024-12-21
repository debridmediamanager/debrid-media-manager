import { Repository } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { getStreamUrl } from '@/utils/getStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { anidbid, token, hash, fileIds } = req.query;
	if (!token || !hash || !fileIds) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token", "hash" or "fileIds" query parameter',
		});
		return;
	}
	if (
		typeof anidbid !== 'string' ||
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

			if (streamUrl) {
				const castKey = `${anidbid}${
					seasonNumber >= 0 && episodeNumber >= 0
						? `:${seasonNumber}:${episodeNumber}`
						: ''
				}`;
				await db.saveCast(castKey, userid, hash, streamUrl, rdLink, fileSize);
			} else {
				if (seasonNumber >= 0 && episodeNumber >= 0) {
					errorEpisodes.push(`S${seasonNumber}E${episodeNumber}`);
				} else {
					errorEpisodes.push(`fileId:${fileId}`);
				}
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
