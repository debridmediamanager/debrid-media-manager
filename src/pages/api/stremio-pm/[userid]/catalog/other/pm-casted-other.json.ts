import { getPremiumizeDMMLibrary } from '@/utils/premiumizeCastCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	const { userid } = req.query;
	if (typeof userid !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" query parameter',
		});
		return;
	}

	try {
		const result = await getPremiumizeDMMLibrary(userid, 1);
		if ('error' in result) {
			return res.status(result.status).json({ error: result.error });
		}
		res.status(result.status).json(result.data);
	} catch (error) {
		console.error(
			'Failed to get Premiumize library:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get Premiumize library' });
	}
}
