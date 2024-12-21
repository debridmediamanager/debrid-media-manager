import { getToken } from '@/services/realDebrid';
import { Repository } from '@/services/repository';
import { getDMMTorrent } from '@/utils/castCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

// gets information about a torrent (viewing your library)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, id } = req.query;
	if (typeof userid !== 'string' || typeof id !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "id" query parameter',
		});
		return;
	}

	if (req.method === 'OPTIONS') {
		res.setHeader('access-control-allow-origin', '*');
		return res.status(200).end();
	}

	const torrentID = id.replaceAll(/^dmm:/g, '').replaceAll(/\.json$/g, '');

	const profile = await db.getCastProfile(userid);
	if (!profile) {
		res.status(500).json({ error: `Failed to get Real-Debrid profile for user ${userid}` });
		return;
	}

	let response: { access_token: string } | null = null;
	try {
		response = await getToken(
			profile.clientId,
			profile.clientSecret,
			profile.refreshToken,
			true
		);
		if (!response) {
			throw new Error(`no token found for user ${userid}`);
		}
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: `Failed to get Real-Debrid token for user ${userid}` });
		return;
	}

	try {
		const result = await getDMMTorrent(userid as string, torrentID, response.access_token);
		res.setHeader('access-control-allow-origin', '*');
		if ('error' in result) {
			res.status(result.status).json({ error: result.error });
			return;
		}

		res.status(result.status).json(result.data);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: `Failed to get DMM torrent: ${error}` });
		return;
	}
}
