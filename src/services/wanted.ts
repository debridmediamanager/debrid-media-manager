import type { WantedItemRow } from '@/services/database/wantedItems';
import { TMDB_TV_APPEND } from '@/services/metadata';
import { getMetadataCache } from '@/services/metadataCache';
import { firstUnairedEpisode } from '@/utils/tvEpisodes';

/** One season of a wanted show as zurg reads it: the episodes aired so far. */
export interface WantedSeason {
	season: number;
	episodes: number[];
	/** Episodes of this season are still to air, so no pack covers it yet. */
	airing?: boolean;
}

/** A wanted title as `/api/sponsor/wanted` answers it. See docs/sponsor-api.md. */
export interface WantedForZurg {
	id: string;
	kind: 'movie' | 'show';
	title: string;
	imdb: string;
	/** The release or first-air year, which tells same-named titles apart. */
	year?: number;
	tmdb?: number;
	tvdb?: number;
	/** Shows only. Empty while TMDB knows nothing aired, which zurg reads as nothing to do yet. */
	seasons?: WantedSeason[];
}

/**
 * The aired episodes of each regular season of a TMDB show, numbered as TMDB
 * numbers them. Specials (season 0) are left out, as zurg's acquisition does.
 * `only` keeps just those season numbers.
 */
export function airedSeasons(show: any, only: number[] | null): WantedSeason[] {
	const out: WantedSeason[] = [];
	for (const s of Array.isArray(show?.seasons) ? show.seasons : []) {
		const season = s?.season_number;
		const count = s?.episode_count;
		if (!Number.isInteger(season) || season < 1 || !Number.isInteger(count) || count < 1)
			continue;
		if (only && !only.includes(season)) continue;
		const unaired = firstUnairedEpisode(
			season,
			show.next_episode_to_air,
			show.last_episode_to_air
		);
		const last = unaired === null ? count : Math.min(count, unaired - 1);
		if (last < 1) continue;
		out.push({
			season,
			episodes: Array.from({ length: last }, (_, i) => i + 1),
			...(last < count ? { airing: true } : {}),
		});
	}
	return out;
}

/**
 * What zurg needs to fetch a wanted title: its ids, and for a show the episodes
 * aired so far in the seasons wanted. Read from TMDB through DMM's metadata cache,
 * so zurg asks one endpoint and an airing show's new episodes appear within the
 * cache's few hours. A title TMDB does not know still goes out with its IMDb id,
 * which zurg's indexer searches take on their own.
 */
export async function resolveWanted(row: WantedItemRow): Promise<WantedForZurg> {
	return (await lookUp(row)).resolved;
}

/** `settled` is false when TMDB could not be asked, so the answer is not worth keeping. */
async function lookUp(row: WantedItemRow): Promise<{ resolved: WantedForZurg; settled: boolean }> {
	const base: WantedForZurg = { id: row.id, kind: row.kind, title: row.title, imdb: row.imdbId };
	const cache = getMetadataCache();
	let found: any = null;
	try {
		found = await cache.searchTmdbByImdb(row.imdbId);
	} catch {
		// TMDB unreachable: the IMDb id alone, and seasons left out rather than empty
		return { resolved: base, settled: false };
	}
	const year = (date: unknown) => {
		const y = typeof date === 'string' ? Number.parseInt(date.slice(0, 4), 10) : NaN;
		return Number.isInteger(y) && y > 1800 ? { year: y } : {};
	};
	if (row.kind === 'movie') {
		const movie = found?.movie_results?.[0];
		return {
			resolved:
				typeof movie?.id === 'number'
					? { ...base, ...year(movie.release_date), tmdb: movie.id }
					: base,
			settled: true,
		};
	}
	const tmdb = found?.tv_results?.[0]?.id;
	if (typeof tmdb !== 'number') return { resolved: base, settled: true };
	let show: any = null;
	try {
		show = await cache.getTmdbTvInfo(tmdb, TMDB_TV_APPEND);
	} catch {
		return { resolved: { ...base, tmdb }, settled: false };
	}
	const tvdb = show?.external_ids?.tvdb_id;
	return {
		resolved: {
			...base,
			...year(show?.first_air_date ?? found.tv_results[0].first_air_date),
			tmdb,
			...(typeof tvdb === 'number' ? { tvdb } : {}),
			seasons: airedSeasons(show, row.seasons),
		},
		settled: true,
	};
}

/**
 * How long a title's resolution is reused. zurg reads the whole list every
 * minute, and a list imported from Radarr holds over a thousand titles, each a
 * metadata-cache read: 28 to 53 s a poll against zurg's 60 s timeout
 * (2026-10-25). Half an hour is well inside the hours an airing show's new
 * episodes take to reach the metadata cache anyway.
 */
const RESOLVED_FOR_MS = 30 * 60_000;
const resolvedTitles = new Map<string, { until: number; resolved: Omit<WantedForZurg, 'id'> }>();

/** `resolveWanted`, reused for RESOLVED_FOR_MS across polls and sponsors. */
export async function resolveWantedReused(
	row: WantedItemRow,
	now = Date.now()
): Promise<WantedForZurg> {
	const key = `${row.kind}:${row.imdbId}:${row.seasons?.join(',') ?? '*'}:${row.title}`;
	const hit = resolvedTitles.get(key);
	if (hit && hit.until > now) return { id: row.id, ...hit.resolved };
	const { resolved, settled } = await lookUp(row);
	if (settled) {
		// ponytail: drops everything at the bound instead of evicting the oldest; fine while lists stay this size
		if (resolvedTitles.size >= 50_000) resolvedTitles.clear();
		const { id: _id, ...rest } = resolved;
		resolvedTitles.set(key, { until: now + RESOLVED_FOR_MS, resolved: rest });
	}
	return resolved;
}

/**
 * The seasons of wanted shows TMDB has no aired episodes in, which is how this
 * list numbers them. Sonarr numbers by TheTVDB, which splits long anime into
 * more seasons: of fun's Sonarr import on 2026-10-25, 52 of 155 seasons in 15
 * shows (Detective Conan 5-34, Bleach 3-16). Shows TMDB could not be asked about
 * are left out rather than counted.
 */
export async function seasonsTmdbLacks(
	shows: { imdbId: string; title: string; seasons: number[] | null }[]
): Promise<{ title: string; seasons: number[] }[]> {
	const out: { title: string; seasons: number[] }[] = [];
	for (let i = 0; i < shows.length; i += 10) {
		const batch = shows.slice(i, i + 10).filter((show) => show.seasons?.length);
		const resolved = await Promise.all(
			batch.map((show) =>
				resolveWantedReused({
					id: '',
					imdbId: show.imdbId,
					kind: 'show',
					title: show.title,
					seasons: show.seasons,
					createdAt: new Date(0),
					fulfilledAt: null,
					lastPolledAt: null,
				})
			)
		);
		batch.forEach((show, j) => {
			const aired = resolved[j].seasons;
			if (!aired) return;
			const lacking = show.seasons!.filter((s) => !aired.some((a) => a.season === s));
			if (lacking.length) out.push({ title: show.title, seasons: lacking });
		});
	}
	return out;
}
