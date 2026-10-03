import { repository as db } from '@/services/repository';
import {
	castFailureFromStatus,
	castNoticeMeta,
	sendForeignMeta,
	sendMetaError,
	sendMetaFailure,
	sendNoticeMeta,
} from '@/utils/castAddonResponses';
import { isLegacyToken } from '@/utils/castApiHelpers';
import { getDMMTorrent } from '@/utils/castCatalogHelper';
import { castAccessToken } from '@/utils/castRdToken';
import { NextApiRequest, NextApiResponse } from 'next';

// gets information about a torrent (viewing your library)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	try {
		console.log('[meta/other/id] Request received:', {
			userid: req.query.userid,
			id: req.query.id,
			url: req.url,
			method: req.method,
		});

		const { userid, id } = req.query;
		if (typeof userid !== 'string' || typeof id !== 'string') {
			console.log('[meta/other/id] Invalid parameters:', { userid, id });
			res.status(400).json({
				status: 'error',
				errorMessage: 'Invalid "userid" or "id" query parameter',
			});
			return;
		}

		if (req.method === 'OPTIONS') {
			console.log('[meta/other/id] OPTIONS request');
			return res.status(200).end();
		}

		// Check for legacy 5-character token
		if (isLegacyToken(userid)) {
			console.log('[meta/other/id] Legacy token detected:', userid);
			res.status(200).json({
				meta: {
					id: id,
					type: 'other',
					name: '⚠️ DMM Cast RD Update Required',
					description:
						'Your DMM Cast for Real-Debrid addon needs to be reinstalled for improved security.\n\nPlease visit https://debridmediamanager.com/stremio to get your new install link.\n\nThis update provides better security with longer tokens.',
					poster: 'https://static.debridmediamanager.com/dmmcast.png',
					background: 'https://static.debridmediamanager.com/background.png',
				},
			});
			return;
		}

		// Clean up the ID - remove prefix and .json suffix
		const cleanId = id.replaceAll(/\.json$/g, '');

		const notice = castNoticeMeta('rd', cleanId);
		if (notice) {
			sendNoticeMeta(res, notice);
			return;
		}

		// Only `dmm:<torrent id>` is ours. The `dmm` prefix this addon declares
		// also covers every sibling DMM Cast addon's ids, and some clients ask
		// every addon for every `other` id whatever its prefix - `cnc:`,
		// `realdebrid:`, `torbox:` from other addons made up 59% of this route's
		// 500s in the week to 2026-10-03, each one a Real-Debrid lookup of an id
		// Real-Debrid never issued.
		const torrentID = /^dmm:([A-Za-z0-9]+)$/.exec(cleanId)?.[1];
		if (!torrentID) {
			console.log('[meta/other/id] Not a Real-Debrid library id:', cleanId);
			sendForeignMeta(res);
			return;
		}
		console.log('[meta/other/id] Torrent ID:', torrentID);

		const profile = await db.getCastProfile(userid);
		if (!profile) {
			console.log('[meta/other/id] No profile found for user:', userid);
			sendMetaFailure(res, 'rd', 'not-connected', cleanId);
			return;
		}
		console.log('[meta/other/id] Profile found for user:', userid);

		let accessToken: string | null = null;
		try {
			console.log('[meta/other/id] Getting token for user:', userid);
			accessToken = await castAccessToken(profile);
		} catch (error) {
			sendMetaError(res, 'rd', error, cleanId);
			return;
		}
		if (!accessToken) {
			sendMetaFailure(res, 'rd', 'not-connected', cleanId);
			return;
		}
		console.log('[meta/other/id] Token obtained successfully');

		console.log('[meta/other/id] Fetching torrent:', torrentID);
		const result = await getDMMTorrent(userid, torrentID, accessToken);
		if ('error' in result) {
			console.log('[meta/other/id] Torrent fetch error:', result);
			sendMetaFailure(res, 'rd', castFailureFromStatus(result.status), cleanId);
			return;
		}

		console.log('[meta/other/id] Success:', { status: result.status });
		res.status(result.status).json(result.data);
	} catch (error) {
		const cleanId = typeof req.query.id === 'string' ? req.query.id.replace(/\.json$/, '') : '';
		sendMetaError(res, 'rd', error, cleanId);
		return;
	}
}
