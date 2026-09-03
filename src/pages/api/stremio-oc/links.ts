import { repository as db } from '@/services/repository';
import { resolveOffcloudUser } from '@/utils/offcloudCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

// POST, not GET: the API key travels in the body so it never reaches an access
// log or a proxy cache key.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, private');

	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey } = req.body ?? {};
	if (!apiKey || typeof apiKey !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "apiKey" in request body',
		});
		return;
	}

	try {
		const { valid, userId } = await resolveOffcloudUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({ status: 'error', errorMessage: 'Invalid Offcloud API key' });
			return;
		}

		res.status(200).json({
			status: 'success',
			links: await db.fetchAllOffcloudCastedLinks(userId),
		});
	} catch (error) {
		console.error('Error fetching Offcloud casted links:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
