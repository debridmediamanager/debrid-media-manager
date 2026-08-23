import type { NextApiRequest, NextApiResponse } from 'next';

import { getTorBoxObservabilityStats } from '@/lib/observability/getTorBoxObservabilityStats';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
	res.setHeader('CDN-Cache-Control', 'no-store');
	res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Expires', '0');

	try {
		const stats = await getTorBoxObservabilityStats();
		return res.status(200).json(stats);
	} catch (error) {
		console.error('Failed to get TorBox observability stats:', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}
