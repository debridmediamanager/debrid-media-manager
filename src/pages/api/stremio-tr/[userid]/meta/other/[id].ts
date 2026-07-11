import { getTorrinDMMTorrent } from '@/utils/torrinCastCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { userid, id } = req.query;
	if (typeof userid !== 'string' || typeof id !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "id" query parameter',
		});
		return;
	}

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	const idStr = id.replace('.json', '');

	if (!idStr.startsWith('dmm-tr:')) {
		res.status(200).json({ meta: null });
		return;
	}

	const parts = idStr.split(':');
	if (parts.length < 2) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid id format. Expected dmm-tr:{torrentId}',
		});
		return;
	}

	const torrentId = parts[1];

	const result = await getTorrinDMMTorrent(userid, torrentId);

	if ('error' in result) {
		return res.status(result.status).json({ error: result.error });
	}

	res.status(result.status).json(result.data);
}
