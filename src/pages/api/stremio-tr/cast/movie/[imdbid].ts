import { repository as db } from '@/services/repository';
import { getBiggestFileTorrinStreamUrl } from '@/utils/getTorrinStreamUrl';
import { generateTorrinUserId } from '@/utils/torrinCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { imdbid, hash, baseUrl, apiKey } = req.query;

	if (
		!apiKey ||
		typeof apiKey !== 'string' ||
		!baseUrl ||
		typeof baseUrl !== 'string' ||
		!hash ||
		typeof hash !== 'string' ||
		typeof imdbid !== 'string'
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "baseUrl", "apiKey", "hash" or "imdbid" parameter',
		});
		return;
	}

	try {
		const [streamUrl, trLink, fileSize] = await getBiggestFileTorrinStreamUrl(
			baseUrl,
			apiKey,
			hash
		);

		if (streamUrl) {
			const userid = await generateTorrinUserId(baseUrl, apiKey);
			await db.saveTorrinCast(imdbid, userid, hash, streamUrl, trLink, fileSize, baseUrl);

			const filename = streamUrl.split('/').pop() ?? '???';
			res.status(200).json({
				status: 'success',
				message: 'You can now stream the movie in Stremio',
				filename,
			});
			return;
		}

		res.status(500).json({
			status: 'error',
			errorMessage: 'Failed to get a streamable file',
		});
		return;
	} catch (e) {
		console.error(e);
		res.status(500).json({
			status: 'error',
			errorMessage: 'Failed to cast the movie',
		});
	}
}
