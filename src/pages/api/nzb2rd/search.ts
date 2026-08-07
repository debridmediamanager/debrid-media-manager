import { getNewznabApiKey, isValidImdbId, searchUsenet } from '@/services/nzb2rd';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

// Usenet results for one movie or show season. The server-side hop exists to
// keep the indexer API key out of the browser — see the note in services/nzb2rd.
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { imdbId, seasonNum } = req.query;
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

	try {
		const results = await searchUsenet({ imdbId, seasonNum: season });
		// Cache briefly: the expandable section refetches on every page open, and
		// the indexer enforces a daily API call quota.
		res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
		return res.status(200).json({ results });
	} catch (error) {
		console.error('Usenet search failed:', error);
		return res.status(502).json({ error: 'Usenet indexer unreachable' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
