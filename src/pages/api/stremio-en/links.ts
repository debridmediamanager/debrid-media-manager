import { repository as db } from '@/services/repository';
import { resolveEasynewsUser } from '@/utils/easynewsCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

// POST, not GET: the Easynews key travels in the body so it never reaches an access
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
			errorMessage: 'Missing or invalid "apiKey" (the Easynews key) in request body',
		});
		return;
	}

	try {
		const { valid, userId } = await resolveEasynewsUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Easynews rejected the username or password',
			});
			return;
		}

		res.status(200).json({
			status: 'success',
			links: await db.fetchAllEasynewsCastedLinks(userId),
		});
	} catch (error) {
		console.error('Error fetching Easynews casted links:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
