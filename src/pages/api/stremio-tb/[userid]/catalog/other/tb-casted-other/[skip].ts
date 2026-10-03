import { sendLibraryPage } from '@/utils/castAddonResponses';
import { getTorBoxDMMLibrary, PAGE_SIZE } from '@/utils/torboxCastCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { userid, skip } = req.query;
	if (typeof userid !== 'string' || typeof skip !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "skip" query parameter',
		});
		return;
	}

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	// Parse skip parameter: skip=12.json -> skip=12
	const skipValue = parseInt(skip.replace('.json', '').replace('skip=', ''), 10);
	if (isNaN(skipValue)) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "skip" value',
		});
		return;
	}

	// Convert skip to page number
	const page = Math.floor(skipValue / PAGE_SIZE) + 1;

	return sendLibraryPage(res, 'tb', page, () => getTorBoxDMMLibrary(userid, page));
}
