import { getDMMLibrary } from '@/utils/castCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid } = req.query;
	const result = await getDMMLibrary(userid as string, 1);

	res.setHeader('access-control-allow-origin', '*');
	if ('error' in result) {
		return res.status(result.status).json({ error: result.error });
	}

	res.status(result.status).json(result.data);
}
