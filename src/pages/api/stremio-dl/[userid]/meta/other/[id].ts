import { getDebridLinkDMMItem, parseDebridLinkMetaId } from '@/utils/debridLinkCastCatalogHelper';
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

	const cleanId = id.replace(/\.json$/, '');

	// Every DMM Cast addon declares the `dmm` meta prefix, so Stremio asks all of
	// them for every library id. Anything that is not ours belongs to a sibling
	// addon and must answer with a null meta rather than an error.
	const torrentId = parseDebridLinkMetaId(cleanId);
	if (!torrentId) {
		res.status(200).json({ meta: null });
		return;
	}

	try {
		const result = await getDebridLinkDMMItem(userid, torrentId);
		if ('error' in result) {
			res.status(result.status).json({ error: result.error });
			return;
		}
		res.status(result.status).json(result.data);
	} catch (error) {
		console.error(
			'Failed to get Debrid-Link item meta:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get Debrid-Link item meta' });
	}
}
