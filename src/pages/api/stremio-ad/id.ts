import {
	resolveAllDebridUser,
	validateApiKey,
	validateMethod,
} from '@/utils/allDebridCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

// POST, not GET: the API key travels in the body so it never reaches an access
// log or a proxy cache key.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('Cache-Control', 'no-store, private');

	if (!validateMethod(req, res, ['POST'])) return;

	const apiKey = validateApiKey(req, res);
	if (!apiKey) return;

	try {
		const { valid, userId } = await resolveAllDebridUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Invalid AllDebrid API key',
			});
			return;
		}

		res.status(200).json({ id: userId });
	} catch (error) {
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
