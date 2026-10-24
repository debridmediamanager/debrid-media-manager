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
	const base: WantedForZurg = { id: row.id, kind: row.kind, title: row.title, imdb: row.imdbId };
	const cache = getMetadataCache();
	let found: any = null;
	try {
		found = await cache.searchTmdbByImdb(row.imdbId);
	} catch {
		// TMDB unreachable: the IMDb id alone, and seasons left out rather than empty
	}
	const year = (date: unknown) => {
		const y = typeof date === 'string' ? Number.parseInt(date.slice(0, 4), 10) : NaN;
		return Number.isInteger(y) && y > 1800 ? { year: y } : {};
	};
	if (row.kind === 'movie') {
		const movie = found?.movie_results?.[0];
		return typeof movie?.id === 'number'
			? { ...base, ...year(movie.release_date), tmdb: movie.id }
			: base;
	}
	const tmdb = found?.tv_results?.[0]?.id;
	if (typeof tmdb !== 'number') return base;
	let show: any = null;
	try {
		show = await cache.getTmdbTvInfo(tmdb, TMDB_TV_APPEND);
	} catch {
		return { ...base, tmdb };
	}
	const tvdb = show?.external_ids?.tvdb_id;
	return {
		...base,
		...year(show?.first_air_date ?? found.tv_results[0].first_air_date),
		tmdb,
		...(typeof tvdb === 'number' ? { tvdb } : {}),
		seasons: airedSeasons(show, row.seasons),
	};
}
