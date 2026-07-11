import { repository as db } from '@/services/repository';
import { unrestrictTorrinLink } from '@/services/torrin';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

	const { userid, link } = req.query;
	if (typeof userid !== 'string' || typeof link !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "link" query parameter',
		});
		return;
	}

	let profile: { baseUrl: string; apiKey: string } | null = null;
	try {
		profile = await db.getTorrinCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		console.error(
			'Failed to get Torrin profile:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: `Failed to get Torrin profile for user ${userid}` });
		return;
	}

	try {
		const restrictable = decodeURIComponent(link);
		const unrestrict = await unrestrictTorrinLink(
			profile.baseUrl,
			profile.apiKey,
			restrictable
		);
		if (!unrestrict || !unrestrict.download) {
			res.status(500).json({ error: 'Failed to unrestrict link' });
			return;
		}
		res.redirect(unrestrict.download);
	} catch (error) {
		console.error(
			'Failed to play Torrin link:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to play link' });
	}
}
