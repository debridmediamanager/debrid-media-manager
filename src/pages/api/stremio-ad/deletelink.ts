import { repository as db } from '@/services/repository';
import { generateAllDebridUserId, validateAllDebridApiKey } from '@/utils/allDebridCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'DELETE') {
		res.setHeader('Allow', ['DELETE']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey, imdbId, hash } = req.body;

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
		// Validate the API key
		const validation = await validateAllDebridApiKey(apiKey);
		if (!validation.valid) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Invalid AllDebrid API key',
			});
			return;
		}

		// Generate user ID
		const userId = await generateAllDebridUserId(apiKey);

		// Delete the casted link
		const deleted = await db.deleteAllDebridCastedLink(imdbId, userId, hash);
		if (!deleted) {
			res.status(404).json({
				status: 'error',
				errorMessage: 'Link not found',
			});
			return;
		}

		res.status(200).json({
			status: 'success',
			message: 'Link deleted successfully',
		});
	} catch (error) {
		console.error('Error deleting AllDebrid casted link:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
