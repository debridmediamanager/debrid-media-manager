import { repository as db } from '@/services/repository';
import {
	generateUserId,
	handleApiError,
	validateMethod,
	validateToken,
} from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (!validateMethod(req, res, ['POST'])) return;

	const token = validateToken(req, res);
	if (!token) return;

	const { imdbId, hash } = req.body;

	if (!imdbId || !hash) {
		res.status(400).json({ error: 'Missing required parameters' });
		return;
	}

	try {
		const userId = await generateUserId(token);
		const deleted = await db.deleteCastedLink(imdbId, userId, hash);
		if (!deleted) {
			res.status(404).json({ error: 'Link not found' });
			return;
		}
		res.status(200).json({ message: 'Link deleted successfully' });
	} catch (error) {
		handleApiError(error, res, `Failed to delete link for ${imdbId}, ${error}`);
	}
}
