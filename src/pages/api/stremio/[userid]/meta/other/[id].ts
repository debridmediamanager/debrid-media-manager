import { RdTokenExpiredError, getToken } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { isLegacyToken } from '@/utils/castApiHelpers';
import { getDMMTorrent } from '@/utils/castCatalogHelper';
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

		// Skip if this is an AllDebrid or TorBox ID - let those addons handle it
		if (cleanId.startsWith('dmm-ad:') || cleanId.startsWith('dmm-tb:')) {
			console.log('[meta/other/id] Skipping non-RD ID:', cleanId);
			res.status(200).json({ meta: null });
			return;
		}

		const torrentID = cleanId.replaceAll(/^dmm:/g, '');
		console.log('[meta/other/id] Torrent ID:', torrentID);

		const profile = await db.getCastProfile(userid);
		if (!profile) {
			console.log('[meta/other/id] No profile found for user:', userid);
			res.status(500).json({ error: `Failed to get Real-Debrid profile for user ${userid}` });
			return;
		}
		console.log('[meta/other/id] Profile found for user:', userid);

		let response: { access_token: string } | null = null;
		try {
			console.log('[meta/other/id] Getting token for user:', userid);
			response = await getToken(
				profile.clientId,
				profile.clientSecret,
				profile.refreshToken,
				true
			);
			if (!response) {
				throw new Error(`no token found for user ${userid}`);
			}
			console.log('[meta/other/id] Token obtained successfully');
		} catch (error) {
			if (error instanceof RdTokenExpiredError) {
				res.status(200).json({
					meta: {
						id: cleanId,
						name: '⚠️ RD Auth Expired',
						type: 'other',
						description:
							'Your Real-Debrid authorization has expired. Please re-authenticate at https://debridmediamanager.com/stremio',
					},
				});
				return;
			}
			console.error('[meta/other/id] Token error:', error);
			res.status(500).json({ error: `Failed to get Real-Debrid token for user ${userid}` });
			return;
		}

		console.log('[meta/other/id] Fetching torrent:', torrentID);
		const result = await getDMMTorrent(userid as string, torrentID, response.access_token);
		if ('error' in result) {
			console.log('[meta/other/id] Torrent fetch error:', result);
			res.status(result.status).json({ error: result.error });
			return;
		}

		console.log('[meta/other/id] Success:', { status: result.status });
		res.status(result.status).json(result.data);
	} catch (error) {
		console.error('[meta/other/id] Exception caught:', error);
		res.status(500).json({
			error: 'Internal server error',
			message: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined,
		});
		return;
	}
}
