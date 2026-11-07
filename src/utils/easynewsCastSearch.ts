import {
	EasynewsGoneError,
	resolveEasynewsLink,
	searchEasynews,
	type EasynewsCredentials,
	type EasynewsResult,
	type EasynewsTarget,
} from '@/services/easynews';
import { fetchMovieSources, fetchShowSources } from '@/services/metadata';
import { withoutBlockedReleases } from '@/services/takedown/blocklist';
import { mergeMovieRecord, mergeShowRecord } from '@/utils/metadataRecord';
import ptt from 'parse-torrent-title';

/**
 * What a cast key searches Easynews for: the title and year of a film, or the
 * show's title, season and origin countries plus the episode wanted. The same
 * search the DMM page runs for its Easynews rows. Null for a key with no IMDb id
 * (anime), or when no metadata source knows the title.
 */
export async function easynewsTargetFor(
	castKey: string
): Promise<{ target: EasynewsTarget; episode?: number } | null> {
	const match = /^(tt\d{7,})(?::(\d+):(\d+))?$/.exec(castKey);
	if (!match) return null;
	const [, imdbId, season, episode] = match;
	// OMDb is asked only when nothing else answers, as the info routes do.
	const known = { omdb: Promise.resolve(null) };
	if (season === undefined) {
		const record = mergeMovieRecord(imdbId, await fetchMovieSources(imdbId, known));
		if (!record.sources.length || !record.title) return null;
		return {
			target: { title: record.title, year: record.year ? String(record.year) : undefined },
		};
	}
	const sources = await fetchShowSources(imdbId, known);
	const record = mergeShowRecord(imdbId, sources);
	if (!record.sources.length || !record.title) return null;
	const countries = sources.tmdb?.origin_country;
	return {
		target: {
			title: record.title,
			seasonNum: Number(season),
			countries: Array.isArray(countries) ? countries : undefined,
		},
		episode: Number(episode),
	};
}

/** Whether a result's name is this episode; a multi-episode file counts for each it holds. */
export function namesEpisode(name: string, season: number, episode: number): boolean {
	const info = ptt.parse(name);
	if (info.season !== season) return false;
	const episodes = info.episodes ?? (info.episode != null ? [info.episode] : []);
	return episodes.includes(episode);
}

/**
 * Easynews results for a cast key, largest first, searched with the viewer's
 * own login. `maxSizeGb` is the member's size limit, 0 or absent for none.
 */
export async function easynewsStreamResults(
	credentials: EasynewsCredentials,
	castKey: string,
	maxSizeGb?: number
): Promise<EasynewsResult[]> {
	const wanted = await easynewsTargetFor(castKey);
	if (!wanted) return [];
	const { target, episode } = wanted;
	let results = await searchEasynews(credentials, target);
	if (episode !== undefined && target.seasonNum !== undefined) {
		results = results.filter((r) => namesEpisode(r.title, target.seasonNum!, episode));
	}
	if (maxSizeGb && maxSizeGb > 0) {
		results = results.filter((r) => r.size <= maxSizeGb * 1024 ** 3);
	}
	return withoutBlockedReleases(results);
}

/**
 * The release an Easynews file belongs to, for Stremio's next-episode match
 * (see releaseBingeGroup). Easynews lists every episode as its own file with its
 * own hash, so the release is the name (no extension) with the episode taken out:
 * `Show.S01E02.1080p.WEB.h264-GRP` and `Show.S01E03.1080p.WEB.h264-GRP` share one.
 */
export function easynewsReleaseOf(name: string): string {
	return name.toLowerCase().replace(/\bs(\d{1,2})e\d{1,3}(?:-?e\d{1,3})*/, 's$1');
}

/**
 * The paths Easynews says it can no longer serve. It lists such files in search
 * (Severance S02E01 NEUROSiS answered 410 four times in a row, 2026-11-07), so
 * each one offered is asked for once, in parallel, as play would. Anything but
 * "gone" keeps the file: a slow or failed check is not a dead file.
 */
export async function goneEasynewsPaths(
	credentials: EasynewsCredentials,
	paths: string[]
): Promise<Set<string>> {
	const gone = new Set<string>();
	await Promise.all(
		paths.map((path) =>
			resolveEasynewsLink(credentials, path).catch((error) => {
				if (error instanceof EasynewsGoneError) gone.add(path);
			})
		)
	);
	return gone;
}
