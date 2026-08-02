import { repository as db } from '@/services/repository';
import { generateTorrinUserId, validateTorrinApiKey } from '@/utils/torrinCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'GET') {
		res.setHeader('Allow', ['GET']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const { apiKey, baseUrl } = req.query;

	if (!apiKey || typeof apiKey !== 'string' || !baseUrl || typeof baseUrl !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "baseUrl"/"apiKey" query parameters',
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
		const links = await db.fetchAllTorrinCastedLinks(userId);

		res.status(200).json({
			status: 'success',
			links,
		});
	} catch (error) {
		console.error('Error fetching Torrin casted links:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: 'Failed to fetch casted links',
		});
	}
}
