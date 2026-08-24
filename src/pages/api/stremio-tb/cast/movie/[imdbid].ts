import { repository as db } from '@/services/repository';
import { getBiggestFileTorBoxStreamUrl } from '@/utils/getTorBoxStreamUrl';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { generateTorBoxUserId } from '@/utils/torboxCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

// MOVIE cast: gets a stream URL from TorBox and saves it to the database
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { imdbid, hash } = req.query;
	const apiKey = readProviderKey(req, ['apiKey']);
	if (!apiKey || !hash) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "apiKey" or "hash" query parameter',
		});
		return;
	}
	if (typeof imdbid !== 'string' || typeof hash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "apiKey" or "hash" query parameter',
		});
		return;
	}

	try {
		const [streamUrl, fileSize, torrentId, fileId, filename] =
			await getBiggestFileTorBoxStreamUrl(apiKey, hash);

		if (streamUrl) {
			const message = 'You can now stream the movie in Stremio';

			const userid = await generateTorBoxUserId(apiKey);

			// Extract just the filename from the path (remove directory path)
			const displayFilename = filename.split('/').pop() ?? 'Unknown';

			await db.saveTorBoxCast(
				imdbid,
				userid,
				hash,
				displayFilename, // url field stores the filename for display
				streamUrl, // link field stores the actual stream URL
				fileSize,
				torrentId,
				fileId
			);

			res.status(200).json({
				status: 'success',
				message,
				filename: displayFilename,
			});
			return;
		} else {
			res.status(500).json({
				status: 'error',
				errorMessage: 'Failed to get stream URL',
			});
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
