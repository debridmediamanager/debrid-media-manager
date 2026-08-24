import { directDownloadPremiumize } from '@/services/premiumize';
import { repository as db } from '@/services/repository';
import { generatePremiumizeUserId } from '@/utils/premiumizeCastApiHelpers';
import { premiumizeVideoFiles } from '@/utils/premiumizeCastFiles';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { NextApiRequest, NextApiResponse } from 'next';

// MOVIE cast: resolves the hash once to learn which file is the feature, then
// stores the hash and that file's path. No link is kept - the viewer mints
// their own at play time, which is both fresher and billed to the right account.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { imdbid, hash } = req.query;
	const apiKey = readProviderKey(req, ['apiKey']);

	if (!apiKey || !hash) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "apiKey" or "hash" parameter',
		});
		return;
	}
	if (typeof imdbid !== 'string' || typeof hash !== 'string') {
		res.status(400).json({ status: 'error', errorMessage: 'Invalid "imdbid" or "hash"' });
		return;
	}

	try {
		const files = premiumizeVideoFiles(await directDownloadPremiumize(apiKey, hash));
		if (files.length === 0) {
			res.status(404).json({
				status: 'error',
				errorMessage: 'No video files in this release on Premiumize',
			});
			return;
		}

		// Largest first, so this is the feature rather than a trailer or an extra
		const feature = files[0];
		const userid = await generatePremiumizeUserId(apiKey);

		await db.savePremiumizeCast(
			imdbid,
			userid,
			hash,
			feature.filename,
			Math.round(feature.size / 1024 / 1024),
			feature.path
		);

		res.status(200).json({
			status: 'success',
			message: 'You can now stream the movie in Stremio',
			filename: feature.filename,
		});
	} catch (error) {
		console.error(
			'Failed to cast movie to Premiumize:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
