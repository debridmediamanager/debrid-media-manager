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
	const streamUrl = await getStreamUrl(token, hash, fileId, ipAddress);
	if (streamUrl) {
		await db.saveCast(imdbid, userid, hash, streamUrl);
		res.status(200).json({
			status: 'success',
			message: 'You can now cast the movie in Stremio',
		});
		return;
	}
	res.status(500).json({
		status: 'error',
		errorMessage: 'Internal Server Error',
	});
}
