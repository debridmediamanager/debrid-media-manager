import { Repository } from '@/services/repository';
import { generateUserId } from '@/utils/castApiHelpers';
import { getBiggestFileStreamUrl } from '@/utils/getStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

// MOVIE cast: unrestricts a selected link and saves it to the database
// called in the movie page
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { imdbid, token, hash } = req.query;
	if (!token || !hash) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token" or "hash" query parameter',
		});
		return;
	}
	if (typeof imdbid !== 'string' || typeof token !== 'string' || typeof hash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "token" or "hash" query parameter',
		});
		return;
	}
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;

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
		res.status(500).json({
			status: 'error',
			errorMessage: `Failed to get stream URL for ${imdbid}, ${e}`,
		});
		return;
	}
}
