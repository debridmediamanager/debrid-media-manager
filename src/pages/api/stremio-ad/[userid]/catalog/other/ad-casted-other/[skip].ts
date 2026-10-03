import { repository as db } from '@/services/repository';
import { PAGE_SIZE, getAllDebridDMMLibrary } from '@/utils/allDebridCastCatalogHelper';
import { sendLibraryPage } from '@/utils/castAddonResponses';
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

	return sendLibraryPage(res, 'ad', page, async () => {
		const profile = await db.getAllDebridCastProfile(userid);
		if (!profile) {
			return { error: 'Go to DMM and connect your AllDebrid account', status: 401 };
		}
		const { metas, hasMore } = await getAllDebridDMMLibrary(profile.apiKey, page);
		return { data: { metas, hasMore, cacheMaxAge: 0 }, status: 200 };
	});
}
