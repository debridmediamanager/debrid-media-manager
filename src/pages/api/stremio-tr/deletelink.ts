import { repository as db } from '@/services/repository';
import { generateTorrinUserId, validateTorrinApiKey } from '@/utils/torrinCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'DELETE') {
		res.setHeader('Allow', ['DELETE']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey, baseUrl, imdbId, hash } = req.body;

	if (!apiKey || typeof apiKey !== 'string' || !baseUrl || typeof baseUrl !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "baseUrl"/"apiKey" in request body',
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
		const validation = await validateTorrinApiKey(baseUrl, apiKey);
		if (!validation.valid) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Invalid Torrin credentials',
			});
			return;
		}

		const userId = await generateTorrinUserId(baseUrl, apiKey);
		await db.deleteTorrinCastedLink(imdbId, userId, hash);

		res.status(200).json({
			status: 'success',
			message: 'Link deleted successfully',
		});
	} catch (error) {
		console.error('Error deleting Torrin casted link:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: 'Failed to delete link',
		});
	}
}
