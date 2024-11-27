import { getDMMLibrary, PAGE_SIZE } from '@/utils/castCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, skip } = req.query;
	if (typeof skip !== 'string') {
		return res.status(400).json({ error: 'Invalid "skip" query parameter' });
	}

	const skipNum = skip.replaceAll(/^skip=/g, '').replaceAll(/\.json$/g, '');
	const page = Math.floor(Number(skipNum) / PAGE_SIZE) + 1;

	const result = await getDMMLibrary(userid as string, page);

	res.setHeader('access-control-allow-origin', '*');
	if ('error' in result) {
		return res.status(result.status).json({ error: result.error });
	}

	res.status(result.status).json(result.data);
}
