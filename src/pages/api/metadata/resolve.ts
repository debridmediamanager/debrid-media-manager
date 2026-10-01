import { resolveTitle } from '@/services/metadata/resolve';
import { hasInternalSecret } from '@/utils/internalAuth';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * A parsed release name to an IMDb id: `?title=&year=&type=movie|show`. Answers
 * `match` only when the providers agree on one title; callers should act on
 * `confidence` "exact" (or "title" when they had no year) and treat the rest as
 * unresolved. Internal callers only, like `/api/metadata/{imdbId}`.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!hasInternalSecret(req, process.env.METADATA_API_SECRET)) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
	const yearParam = typeof req.query.year === 'string' ? req.query.year : '';
	const typeParam = typeof req.query.type === 'string' ? req.query.type : '';
	const year = /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined;
	const type = typeParam === 'movie' || typeParam === 'show' ? typeParam : undefined;

	if (!title || title.length > 200 || (yearParam && !year) || (typeParam && !type)) {
		return res
			.status(400)
			.json({ error: 'title is required; year must be YYYY; type must be movie or show' });
	}

	try {
		const result = await resolveTitle({ title, year, type });
		res.setHeader('Cache-Control', 'private, no-store');
		return res.status(200).json(result);
	} catch (error) {
		console.error('[metadata] resolve failed', { title, year, type, error });
		return res.status(500).json({ error: 'Resolve failed' });
	}
}
