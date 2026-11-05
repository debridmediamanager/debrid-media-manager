import { getVerifiedAllDebridCastFiles } from '@/services/allDebridCastSelection';
import { repository as db } from '@/services/repository';
import { sendAllDebridApiError } from '@/utils/allDebridApiError';
import { generateAllDebridUserId } from '@/utils/allDebridCastApiHelpers';
import { isAllDebridLockedLink } from '@/utils/allDebridLockedLink';
import { NextApiRequest, NextApiResponse } from 'next';

// Upload runs in the browser; verify its selection through authenticated provider reads.
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
		const files = await getVerifiedAllDebridCastFiles(apiKey, magnetId, hash);
		const file =
			Number.isSafeInteger(fileIndex) && fileIndex >= 0 ? files[fileIndex] : undefined;
		if (!file || !isAllDebridLockedLink(file.link) || file.link !== streamUrl) {
			res.status(400).json({ status: 'error', errorMessage: 'File does not match magnet' });
			return;
		}
		const verifiedFilename = file.path.split('/').pop()!;
		const userid = await generateAllDebridUserId(apiKey);
		await db.saveAllDebridCast(
			imdbid,
			userid,
			hash.toLowerCase(),
			verifiedFilename,
			file.link,
			Math.round(file.size / 1024 / 1024),
			magnetId,
			fileIndex
		);
		res.status(200).json({
			status: 'success',
			message: 'You can now stream the movie in Stremio',
			filename: verifiedFilename,
		});
	} catch (e) {
		console.error('Failed to verify or save AllDebrid movie cast selection');
		sendAllDebridApiError(e, res);
	}
}
