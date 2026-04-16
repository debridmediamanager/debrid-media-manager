import { repository as db } from '@/services/repository';
import { generateAllDebridUserId } from '@/utils/allDebridCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

// MOVIE cast (save): the client (browser) performs the AllDebrid magnet upload +
// file discovery — AllDebrid blocks `magnet/upload` from datacenter IPs, so the
// server can't do it. This endpoint just persists the resulting metadata.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		res.status(405).json({ status: 'error', errorMessage: 'Method not allowed' });
		return;
	}

	const { imdbid } = req.query;
	const { apiKey, hash, magnetId, fileIndex, streamUrl, filename, fileSize } = req.body ?? {};

	if (
		typeof imdbid !== 'string' ||
		typeof apiKey !== 'string' ||
		typeof hash !== 'string' ||
		typeof magnetId !== 'number' ||
		typeof fileIndex !== 'number' ||
		typeof streamUrl !== 'string' ||
		typeof filename !== 'string' ||
		typeof fileSize !== 'number'
	) {
		res.status(400).json({ status: 'error', errorMessage: 'Missing or invalid fields' });
		return;
	}

	try {
		const userid = await generateAllDebridUserId(apiKey);
		await db.saveAllDebridCast(
			imdbid,
			userid,
			hash,
			filename,
			streamUrl,
			fileSize,
			magnetId,
			fileIndex
		);
		res.status(200).json({
			status: 'success',
			message: 'You can now stream the movie in Stremio',
			filename,
		});
	} catch (e) {
		console.error(e);
		const message = e instanceof Error ? e.message : String(e);
		res.status(500).json({ status: 'error', errorMessage: message });
	}
}
