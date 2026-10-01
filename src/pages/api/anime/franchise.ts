import { loadAnimeFranchise } from '@/services/anime/animeEntries';
import { getFranchiseIndex } from '@/services/anime/animeFranchise';
import { getKitsuLabel } from '@/services/anime/kitsuLabels';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { NextApiHandler } from 'next';

/**
 * The AniDB entries related to one entry, and the IMDb ids it is filed under.
 *
 *   GET /api/anime/franchise?anidbid=17617
 *
 * Related means sharing an IMDb id in the Fribb dataset; see
 * `animeFranchise.ts` for why that is the only relation available. `known`
 * is false for an id neither the dataset nor the `Anime` table has heard of,
 * which is how the page tells an unknown id from one with no metadata yet.
 */
const handler: NextApiHandler = async (req, res) => {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const raw = req.query.anidbid;
	const anidbId = typeof raw === 'string' && /^\d{1,7}$/.test(raw) ? parseInt(raw, 10) : NaN;
	if (!Number.isSafeInteger(anidbId) || anidbId <= 0) {
		return res.status(400).json({ error: 'anidbid must be a positive AniDB id' });
	}

	try {
		const franchise = await loadAnimeFranchise(anidbId, {
			index: await getFranchiseIndex(),
			getRows: (ids) => db.getAnimeEntryRows(ids),
			getKitsuLabel,
		});
		return res.status(200).json(franchise);
	} catch (error) {
		console.error(
			'Could not load an anime franchise:',
			error instanceof Error ? error.message : 'unknown error'
		);
		return res.status(500).json({ error: 'Could not load related entries' });
	}
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.animeEntries);
