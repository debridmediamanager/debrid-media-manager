import { getDMMTorrent } from '@/utils/castCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

// gets information about a torrent (viewing your library)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, id } = req.query;
	if (typeof userid !== 'string' || typeof id !== 'string') {
		return res.status(400).json({ error: 'Invalid "userid" or "id" query parameter' });
	}
	const torrentID = id.replaceAll(/^dmm:/g, '').replaceAll(/\.json$/g, '');

	try {
		const result = await getDMMTorrent(userid as string, torrentID);
		res.setHeader('access-control-allow-origin', '*');
		if ('error' in result) {
			return res.status(result.status).json({ error: result.error });
		}

		res.status(result.status).json(result.data);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: `Failed to get DMM torrent: ${error}` });
	}
}
