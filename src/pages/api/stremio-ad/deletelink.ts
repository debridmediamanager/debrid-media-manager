import { repository as db } from '@/services/repository';
import { sendAllDebridApiError } from '@/utils/allDebridApiError';
import { resolveAllDebridUser } from '@/utils/allDebridCastApiHelpers';
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
		const { valid, userId } = await resolveAllDebridUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Invalid AllDebrid API key',
			});
			return;
		}

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
		sendAllDebridApiError(error, res);
	}
}
