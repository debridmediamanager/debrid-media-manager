import {
	castFailureFromStatus,
	castNoticeMeta,
	sendForeignMeta,
	sendMetaError,
	sendMetaFailure,
	sendNoticeMeta,
} from '@/utils/castAddonResponses';
import { getTorBoxDMMTorrent } from '@/utils/torboxCastCatalogHelper';
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

	// Parse id: dmm-tb:123.json -> 123
	const idStr = id.replace('.json', '');

	const notice = castNoticeMeta('tb', idStr);
	if (notice) {
		return sendNoticeMeta(res, notice);
	}

	// Skip if this is not a TorBox ID - let other addons handle it
	if (!idStr.startsWith('dmm-tb:')) {
		return sendForeignMeta(res);
	}

	const torrentId = idStr.split(':')[1];

	try {
		const result = await getTorBoxDMMTorrent(userid, torrentId);
		if ('error' in result) {
			return sendMetaFailure(res, 'tb', castFailureFromStatus(result.status), idStr);
		}
		res.status(result.status).json(result.data);
	} catch (error) {
		// An id the account no longer holds answers 404 ITEM_NOT_FOUND, and
		// that used to escape as a 500 that clients kept asking again.
		return sendMetaError(res, 'tb', error, idStr);
	}
}
