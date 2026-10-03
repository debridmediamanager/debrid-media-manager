import {
	castFailureFromStatus,
	sendCatalogError,
	sendCatalogFailure,
} from '@/utils/castAddonResponses';
import { isLegacyToken } from '@/utils/castApiHelpers';
import { getDMMLibrary } from '@/utils/castCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	const { userid } = req.query;
	if (typeof userid !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" query parameter',
		});
		return;
	}

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	// Check for legacy 5-character token
	if (isLegacyToken(userid)) {
		return res.status(200).json({
			metas: [
				{
					id: 'dmm:update-required',
					type: 'other',
					name: '⚠️ DMM Cast RD Update Required',
					description:
						'Please reinstall the addon from https://debridmediamanager.com/stremio\n\nYour casted content will be preserved.',
					poster: 'https://static.debridmediamanager.com/dmmcast.png',
				},
			],
		});
	}

	try {
		const result = await getDMMLibrary(userid, 1);
		if ('error' in result) {
			return sendCatalogFailure(res, 'rd', castFailureFromStatus(result.status), {
				firstPage: true,
			});
		}
		res.status(result.status).json(result.data);
	} catch (error) {
		// Nothing here may escape as Next's bare 500: a Real-Debrid connection
		// reset reached Stremio that way on 2026-10-03.
		return sendCatalogError(res, 'rd', error, { firstPage: true });
	}
}
