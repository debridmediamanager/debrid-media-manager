import {
	EasynewsAuthError,
	readCredentials,
	searchEasynews,
	type EasynewsTarget,
} from '@/services/easynews';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { withoutBlockedReleases } from '@/services/takedown/blocklist';
import type { NextApiRequest, NextApiResponse } from 'next';

// Easynews results for one movie or show season, searched with the caller's own
// account (see services/easynews). Not cached: each account sees its own plan's
// retention, and nothing here spends a shared quota.
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const credentials = readCredentials(req.body);
	if (!credentials) {
		return res.status(400).json({ error: 'Easynews username and password are required' });
	}

	const { title, year, seasonNum } = req.body ?? {};
	if (typeof title !== 'string' || !title.trim()) {
		return res.status(400).json({ error: 'title is required' });
	}
	const target: EasynewsTarget = { title: title.trim().slice(0, 120) };
	// A number from /api/info/movie, whatever MovieInfo says.
	if ((typeof year === 'string' || typeof year === 'number') && /^\d{4}$/.test(String(year))) {
		target.year = String(year);
	}
	if (seasonNum !== undefined && seasonNum !== null) {
		if (!Number.isInteger(seasonNum) || seasonNum < 0) {
			return res.status(400).json({ error: 'seasonNum must be a non-negative integer' });
		}
		target.seasonNum = seasonNum;
	}

	try {
		const results = await searchEasynews(credentials, target);
		res.setHeader('Cache-Control', 'private, no-store');
		return res.status(200).json({ results: await withoutBlockedReleases(results) });
	} catch (error) {
		if (error instanceof EasynewsAuthError) {
			return res.status(401).json({ error: error.message });
		}
		console.error('Easynews search failed:', error);
		return res.status(502).json({ error: 'Easynews search failed' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
