import {
	castFailureFromStatus,
	castNoticeMeta,
	sendForeignMeta,
	sendMetaError,
	sendMetaFailure,
	sendNoticeMeta,
} from '@/utils/castAddonResponses';
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

	const notice = castNoticeMeta('dl', cleanId);
	if (notice) {
		sendNoticeMeta(res, notice);
		return;
	}

	// Every DMM Cast addon declares the `dmm` meta prefix, so Stremio asks all of
	// them for every library id. Anything that is not ours belongs to a sibling
	// addon and must answer with a null meta rather than an error.
	const torrentId = parseDebridLinkMetaId(cleanId);
	if (!torrentId) {
		sendForeignMeta(res);
		return;
	}

	try {
		const result = await getDebridLinkDMMItem(userid, torrentId);
		if ('error' in result) {
			sendMetaFailure(res, 'dl', castFailureFromStatus(result.status), cleanId);
			return;
		}
		res.status(result.status).json(result.data);
	} catch (error) {
		sendMetaError(res, 'dl', error, cleanId);
	}
}
