import { repository as db } from '@/services/repository';
import {
	getAllDebridDMMTorrent,
	getAllDebridSavedLink,
	parseSavedLinkMetaId,
} from '@/utils/allDebridCastCatalogHelper';
import {
	castFailureFromStatus,
	castNoticeMeta,
	sendForeignMeta,
	sendMetaError,
	sendMetaFailure,
	sendNoticeMeta,
} from '@/utils/castAddonResponses';
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

	// Parse the id - format is "dmm-ad:magnetId" or "dmm-ad:magnetId.json"
	const cleanId = id.replace(/\.json$/, '');

	const notice = castNoticeMeta('ad', cleanId);
	if (notice) {
		sendNoticeMeta(res, notice);
		return;
	}

	// Skip if this is not an AllDebrid ID - let other addons handle it
	if (!cleanId.startsWith('dmm-ad:')) {
		sendForeignMeta(res);
		return;
	}

	const parts = cleanId.split(':');
	if (parts.length < 2) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid meta id format',
		});
		return;
	}

	const magnetId = parts[1];

	try {
		const profile = await db.getAllDebridCastProfile(userid);
		if (!profile) {
			sendMetaFailure(res, 'ad', 'not-connected', cleanId);
			return;
		}

		// An `l`-prefixed id is a saved hoster link, which has no magnet behind it.
		const result = parseSavedLinkMetaId(magnetId)
			? await getAllDebridSavedLink(profile.apiKey, magnetId, userid)
			: await getAllDebridDMMTorrent(profile.apiKey, magnetId, userid);

		if ('error' in result) {
			sendMetaFailure(res, 'ad', castFailureFromStatus(result.status), cleanId);
			return;
		}

		res.status(200).json(result.data);
	} catch (error) {
		sendMetaError(res, 'ad', error, cleanId);
	}
}
