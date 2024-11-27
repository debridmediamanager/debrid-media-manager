import { getDMMTorrent } from '@/utils/castCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, id } = req.query;
	if (typeof id !== 'string') {
		return res.status(400).json({ error: 'Invalid "skip" query parameter' });
	}
	const torrentID = id.replaceAll(/^dmm:/g, '').replaceAll(/\.json$/g, '');

	const result = await getDMMTorrent(userid as string, torrentID);

	res.setHeader('access-control-allow-origin', '*');
	if ('error' in result) {
		return res.status(result.status).json({ error: result.error });
	}

	res.status(result.status).json(result.data);
}
