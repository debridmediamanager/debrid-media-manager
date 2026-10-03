import {
	castFailureFromStatus,
	castNoticeMeta,
	sendForeignMeta,
	sendMetaError,
	sendMetaFailure,
	sendNoticeMeta,
} from '@/utils/castAddonResponses';
import { getPremiumizeDMMItem, parsePremiumizeMetaId } from '@/utils/premiumizeCastCatalogHelper';
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

	const notice = castNoticeMeta('pm', cleanId);
	if (notice) {
		sendNoticeMeta(res, notice);
		return;
	}

	// Every DMM Cast addon declares the `dmm` meta prefix, so Stremio asks all of
	// them for every library id. Anything that is not ours belongs to a sibling
	// addon and must answer with a null meta rather than an error.
	const parsed = parsePremiumizeMetaId(cleanId);
	if (!parsed) {
		sendForeignMeta(res);
		return;
	}

	try {
		const result = await getPremiumizeDMMItem(userid, parsed.kind, parsed.id);
		if ('error' in result) {
			sendMetaFailure(res, 'pm', castFailureFromStatus(result.status), cleanId);
			return;
		}
		res.status(result.status).json(result.data);
	} catch (error) {
		sendMetaError(res, 'pm', error, cleanId);
	}
}
