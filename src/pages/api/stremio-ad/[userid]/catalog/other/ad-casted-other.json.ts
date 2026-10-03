import { repository as db } from '@/services/repository';
import { getAllDebridDMMLibrary } from '@/utils/allDebridCastCatalogHelper';
import { sendLibraryPage } from '@/utils/castAddonResponses';
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

	return sendLibraryPage(res, 'ad', 1, async () => {
		const profile = await db.getAllDebridCastProfile(userid);
		if (!profile) {
			return { error: 'Go to DMM and connect your AllDebrid account', status: 401 };
		}
		const { metas, hasMore } = await getAllDebridDMMLibrary(profile.apiKey, 1);
		return { data: { metas, hasMore, cacheMaxAge: 0 }, status: 200 };
	});
}
