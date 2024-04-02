import { PlanetScaleCache } from '@/services/planetscale';
import { getBiggestFileStreamUrl } from '@/utils/getStreamUrl';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

// MOVIE cast: unrestricts a selected link and saves it to the database
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, imdbid, token, hash } = req.query;
	if (!token || !hash) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "token" or "hash" query parameter',
		});
		return;
	}
	if (
		typeof userid !== 'string' ||
		typeof imdbid !== 'string' ||
		typeof token !== 'string' ||
		typeof hash !== 'string'
	) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "token" or "hash" query parameter',
		});
		return;
	}
	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress;
	const [streamUrl, fileSize] = await getBiggestFileStreamUrl(token, hash, ipAddress);

	if (streamUrl) {
		let message = 'You can now stream the movie in Stremio';

		await db.saveCast(imdbid, userid, hash, streamUrl, 0, 0, fileSize, null);

		const filename = streamUrl.split('/').pop() ?? '???';

		res.status(200).json({
			status: 'success',
			message,
			filename,
		});
		return;
	}

	res.status(500).json({
		status: 'error',
		errorMessage: 'Internal Server Error',
	});
}
