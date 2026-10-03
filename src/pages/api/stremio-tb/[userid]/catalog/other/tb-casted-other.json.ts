import { sendLibraryPage } from '@/utils/castAddonResponses';
import { getTorBoxDMMLibrary } from '@/utils/torboxCastCatalogHelper';
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

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	return sendLibraryPage(res, 'tb', 1, () => getTorBoxDMMLibrary(userid, 1));
}
