import { repository as db } from '@/services/repository';
import { generateOffcloudUserId, resolveCachedOffcloudFiles } from '@/utils/offcloudCastApiHelpers';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { NextApiRequest, NextApiResponse } from 'next';

// MOVIE cast: resolves the hash once to learn which file is the feature, then
// stores the hash and that file's path.
//
// The resolve is `POST /api/cache/info`, which lists a cached release's files
// and sizes without adding anything to the account - so casting costs Offcloud
// nothing and leaves no cloud item behind. No link is kept either: the viewer
// mints their own at play time, which is fresher and keeps the caster's
// account-scoped CDN token out of the database.
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
		const files = await resolveCachedOffcloudFiles(apiKey, hash);
		if (files.length === 0) {
			res.status(404).json({
				status: 'error',
				errorMessage: 'No cached video files for this release on Offcloud',
			});
			return;
		}

		// Largest first, so this is the feature rather than a trailer or an extra
		const feature = files[0];
		const userid = await generateOffcloudUserId(apiKey);

		await db.saveOffcloudCast(
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
			'Failed to cast movie to Offcloud:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
