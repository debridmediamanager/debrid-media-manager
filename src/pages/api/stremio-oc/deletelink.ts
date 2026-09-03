import { repository as db } from '@/services/repository';
import { resolveOffcloudUser } from '@/utils/offcloudCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'DELETE') {
		res.setHeader('Allow', ['DELETE']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey, imdbId, hash } = req.body ?? {};
	if (!apiKey || typeof apiKey !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "apiKey" in request body',
		});
		return;
	}
	if (!imdbId || typeof imdbId !== 'string' || !hash || typeof hash !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "imdbId" or "hash" in request body',
		});
		return;
	}

	try {
		const { valid, userId } = await resolveOffcloudUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({ status: 'error', errorMessage: 'Invalid Offcloud API key' });
			return;
		}

		// Only the cast row goes; nothing is removed from the user's Offcloud
		// cloud. `cloud/remove` is a GET that destroys state, and un-casting a
		// title is not a reason to reach for it.
		const deleted = await db.deleteOffcloudCastedLink(imdbId, userId, hash);
		if (!deleted) {
			res.status(404).json({ status: 'error', errorMessage: 'Link not found' });
			return;
		}

		res.status(200).json({ status: 'success', message: 'Link deleted successfully' });
	} catch (error) {
		console.error('Error deleting Offcloud casted link:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
