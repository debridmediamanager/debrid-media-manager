import { sendLibraryPage } from '@/utils/castAddonResponses';
import { getPremiumizeDMMLibrary } from '@/utils/premiumizeCastCatalogHelper';
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

	return sendLibraryPage(res, 'pm', 1, () => getPremiumizeDMMLibrary(userid, 1));
}
