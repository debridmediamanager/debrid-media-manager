import { generateUserId, validateMethod, validateToken } from '@/utils/castApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!validateMethod(req, res, ['GET'])) return;

	const token = validateToken(req, res);
	if (!token) return;

	try {
		const id = await generateUserId(token);
		res.status(200).json({ id });
	} catch (error) {
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
