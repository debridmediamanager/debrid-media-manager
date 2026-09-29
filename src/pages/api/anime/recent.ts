import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { NextApiHandler } from 'next';

const PAGE_SIZE = 48;

/**
 * The anime that most recently got a release, newest first, as AniDB entries.
 *
 *   GET /api/anime/recent
 */
const handler: NextApiHandler = async (req, res) => {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const results = await db.getRecentlyUpdatedAnime(PAGE_SIZE);
		res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
		return res.status(200).json({ results });
	} catch (error) {
		console.error(
			'Could not list recently updated anime:',
			error instanceof Error ? error.message : 'unknown error'
		);
		return res.status(500).json({ error: 'Could not list recently updated anime' });
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.animeEntries);
