import { leaderboard } from '@/services/fulfillerRewards';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Top fulfillers this week and of all time. Public, and names only those who
 * opted in; nobody's id ever leaves the server.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	try {
		const [week, allTime] = await Promise.all([
			leaderboard(new Date(Date.now() - WEEK_MS)),
			leaderboard(null),
		]);
		res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
		return res.status(200).json({ week, allTime });
	} catch (error) {
		console.error('Building the fulfiller leaderboard failed:', error);
		return res.status(500).json({ error: 'Failed to load the leaderboard' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
