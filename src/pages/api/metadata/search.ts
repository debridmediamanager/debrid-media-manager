import { metadataAccess } from '@/pages/api/metadata/[id]';
import { searchMetadata } from '@/services/metadata';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * A title's candidates by name, for sponsors' tools that have a release name and no id:
 * `?query=Smallville&type=show&year=2001` answers `{sources: {tmdb: …}}`, TMDB's own search.
 * Films narrow by release year, shows by first air year. Each candidate's id then reads
 * everything through `/api/metadata/tmdb:{movie|tv}:N`.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
	const type = req.query.type;
	const yearParam = typeof req.query.year === 'string' ? req.query.year : '';
	if (
		!query ||
		query.length > 200 ||
		(type !== 'movie' && type !== 'show') ||
		(yearParam && !/^\d{4}$/.test(yearParam))
	) {
		return res
			.status(400)
			.json({ error: 'query is required; type is movie or show; year is YYYY' });
	}
	if (!(await metadataAccess(req, res))) return;
	res.setHeader('Cache-Control', 'private, no-store');
	return res
		.status(200)
		.json(await searchMetadata(query, type, yearParam ? Number(yearParam) : undefined));
}
