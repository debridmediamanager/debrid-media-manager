import { repository as db } from '@/services/repository';
import { getAllDebridDMMLibrary } from '@/utils/allDebridCastCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { userid } = req.query;

	if (typeof userid !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" query parameter',
		});
		return;
	}

	try {
		const profile = await db.getAllDebridCastProfile(userid);
		if (!profile) {
			console.log('[AD Catalog] No profile found for user:', userid);
			res.status(200).json({ metas: [], hasMore: false, cacheMaxAge: 0 });
			return;
		}

		console.log('[AD Catalog] Fetching library for user:', userid);
		const { metas, hasMore } = await getAllDebridDMMLibrary(profile.apiKey, 1);
		console.log('[AD Catalog] Got metas:', metas.length);

		res.status(200).json({
			metas,
			hasMore,
			cacheMaxAge: 0,
		});
	} catch (error) {
		console.error(
			'[AD Catalog] Failed to get AllDebrid library:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get AllDebrid library' });
	}
}
