import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import type { WantedItemRow } from '@/services/database/wantedItems';
import { EASYNEWS_NZB_PREFIX } from '@/services/easynews';
import { encryptReleaseId, hasTokenSecret } from '@/services/newznab/opaqueId';
import { grabUrl } from '@/services/newznab/search';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { resolveWantedReused, type WantedForZurg } from '@/services/wanted';
import type { NextApiRequest, NextApiResponse } from 'next';

/** TMDB lookups in flight at once; each is a metadata-cache read almost every time. */
const RESOLVE_AT_ONCE = 25;

const BANDS = ['720p', '1080p', '2160p'];

/**
 * `?bands=1080p,2160p`: the resolutions a zurg keeps a copy of each film at. Null when
 * it did not ask, undefined when what it asked for is not a list of `BANDS`.
 */
function bandsAsked(value: unknown): string[] | null | undefined {
	if (value === undefined) return null;
	if (typeof value !== 'string') return undefined;
	const bands = [...new Set(value.split(','))];
	return bands.every((b) => BANDS.includes(b)) ? bands : undefined;
}

/** What zurg holds of a film at each band it asked about, and which it wants bettered. */
function bandsOf(row: WantedItemRow, bands: string[]): WantedForZurg['bands'] {
	const held = row.kind === 'movie' ? row.fulfilled?.bands : undefined;
	const out: NonNullable<WantedForZurg['bands']> = {};
	for (const band of bands) {
		const took = held?.[band];
		if (took) {
			out[band] = {
				grab: took.grab,
				resolution: took.resolution,
				...(took.upgradeTo && { to: took.upgradeTo }),
			};
		}
	}
	return Object.keys(out).length ? out : undefined;
}

/** A film is done for a zurg asking about bands once each holds a copy it wants no better than. */
function bandsDone(row: WantedItemRow, bands: string[]): boolean {
	const held = bandsOf(row, bands);
	return bands.every((band) => held?.[band] && !held[band].to);
}

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

/** A row's pins, each with its stored NZB's grab URL carrying this sponsor's key. */
function pinsOf(row: WantedItemRow, apiKey: string): WantedForZurg['pins'] {
	if (!row.pins?.length || !hasTokenSecret()) return undefined;
	return row.pins.map((pin) => ({
		id: pin.id,
		release: pin.release,
		nzb: grabUrl(encryptReleaseId(EASYNEWS_NZB_PREFIX, pin.id), apiKey),
		size: pin.size,
		...(pin.season !== undefined && { season: pin.season, episode: pin.episode }),
	}));
}

/**
 * A sponsor's wanted list, for their zurg to fetch: `{"items": [{id, kind, title,
 * imdb, year?, tmdb?, tvdb?, titles?, released?, seasons?: [{season, episodes,
 * airing?, aired?}], upgrade?}]}`. Films zurg
 * already acknowledged are left out unless it wants a better release; shows stay,
 * so new episodes are fetched as they air. With `?bands=` a film is left out only once
 * every band holds a copy zurg wants no better than, and carries `bands` instead of
 * `upgrade`. A film with `pins` is done once acknowledged, bands or not. See
 * docs/sponsor-api.md.
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
	const bands = bandsAsked(req.query.bands);
	if (bands === undefined) {
		return res
			.status(400)
			.json({ error: '"bands" must list "720p", "1080p" or "2160p", separated by commas' });
	}

	const apiKey = req.headers['x-api-key'] as string;
	try {
		const rows = (await db.listWanted(sponsor.shortId)).filter(
			(row) =>
				row.kind === 'show' ||
				!row.fulfilledAt ||
				(!row.pins && (bands ? !bandsDone(row, bands) : upgradeOf(row)))
		);
		const items: WantedForZurg[] = [];
		for (let i = 0; i < rows.length; i += RESOLVE_AT_ONCE) {
			items.push(
				...(await Promise.all(
					rows.slice(i, i + RESOLVE_AT_ONCE).map(async (row) => {
						const pins = pinsOf(row, apiKey);
						const resolved = {
							...(await resolveWantedReused(row)),
							...(pins && { pins }),
						};
						if (bands) {
							const held = bandsOf(row, bands);
							return { ...resolved, ...(held && { bands: held }) };
						}
						const upgrade = upgradeOf(row);
						return { ...resolved, ...(upgrade && { upgrade }) };
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
