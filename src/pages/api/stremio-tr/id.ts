import {
	generateTorrinUserId,
	validateMethod,
	validateTorrinCreds,
} from '@/utils/torrinCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (!validateMethod(req, res, ['GET'])) return;

	const creds = validateTorrinCreds(req, res);
	if (!creds) return;

	try {
		const id = await generateTorrinUserId(creds.baseUrl, creds.apiKey);
		res.status(200).json({ id });
	} catch (error) {
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
