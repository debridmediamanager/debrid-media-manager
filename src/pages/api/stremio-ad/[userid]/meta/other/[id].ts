import { repository as db } from '@/services/repository';
import {
	getAllDebridDMMTorrent,
	getAllDebridSavedLink,
	parseSavedLinkMetaId,
} from '@/utils/allDebridCastCatalogHelper';
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

	// Skip if this is not an AllDebrid ID - let other addons handle it
	if (!cleanId.startsWith('dmm-ad:')) {
		res.status(200).json({ meta: null });
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
			res.status(401).json({ error: 'Go to DMM and connect your AllDebrid account' });
			return;
		}

		// An `l`-prefixed id is a saved hoster link, which has no magnet behind it.
		const result = parseSavedLinkMetaId(magnetId)
			? await getAllDebridSavedLink(profile.apiKey, magnetId, userid)
			: await getAllDebridDMMTorrent(profile.apiKey, magnetId, userid);

		if ('error' in result) {
			res.status(result.status).json({ error: result.error });
			return;
		}

		res.status(200).json(result.data);
	} catch (error) {
		console.error(
			'Failed to get AllDebrid torrent meta:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get AllDebrid torrent meta' });
	}
}
