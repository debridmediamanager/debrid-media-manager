import { repository as db } from '@/services/repository';
import { extractToken, generateUserId } from '@/utils/castApiHelpers';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { getBiggestFileStreamUrl } from '@/utils/getStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

// MOVIE cast: unrestricts a selected link and saves it to the database
// called in the movie page
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { imdbid, hash } = req.query;
	const token = extractToken(req);
	if (!token || !hash) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token" or "hash" parameter',
		});
		return;
	}
	if (typeof imdbid !== 'string' || typeof hash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "token" or "hash" parameter',
		});
		return;
	}
	const ipAddress = getClientIpFromRequest(req);

	try {
		const [streamUrl, rdLink, fileSize] = await getBiggestFileStreamUrl(token, hash, ipAddress);

		if (streamUrl) {
			let message = 'You can now stream the movie in Stremio';

			const userid = await generateUserId(token);

			await db.saveCast(imdbid, userid, hash, streamUrl, rdLink, fileSize);

			const filename = streamUrl.split('/').pop() ?? '???';

			res.status(200).json({
				status: 'success',
				message,
				filename,
			});
			return;
		}
	} catch (e) {
		console.error(e);
		const message = e instanceof Error ? e.message : String(e);
		res.status(500).json({
			status: 'error',
			errorMessage: message,
		});
		return;
	}
}
