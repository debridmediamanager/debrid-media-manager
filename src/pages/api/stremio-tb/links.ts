import { repository as db } from '@/services/repository';
import { readProviderKey } from '@/utils/providerKeyHeader';
import { resolveTorBoxUser } from '@/utils/torboxCastApiHelpers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method !== 'GET') {
		res.setHeader('Allow', ['GET']);
		res.status(405).end(`Method ${req.method} Not Allowed`);
		return;
	}

	const apiKey = readProviderKey(req, ['apiKey']);

	if (!apiKey) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing or invalid "apiKey" query parameter',
		});
		return;
	}

	try {
		// One /user/me call answers both "is this key good" and "what is the id"
		const { valid, userId } = await resolveTorBoxUser(apiKey);
		if (!valid || !userId) {
			res.status(401).json({
				status: 'error',
				errorMessage: 'Invalid TorBox API key',
			});
			return;
		}

		// Fetch all casted links
		const links = await db.fetchAllTorBoxCastedLinks(userId);

		res.status(200).json({
			status: 'success',
			links,
		});
	} catch (error) {
		console.error('Error fetching TorBox casted links:', error);
		res.status(500).json({
			status: 'error',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
