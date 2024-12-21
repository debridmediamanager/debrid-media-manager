import { Repository } from '@/services/repository';
import {
	generateUserId,
	handleApiError,
	validateMethod,
	validateToken,
} from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
		await db.deleteCastedLink(imdbId, userId, hash);
		res.status(200).json({ message: 'Link deleted successfully' });
	} catch (error) {
		handleApiError(error, res, `Failed to delete link for ${imdbId}, ${error}`);
	}
}
