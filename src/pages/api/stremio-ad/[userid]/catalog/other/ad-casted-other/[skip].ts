import { repository as db } from '@/services/repository';
import { PAGE_SIZE, getAllDebridDMMLibrary } from '@/utils/allDebridCastCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { userid, skip } = req.query;

	if (typeof userid !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" query parameter',
		});
		return;
	}

	// Stremio sends the extra as a path segment, not a query string:
	// `.../ad-casted-other/skip=24.json`. It is an item offset, not a page number,
	// and reading it as one turned every page past the first into an empty list.
	const offset =
		typeof skip === 'string'
			? Number.parseInt(skip.replace(/\.json$/, '').replace(/^skip=/, ''), 10)
			: NaN;
	const page =
		Number.isSafeInteger(offset) && offset > 0 ? Math.floor(offset / PAGE_SIZE) + 1 : 1;

	try {
		const profile = await db.getAllDebridCastProfile(userid);
		if (!profile) {
			res.status(200).json({ metas: [], hasMore: false, cacheMaxAge: 0 });
			return;
		}

		const { metas, hasMore } = await getAllDebridDMMLibrary(profile.apiKey, page);

		res.status(200).json({
			metas,
			hasMore,
			cacheMaxAge: 0,
		});
	} catch (error) {
		console.error(
			'Failed to get AllDebrid library:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get AllDebrid library' });
	}
}
