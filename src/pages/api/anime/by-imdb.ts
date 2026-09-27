import { loadAnimeEntryLinks, MAX_IMDB_IDS_PER_LOOKUP } from '@/services/anime/animeEntries';
import { getFranchiseIndex } from '@/services/anime/animeFranchise';
import { getKitsuLabel } from '@/services/anime/kitsuLabels';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { NextApiHandler } from 'next';

/**
 * The AniDB entries filed under each of up to 100 IMDb ids.
 *
 *   GET /api/anime/by-imdb?imdbids=tt10885406,tt22248376
 *
 * One IMDb id is a whole series, so it maps to every season, cour and OVA
 * AniDB lists separately: Bookworm's tt10885406 answers five entries. IMDb ids
 * with none are left out of `results`.
 */
const handler: NextApiHandler = async (req, res) => {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const raw = req.query.imdbids;
	const imdbIds =
		typeof raw === 'string'
			? [...new Set(raw.split(',').map((id) => id.trim()))].filter((id) => id !== '')
			: [];
	if (imdbIds.length === 0 || !imdbIds.every((id) => /^tt\d{1,10}$/.test(id))) {
		return res
			.status(400)
			.json({ error: 'imdbids must be a comma-separated list of IMDb ids' });
	}
	if (imdbIds.length > MAX_IMDB_IDS_PER_LOOKUP) {
		return res
			.status(400)
			.json({ error: `At most ${MAX_IMDB_IDS_PER_LOOKUP} IMDb ids per request` });
	}

	try {
		const results = await loadAnimeEntryLinks(imdbIds, {
			index: await getFranchiseIndex(),
			getRows: (ids) => db.getAnimeEntryRows(ids),
			getKitsuLabel,
		});
		return res.status(200).json({ results });
	} catch (error) {
		console.error(
			'Could not map IMDb ids to AniDB entries:',
			error instanceof Error ? error.message : 'unknown error'
		);
		return res.status(500).json({ error: 'Could not look up AniDB entries' });
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.animeEntries);
