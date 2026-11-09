import { identificationItem, identifyItems } from '@/pages/api/library/identify';
import { sponsorOfDmmApiKeyHeader } from '@/pages/api/zurg/auth';
import { PlacementMissService } from '@/services/database/placementMisses';
import {
	cachedSources,
	PLACEMENT_RULES,
	placeReleases,
	titled,
	type Identify,
	type PlaceRequest,
} from '@/services/placement';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import type { NextApiRequest, NextApiResponse } from 'next';

export const MAX_RELEASES = 100;
export const MAX_FILES = 2000;
/** Releases still waiting past this are answered `skipped`, for zurg to ask again. */
const BUDGET_MS = 25_000;
const IMDB_ID = /^tt\d{7,}$/;
const misses = new PlacementMissService();

function parseReleases(body: unknown): PlaceRequest[] | null {
	const { releases, parts } = (body ?? {}) as { releases?: unknown; parts?: unknown };
	if (!Array.isArray(releases) || releases.length === 0 || releases.length > MAX_RELEASES) {
		return null;
	}
	if (parts != null && typeof parts !== 'boolean') return null;
	let files = 0;
	const out: PlaceRequest[] = [];
	for (const raw of releases) {
		const { name, hash, imdbId, files: list } = (raw ?? {}) as Record<string, unknown>;
		if (typeof name !== 'string' || !name.trim() || name.length > 1024) return null;
		if (hash != null && typeof hash !== 'string') return null;
		if (imdbId != null && typeof imdbId !== 'string') return null;
		if (!Array.isArray(list)) return null;
		files += list.length;
		if (files > MAX_FILES) return null;
		const parsed: PlaceRequest['files'] = [];
		for (const file of list) {
			const { path, folder } = (file ?? {}) as Record<string, unknown>;
			if (typeof path !== 'string' || !path || path.length > 1024) return null;
			if (folder != null && (typeof folder !== 'string' || folder.length > 1024)) return null;
			parsed.push({ path, folder: typeof folder === 'string' ? folder : null });
		}
		out.push({
			name: name.trim(),
			hash:
				typeof hash === 'string' && /^[a-f0-9]{40}$/i.test(hash)
					? hash.toLowerCase()
					: null,
			// zurg sends "" when it knows nothing
			imdbId: typeof imdbId === 'string' && IMDB_ID.test(imdbId) ? imdbId : null,
			files: parsed,
			// a caller that reads `part`: an older one files a second part as a copy of the episode
			...(parts ? { parts: true as const } : {}),
		});
	}
	return out;
}

/**
 * What each release of a sponsor's library is, and its files' TMDB season and episode:
 * `{"releases": [{name, hash?, imdbId?, files: [{path, folder}]}], "parts"?: true}` answers
 * `{"releases": [{kind, imdbId, tmdbId, series?, files: [{path, season, episode, episodeEnd, how, part?, series?}]}],
 * "complete", "rules"}` in request order; every file carries `part` when `parts` was sent, and a
 * One Pace release `series` (a show DMM numbers itself). See docs/sponsor-api.md.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const sponsor = await sponsorOfDmmApiKeyHeader(req, res);
	if (!sponsor) return;
	if (
		!(await checkRateLimitFor(
			`sponsor:${sponsor.shortId}`,
			RATE_LIMIT_CONFIGS.sponsorPlace,
			res
		))
	) {
		return res.status(429).json({ error: 'Rate limit exceeded' });
	}
	const releases = parseReleases(req.body);
	if (!releases) {
		return res.status(400).json({
			error: `Expected {"releases": [{"name": string, "hash"?: string, "imdbId"?: string, "files": [{"path": string, "folder"?: string}]}], "parts"?: boolean} with 1-${MAX_RELEASES} releases and at most ${MAX_FILES} files`,
		});
	}

	try {
		const deadline = Date.now() + BUDGET_MS;
		const identify: Identify = async (unknown) => {
			const { results, complete } = await identifyItems(
				unknown.map((release) => identificationItem(release.name, release.hash))
			);
			// a name content-identifier could not be asked about is answered `skipped`
			return results.map((result) => result ?? (complete ? null : undefined));
		};
		const placed = await placeReleases(releases, identify, cachedSources, deadline);
		const parts = releases[0].parts;
		const named = await Promise.all(
			placed.releases.map(async (r) => {
				const release = await titled(r, cachedSources);
				return parts
					? {
							...release,
							files: release.files.map((f) => ({ ...f, part: f.part ?? null })),
						}
					: release;
			})
		);
		// kept to improve the rules; never fails the answer
		await misses
			.record(releases, placed.releases, PLACEMENT_RULES)
			.catch((error) => console.error('Failed to record placement misses', error));
		return res.status(200).json({ ...placed, releases: named, rules: PLACEMENT_RULES });
	} catch (error) {
		console.error('Failed to place sponsor releases', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}
