import { sendLibraryPage } from '@/utils/castAddonResponses';
import { getDebridLinkDMMLibrary } from '@/utils/debridLinkCastCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	const { userid } = req.query;
	if (typeof userid !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" query parameter',
		});
		return;
	}

	return sendLibraryPage(res, 'dl', 1, () => getDebridLinkDMMLibrary(userid, 1));
}
