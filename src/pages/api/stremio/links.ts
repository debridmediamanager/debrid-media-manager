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
	if (!validateMethod(req, res, ['GET'])) return;

	const token = validateToken(req, res);
	if (!token) return;

	try {
		const userId = await generateUserId(token);
		const links = await db.fetchAllCastedLinks(userId);
		res.status(200).json(links);
	} catch (error) {
		handleApiError(error, res, `Failed to fetch links, ${error}`);
	}
}
