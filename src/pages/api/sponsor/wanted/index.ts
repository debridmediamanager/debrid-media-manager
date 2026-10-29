import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import type { WantedItemRow } from '@/services/database/wantedItems';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { resolveWantedReused, type WantedForZurg } from '@/services/wanted';
import type { NextApiRequest, NextApiResponse } from 'next';

/** TMDB lookups in flight at once; each is a metadata-cache read almost every time. */
const RESOLVE_AT_ONCE = 25;

/**
 * What zurg holds of a film it wants a better release of. Read from the row on
 * every poll, never from the reused resolution, so an acknowledgement shows at once.
 */
function upgradeOf(row: WantedItemRow): WantedForZurg['upgrade'] {
	const took = row.kind === 'movie' ? row.fulfilled : null;
	return took?.upgradeTo
		? { grab: took.grab, resolution: took.resolution, to: took.upgradeTo }
		: undefined;
}

/**
 * A sponsor's wanted list, for their zurg to fetch: `{"items": [{id, kind, title,
 * imdb, tmdb?, tvdb?, seasons?: [{season, episodes}], upgrade?}]}`. Films zurg
 * already acknowledged are left out unless it wants a better release; shows stay,
 * so new episodes are fetched as they air. See docs/sponsor-api.md.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const sponsor = await sponsorOfDmmApiKeyHeader(req, res);
	if (!sponsor) return;
	if (
		!(await checkRateLimitFor(
			`sponsor:${sponsor.shortId}`,
			RATE_LIMIT_CONFIGS.sponsorWanted,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}

	try {
		const rows = (await db.listWanted(sponsor.shortId)).filter(
			(row) => row.kind === 'show' || !row.fulfilledAt || upgradeOf(row)
		);
		const items: WantedForZurg[] = [];
		for (let i = 0; i < rows.length; i += RESOLVE_AT_ONCE) {
			items.push(
				...(await Promise.all(
					rows.slice(i, i + RESOLVE_AT_ONCE).map(async (row) => {
						const upgrade = upgradeOf(row);
						return { ...(await resolveWantedReused(row)), ...(upgrade && { upgrade }) };
					})
				))
			);
		}
		await db.touchWantedPolled(sponsor.shortId);
		res.setHeader('Cache-Control', 'private, no-store');
		return res.status(200).json({ items });
	} catch (error) {
		console.error('[sponsor/wanted] list failed', error);
		return res.status(500).json({ error: 'Could not read the wanted list' });
	}
}
