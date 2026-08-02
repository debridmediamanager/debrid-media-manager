import { PAGE_SIZE, getTorrinDMMLibrary } from '@/utils/torrinCastCatalogHelper';
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

	const skipValue = parseInt(skip.replace('.json', '').replace('skip=', ''), 10);
	if (isNaN(skipValue)) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "skip" value',
		});
		return;
	}

	const page = Math.floor(skipValue / PAGE_SIZE) + 1;

	const result = await getTorrinDMMLibrary(userid, page);

	if ('error' in result) {
		return res.status(result.status).json({ error: result.error });
	}

	res.status(result.status).json(result.data);
}
