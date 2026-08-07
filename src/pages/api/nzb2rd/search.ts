import { getNewznabApiKey, isValidImdbId, searchUsenet } from '@/services/nzb2rd';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

// Usenet results for one movie or show season. The server-side hop exists to
// keep the indexer API key out of the browser — see the note in services/nzb2rd.
//
// Results are cached in the DB for a week (see NZB_SEARCH_TTL_MS). The indexer
// meters API calls against one shared account and this runs on every media page
// of a public site, so an HTTP cache hint is not enough on its own: an edge miss
// would still spend a call. The DB cache is shared by all four swarm instances
// and survives restarts and cache purges.
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { imdbId, seasonNum, title } = req.query;
	if (!isValidImdbId(imdbId)) {
		return res.status(400).json({ error: 'imdbId is required (format: tt1234567)' });
	}

	let season: number | undefined;
	if (seasonNum !== undefined && seasonNum !== '') {
		const parsed = parseInt(Array.isArray(seasonNum) ? seasonNum[0] : seasonNum, 10);
		if (!Number.isInteger(parsed) || parsed < 0) {
			return res.status(400).json({ error: 'seasonNum must be a non-negative integer' });
		}
		season = parsed;
	}

	if (!getNewznabApiKey()) {
		return res.status(503).json({ error: 'Usenet indexer is not configured' });
	}

	// A stale entry is still worth holding on to: if the indexer then fails, week-
	// old results beat an error page, and cost nothing.
	const cached = await db.getCachedNzbSearch(imdbId, season).catch((error) => {
		console.error('Usenet search cache read failed (continuing):', error);
		return null;
	});

	// Only used to find season packs by name; bounded so it cannot be abused as a
	// free-text passthrough to the indexer.
	const showTitle =
		typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : undefined;

	if (cached?.isFresh) {
		res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
		return res.status(200).json({ results: cached.results, cached: true });
	}

	try {
		const results = await searchUsenet({ imdbId, seasonNum: season, title: showTitle });
		await db.setCachedNzbSearch(imdbId, season, results);
		res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
		return res.status(200).json({ results, cached: false });
	} catch (error) {
		console.error('Usenet search failed:', error);
		if (cached) {
			// Serve what we have rather than breaking the section.
			return res.status(200).json({ results: cached.results, cached: true, stale: true });
		}
		return res.status(502).json({ error: 'Usenet indexer unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
