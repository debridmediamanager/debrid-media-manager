/**
 * One canonical record for an IMDb id, merged from every provider DMM asks.
 *
 * The providers are not interchangeable, and the differences are systematic:
 *
 * - Year. OMDb and Cinemeta give the year a film reached US cinemas; TMDB,
 *   Trakt and mdblist give its original release. Spirited Away (tt0245429) is
 *   2003 on the first two and 2001 on the rest, Amélie 2002 against 2001,
 *   Anatomy of a Fall 2024 against 2023. Release names, Plex and Jellyfin all
 *   use the original year, so the original-release sources vote first and the
 *   US-release ones only answer when none of them can.
 * - Title. IMDb, and so OMDb and Cinemeta, can retitle after the fact: Dune
 *   (tt1160419) is "Dune: Part One" there and "Dune" on TMDB, Trakt, mdblist
 *   and in its release names. TMDB's title leads; the rest become aliases, so a
 *   release name using any of them still resolves.
 * - Seasons. See `@/utils/showMetadataMerge`.
 */

import {
	mergeShowViews,
	type ShowEpisode,
	viewFromCinemeta,
	viewFromMdblist,
	viewFromOmdb,
	viewFromTmdb,
	viewFromTrakt,
	viewFromTvmaze,
} from './showMetadataMerge';

export type MetadataSource = 'tmdb' | 'trakt' | 'mdblist' | 'cinemeta' | 'omdb' | 'tvmaze';

export type MetadataIds = {
	imdb: string;
	tmdb?: number;
	tvdb?: number;
	trakt?: number;
	tvmaze?: number;
};

export type MetadataRatings = {
	/** 0-10 */
	imdb?: number;
	/** 0-100 */
	tmdb?: number;
	/** 0-100 */
	trakt?: number;
	/** Rotten Tomatoes critics, 0-100 */
	rottenTomatoes?: number;
	/** 0-100 */
	metacritic?: number;
	/** 0-5 */
	letterboxd?: number;
};

type BaseRecord = {
	imdbId: string;
	title: string;
	originalTitle?: string;
	/** Original release year (first air year for a show). */
	year: number | null;
	/** Every other title a provider knows it by, for matching release names. */
	aliases: string[];
	ids: MetadataIds;
	overview?: string;
	genres: string[];
	runtime?: number;
	ratings: MetadataRatings;
	poster?: string;
	backdrop?: string;
	trailer?: string;
	/** Which providers answered. */
	sources: MetadataSource[];
};

export type MovieRecord = BaseRecord & {
	type: 'movie';
	/** Original release date, YYYY-MM-DD. */
	released?: string;
};

export type ShowRecord = BaseRecord & {
	type: 'show';
	seasonCount: number;
	seasons: Array<{ number: number; episodes: number }>;
	hasSpecials: boolean;
	status?: string;
	nextEpisode?: ShowEpisode;
	lastEpisode?: ShowEpisode;
};

export type EpisodeRecord = {
	imdbId: string;
	type: 'episode';
	title: string;
	seriesImdbId: string;
	season?: number;
	episode?: number;
	sources: MetadataSource[];
};

export type MetadataRecord = MovieRecord | ShowRecord | EpisodeRecord;

// ---------------------------------------------------------------- helpers

const str = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed && trimmed !== 'N/A' ? trimmed : undefined;
};

const posInt = (value: unknown): number | undefined => {
	const n = typeof value === 'string' ? Number(value) : value;
	return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
};

const num = (value: unknown): number | undefined => {
	const n = typeof value === 'string' ? parseFloat(value) : value;
	return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** The leading four-digit year of a date, a year, or a "2010–" range. */
export const yearOf = (value: unknown): number | undefined => {
	if (typeof value === 'number') return value >= 1870 && value <= 2200 ? value : undefined;
	const match = typeof value === 'string' ? /^\s*(\d{4})/.exec(value) : null;
	return match ? yearOf(Number(match[1])) : undefined;
};

const first = <T>(...values: Array<T | undefined | null>): T | undefined =>
	values.find((value): value is T => value !== undefined && value !== null);

/**
 * The year most of `primary` agree on; a tie goes to the earliest listed. Only
 * when no primary source has a year does `fallback` answer, in order.
 */
export function voteYear(primary: Array<number | undefined>, fallback: Array<number | undefined>) {
	const counts = new Map<number, number>();
	for (const year of primary) if (year) counts.set(year, (counts.get(year) ?? 0) + 1);
	let best: number | undefined;
	for (const year of primary) {
		if (!year) continue;
		if (best === undefined || counts.get(year)! > counts.get(best)!) best = year;
	}
	return best ?? first(...fallback) ?? null;
}

const normalizeForDedupe = (title: string) =>
	title.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function collectAliases(primary: string, candidates: Array<string | undefined>): string[] {
	const seen = new Set([normalizeForDedupe(primary)]);
	const aliases: string[] = [];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const key = normalizeForDedupe(candidate);
		if (seen.has(key)) continue;
		seen.add(key);
		aliases.push(candidate);
		if (aliases.length >= 60) break;
	}
	return aliases;
}

const mdblistRating = (data: any, source: string, field: 'value' | 'score' = 'value') => {
	const rating = Array.isArray(data?.ratings)
		? data.ratings.find((r: any) => r?.source === source)
		: undefined;
	return num(rating?.[field]) || undefined;
};

const omdbRating = (data: any, source: string): number | undefined => {
	const rating = Array.isArray(data?.Ratings)
		? data.Ratings.find((r: any) => r?.Source === source)
		: undefined;
	return num(rating?.Value);
};

function mergeRatings(s: {
	mdblist?: any;
	omdb?: any;
	cinemeta?: any;
	tmdb?: any;
	trakt?: any;
}): MetadataRatings {
	const ratings: MetadataRatings = {
		imdb: first(
			mdblistRating(s.mdblist, 'imdb'),
			num(str(s.omdb?.imdbRating)),
			num(str(s.cinemeta?.meta?.imdbRating))
		),
		tmdb: first(
			mdblistRating(s.mdblist, 'tmdb'),
			num(s.tmdb?.vote_average) ? Math.round(num(s.tmdb.vote_average)! * 10) : undefined
		),
		trakt: first(
			mdblistRating(s.mdblist, 'trakt'),
			num(s.trakt?.rating) ? Math.round(num(s.trakt.rating)! * 10) : undefined
		),
		rottenTomatoes: first(
			mdblistRating(s.mdblist, 'tomatoes'),
			omdbRating(s.omdb, 'Rotten Tomatoes')
		),
		metacritic: first(mdblistRating(s.mdblist, 'metacritic'), omdbRating(s.omdb, 'Metacritic')),
		letterboxd: mdblistRating(s.mdblist, 'letterboxd'),
	};
	for (const key of Object.keys(ratings) as Array<keyof MetadataRatings>) {
		if (ratings[key] === undefined) delete ratings[key];
	}
	return ratings;
}

const tmdbImage = (path: unknown, size: string) =>
	typeof path === 'string' && path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

const youtube = (key: unknown) =>
	typeof key === 'string' && key ? `https://youtube.com/watch?v=${key}` : undefined;

const tmdbTrailer = (tmdb: any) =>
	youtube(
		Array.isArray(tmdb?.videos?.results)
			? tmdb.videos.results.find((v: any) => v?.type === 'Trailer' && v?.site === 'YouTube')
					?.key
			: undefined
	);

const tmdbAlternativeTitles = (tmdb: any): string[] => {
	const list = tmdb?.alternative_titles?.titles ?? tmdb?.alternative_titles?.results ?? [];
	return Array.isArray(list)
		? list.map((t: any) => str(t?.title)).filter((t): t is string => !!t)
		: [];
};

const genresOf = (tmdb: any, trakt: any, cinemeta: any): string[] => {
	const fromTmdb = Array.isArray(tmdb?.genres) ? tmdb.genres.map((g: any) => str(g?.name)) : [];
	const fromCinemeta = Array.isArray(cinemeta?.meta?.genres) ? cinemeta.meta.genres : [];
	const fromTrakt = Array.isArray(trakt?.genres) ? trakt.genres : [];
	const list = (
		fromTmdb.length ? fromTmdb : fromCinemeta.length ? fromCinemeta : fromTrakt
	) as unknown[];
	return list.map(str).filter((g): g is string => !!g);
};

const answered = (sources: Record<MetadataSource, unknown>): MetadataSource[] =>
	(Object.keys(sources) as MetadataSource[]).filter((key) => !!sources[key]);

// ---------------------------------------------------------------- movies

export type MovieSources = {
	tmdb?: any;
	trakt?: any;
	mdblist?: any;
	cinemeta?: any;
	omdb?: any;
};

export function mergeMovieRecord(imdbId: string, s: MovieSources): MovieRecord {
	const cinemeta = s.cinemeta?.meta;
	const title =
		first(
			str(s.tmdb?.title),
			str(s.trakt?.title),
			str(s.mdblist?.title),
			str(cinemeta?.name),
			str(s.omdb?.Title)
		) ?? 'Unknown';
	const originalTitle = first(str(s.tmdb?.original_title), str(s.trakt?.original_title));

	const released = first(
		str(s.tmdb?.release_date),
		str(s.trakt?.released),
		str(s.mdblist?.released)
	);

	return {
		imdbId,
		type: 'movie',
		title,
		originalTitle: originalTitle && originalTitle !== title ? originalTitle : undefined,
		year: voteYear(
			[yearOf(s.tmdb?.release_date), yearOf(s.trakt?.year), yearOf(s.mdblist?.year)],
			[yearOf(cinemeta?.releaseInfo ?? cinemeta?.year), yearOf(s.omdb?.Year)]
		),
		aliases: collectAliases(title, [
			originalTitle,
			str(s.trakt?.title),
			str(s.mdblist?.title),
			str(cinemeta?.name),
			str(s.omdb?.Title),
			...tmdbAlternativeTitles(s.tmdb),
		]),
		ids: movieIds(imdbId, s),
		overview: first(
			str(s.tmdb?.overview),
			str(s.mdblist?.description),
			str(s.trakt?.overview),
			str(cinemeta?.description),
			str(s.omdb?.Plot)
		),
		genres: genresOf(s.tmdb, s.trakt, s.cinemeta),
		runtime: first(
			posInt(s.tmdb?.runtime),
			posInt(s.mdblist?.runtime),
			posInt(s.trakt?.runtime)
		),
		ratings: mergeRatings(s),
		poster: first(
			str(s.mdblist?.poster),
			tmdbImage(s.tmdb?.poster_path, 'w500'),
			str(cinemeta?.poster),
			str(s.omdb?.Poster)
		),
		backdrop: first(
			str(s.mdblist?.backdrop),
			tmdbImage(s.tmdb?.backdrop_path, 'w1280'),
			str(cinemeta?.background)
		),
		trailer: first(
			str(s.mdblist?.trailer),
			youtube(cinemeta?.trailers?.[0]?.source),
			tmdbTrailer(s.tmdb),
			str(s.trakt?.trailer)
		),
		released: released ? released.slice(0, 10) : undefined,
		sources: answered({
			tmdb: s.tmdb,
			trakt: s.trakt,
			mdblist: s.mdblist,
			cinemeta,
			omdb: s.omdb,
			tvmaze: undefined,
		}),
	};
}

function movieIds(imdbId: string, s: MovieSources): MetadataIds {
	const ids: MetadataIds = { imdb: imdbId };
	const tmdb = first(posInt(s.tmdb?.id), posInt(s.trakt?.ids?.tmdb), posInt(s.mdblist?.tmdbid));
	const trakt = first(posInt(s.trakt?.ids?.trakt), posInt(s.mdblist?.traktid));
	const tvdb = first(
		posInt(s.trakt?.ids?.tvdb),
		posInt(s.tmdb?.external_ids?.tvdb_id),
		posInt(s.mdblist?.tvdbid)
	);
	if (tmdb) ids.tmdb = tmdb;
	if (trakt) ids.trakt = trakt;
	if (tvdb) ids.tvdb = tvdb;
	return ids;
}

// ---------------------------------------------------------------- shows

export type ShowSources = MovieSources & {
	traktSeasons?: any;
	traktNext?: any;
	traktLast?: any;
	tvmaze?: any;
};

export function mergeShowRecord(imdbId: string, s: ShowSources): ShowRecord {
	const cinemeta = s.cinemeta?.meta;
	const merged = mergeShowViews([
		viewFromTmdb(s.tmdb),
		viewFromTvmaze(s.tvmaze),
		viewFromTrakt(s.traktSeasons, s.traktNext, s.traktLast),
		viewFromMdblist(s.mdblist),
		viewFromCinemeta(s.cinemeta),
		viewFromOmdb(s.omdb),
	]);

	const title =
		first(
			str(s.tmdb?.name),
			str(s.trakt?.title),
			str(s.mdblist?.title),
			str(s.tvmaze?.name),
			str(cinemeta?.name),
			str(s.omdb?.Title)
		) ?? 'Unknown';
	const originalTitle = str(s.tmdb?.original_name);

	const ids: MetadataIds = { imdb: imdbId };
	const tmdb = first(posInt(s.tmdb?.id), posInt(s.trakt?.ids?.tmdb), posInt(s.mdblist?.tmdbid));
	const trakt = first(posInt(s.trakt?.ids?.trakt), posInt(s.mdblist?.traktid));
	const tvdb = first(
		posInt(s.trakt?.ids?.tvdb),
		posInt(s.tmdb?.external_ids?.tvdb_id),
		posInt(s.tvmaze?.externals?.thetvdb),
		posInt(s.mdblist?.tvdbid)
	);
	// TVmaze answers some ids with a related show, so its id only stands when
	// its own externals point back at this IMDb id.
	const tvmaze = s.tvmaze?.externals?.imdb === imdbId ? posInt(s.tvmaze?.id) : undefined;
	if (tmdb) ids.tmdb = tmdb;
	if (trakt) ids.trakt = trakt;
	if (tvdb) ids.tvdb = tvdb;
	if (tvmaze) ids.tvmaze = tvmaze;

	const seasons = Object.entries(merged.season_episode_counts)
		.map(([number, episodes]) => ({ number: Number(number), episodes }))
		.filter((season) => season.number > 0)
		.sort((a, b) => a.number - b.number);

	return {
		imdbId,
		type: 'show',
		title,
		originalTitle: originalTitle && originalTitle !== title ? originalTitle : undefined,
		year: voteYear(
			[
				yearOf(s.tmdb?.first_air_date),
				yearOf(s.trakt?.year),
				yearOf(s.mdblist?.year),
				yearOf(s.tvmaze?.premiered),
			],
			[yearOf(cinemeta?.releaseInfo ?? cinemeta?.year), yearOf(s.omdb?.Year)]
		),
		aliases: collectAliases(title, [
			originalTitle,
			str(s.trakt?.title),
			str(s.mdblist?.title),
			str(s.tvmaze?.name),
			str(cinemeta?.name),
			str(s.omdb?.Title),
			...tmdbAlternativeTitles(s.tmdb),
		]),
		ids,
		overview: first(
			str(s.tmdb?.overview),
			str(s.mdblist?.description),
			str(s.trakt?.overview),
			str(cinemeta?.description),
			str(s.omdb?.Plot)
		),
		genres: genresOf(s.tmdb, s.trakt, s.cinemeta),
		runtime: first(
			posInt(s.tmdb?.episode_run_time?.[0]),
			posInt(s.trakt?.runtime),
			posInt(s.mdblist?.runtime)
		),
		ratings: mergeRatings(s),
		poster: first(
			str(s.mdblist?.poster),
			str(cinemeta?.poster),
			tmdbImage(s.tmdb?.poster_path, 'w500'),
			str(s.omdb?.Poster)
		),
		backdrop: first(
			str(s.mdblist?.backdrop),
			str(cinemeta?.background),
			tmdbImage(s.tmdb?.backdrop_path, 'w1280')
		),
		trailer: first(
			str(s.mdblist?.trailer),
			youtube(cinemeta?.trailers?.[0]?.source),
			tmdbTrailer(s.tmdb)
		),
		seasonCount: merged.season_count,
		seasons,
		hasSpecials: merged.has_specials,
		status: merged.status,
		nextEpisode: merged.next_episode_to_air,
		lastEpisode: merged.last_episode_to_air,
		sources: answered({
			tmdb: s.tmdb,
			trakt: s.trakt ?? s.traktSeasons,
			mdblist: s.mdblist,
			cinemeta,
			omdb: s.omdb,
			tvmaze: s.tvmaze,
		}),
	};
}

// ---------------------------------------------------------------- episodes

/** An episode's record when OMDb says the id is an episode's, or null. */
export function episodeRecordFromOmdb(imdbId: string, omdb: any): EpisodeRecord | null {
	if (omdb?.Type !== 'episode') return null;
	const seriesImdbId = str(omdb.seriesID);
	if (!seriesImdbId || !/^tt\d+$/.test(seriesImdbId) || seriesImdbId === imdbId) return null;
	return {
		imdbId,
		type: 'episode',
		title: str(omdb.Title) ?? 'Unknown',
		seriesImdbId,
		season: posInt(omdb.Season),
		episode: posInt(omdb.Episode),
		sources: ['omdb'],
	};
}
