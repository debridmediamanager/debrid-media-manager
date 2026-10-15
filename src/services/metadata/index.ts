import { getMdblistClient } from '@/services/mdblistClient';
import { getMetadataCache } from '@/services/metadataCache';
import { describeProviderError, ProviderCooldownError } from '@/services/providerCooldown';
import {
	episodeRecordFromOmdb,
	mergeMovieRecord,
	mergeShowRecord,
	type MetadataRecord,
	type MovieSources,
	type ShowSources,
} from '@/utils/metadataRecord';
import { getOmdbMetadata } from '@/utils/omdb';
import { getTmdbAuth } from '@/utils/tmdbAuth';
import UserAgent from 'user-agents';

/**
 * What DMM asks TMDB to append. One string per media type, so the page routes
 * and the metadata API read the same cached row.
 */
export const TMDB_MOVIE_APPEND = 'videos,release_dates,external_ids,alternative_titles,credits';
// `credits` and `content_ratings` for the sponsor API's callers: rex shows a title's cast and
// rating from them, and asking once keeps one cached row per title.
export const TMDB_TV_APPEND = 'videos,external_ids,alternative_titles,credits,content_ratings';

/**
 * A provider's answer, or null when it failed — including a synchronous throw.
 * A failed request is one log line; a provider that is cooling down after a
 * 429 is not logged again (its refusal was, once, in `metadataCache`).
 */
export async function settle<T>(call: () => Promise<T> | T): Promise<Awaited<T> | null> {
	try {
		return (await call()) ?? null;
	} catch (error) {
		if (!(error instanceof ProviderCooldownError)) {
			const line = describeProviderError(error);
			if (line) console.warn(`[metadata] provider failed: ${line}`);
			else console.warn('[metadata] provider failed', error);
		}
		return null;
	}
}

// Cinemeta sits behind a CDN that has refused bare API clients before.
const cinemetaConfig = () => ({
	headers: {
		accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'accept-language': 'en-US,en;q=0.5',
		'accept-encoding': 'gzip, deflate, br',
		connection: 'keep-alive',
		'sec-fetch-dest': 'document',
		'sec-fetch-mode': 'navigate',
		'sec-fetch-site': 'same-origin',
		'sec-fetch-user': '?1',
		'upgrade-insecure-requests': '1',
		'user-agent': new UserAgent().toString(),
	},
});

const blank = (value: any) =>
	value && typeof value === 'object' && Object.keys(value).length ? value : null;

/** mdblist answers an unknown id with a body, not an error. */
const mdblistAnswer = (value: any) =>
	value && typeof value === 'object' && value.response !== false && (value.title || value.imdbid)
		? value
		: null;

/**
 * mdblist's TMDB id, when mdblist says it is one of `kind`.
 *
 * TMDB numbers movies and shows separately, and mdblist's `tmdbid` is whichever
 * its `type` says. Movie 155 is The Dark Knight and TV 155 is 3rd Rock from the
 * Sun, and the show route, asked for The Dark Knight, offered that sitcom's six
 * seasons. Trakt is asked per kind (`/movies/`, `/shows/`), so its id needs no
 * such check; an id whose kind mdblist does not state is left to TMDB's own
 * lookup by IMDb id.
 */
function mdblistTmdbId(mdblist: any, kind: 'movie' | 'tv'): unknown {
	return mdblist?.type === (kind === 'movie' ? 'movie' : 'show') ? mdblist.tmdbid : undefined;
}

async function tmdbIdFor(
	imdbId: string,
	known: unknown,
	kind: 'movie' | 'tv'
): Promise<number | null> {
	if (typeof known === 'number' && known > 0) return known;
	if (typeof known === 'string' && /^\d+$/.test(known)) return Number(known);
	const found = await getMetadataCache().searchTmdbByImdb(imdbId);
	const id = (kind === 'movie' ? found?.movie_results : found?.tv_results)?.[0]?.id;
	return typeof id === 'number' ? id : null;
}

/**
 * Every movie provider's answer for an IMDb id, each one cached and each one
 * allowed to fail without failing the rest.
 */
export async function fetchMovieSources(
	imdbId: string,
	known: { omdb?: Promise<any>; tmdbId?: number } = {}
): Promise<MovieSources> {
	const cache = getMetadataCache();
	const mdblistPromise = settle(() => getMdblistClient().getInfoByImdbId(imdbId));
	const cinemetaPromise = settle(() => cache.getCinemetaMovie(imdbId, cinemetaConfig()));
	const omdbPromise = known.omdb ?? settle(() => getOmdbMetadata(imdbId));
	const traktPromise = settle(() => cache.getTraktSummary('movies', imdbId));

	const mdblist = mdblistAnswer(await mdblistPromise);
	const trakt = await traktPromise;
	const tmdb = await settle(async () => {
		if (!getTmdbAuth()) return null;
		const id = await tmdbIdFor(
			imdbId,
			known.tmdbId ?? trakt?.ids?.tmdb ?? mdblistTmdbId(mdblist, 'movie'),
			'movie'
		);
		return id ? cache.getTmdbMovieInfo(id, TMDB_MOVIE_APPEND) : null;
	});

	return {
		mdblist,
		trakt,
		tmdb: blank(tmdb),
		cinemeta: blank(await cinemetaPromise)?.meta ? await cinemetaPromise : null,
		omdb: await omdbPromise,
	};
}

/** Every show provider's answer for an IMDb id; see `fetchMovieSources`. */
export async function fetchShowSources(
	imdbId: string,
	known: { omdb?: Promise<any>; tmdbId?: number } = {}
): Promise<ShowSources> {
	const cache = getMetadataCache();
	const mdblistPromise = settle(() => getMdblistClient().getInfoByImdbId(imdbId));
	const cinemetaPromise = settle(() => cache.getCinemetaSeries(imdbId, cinemetaConfig()));
	const omdbPromise = known.omdb ?? settle(() => getOmdbMetadata(imdbId));
	const traktPromise = settle(() => cache.getTraktSummary('shows', imdbId));
	const traktSeasonsPromise = settle(() => cache.getTraktShowSeasons(imdbId));
	const traktNextPromise = settle(() => cache.getTraktShowEpisode(imdbId, 'next_episode'));
	const traktLastPromise = settle(() => cache.getTraktShowEpisode(imdbId, 'last_episode'));
	const tvmazePromise = settle(() => cache.getTvmazeShow(imdbId));

	const mdblist = mdblistAnswer(await mdblistPromise);
	const trakt = await traktPromise;
	const tmdb = await settle(async () => {
		if (!getTmdbAuth()) return null;
		const id = await tmdbIdFor(
			imdbId,
			known.tmdbId ?? trakt?.ids?.tmdb ?? mdblistTmdbId(mdblist, 'tv'),
			'tv'
		);
		return id ? cache.getTmdbTvInfo(id, TMDB_TV_APPEND) : null;
	});
	const cinemeta = await cinemetaPromise;

	return {
		mdblist,
		trakt,
		tmdb: blank(tmdb),
		cinemeta: blank(cinemeta)?.meta ? cinemeta : null,
		omdb: await omdbPromise,
		traktSeasons: await traktSeasonsPromise,
		traktNext: await traktNextPromise,
		traktLast: await traktLastPromise,
		tvmaze: await tvmazePromise,
	};
}

/**
 * TMDB's movie for an IMDb id the show route has no TMDB show for, so its art
 * can stand in: TMDB files some ids only as a movie (tt4262306, an episode, is
 * movie 1415588). Null whenever the movie might be another title:
 *
 * - TMDB also files the id as a show. It tags The Kingdom II (movie 22140, the
 *   1998 cut) with The Kingdom's id, tt0108906, so a show whose TMDB entry
 *   failed to load would otherwise wear its sequel's art.
 * - The movie's own record names another IMDb id, as a month-old find row can
 *   once TMDB re-tags a movie.
 */
export async function fetchTmdbMovieForShow(imdbId: string): Promise<any | null> {
	if (!getTmdbAuth()) return null;
	return settle(async () => {
		const cache = getMetadataCache();
		const found = await cache.searchTmdbByImdb(imdbId);
		if (found?.tv_results?.length) return null;
		const id = found?.movie_results?.[0]?.id;
		if (typeof id !== 'number') return null;
		const movie = blank(await cache.getTmdbMovieInfo(id, TMDB_MOVIE_APPEND));
		return movie?.imdb_id === imdbId ? movie : null;
	});
}

/**
 * Movie, show or episode, by the providers that know IMDb's own record first.
 * OMDb reads IMDb; mdblist and TMDB's find are the fallbacks.
 */
export async function detectMediaType(
	imdbId: string,
	omdb: any
): Promise<'movie' | 'show' | 'episode' | null> {
	if (omdb?.Type === 'movie') return 'movie';
	if (omdb?.Type === 'series') return 'show';
	if (omdb?.Type === 'episode') return 'episode';

	const mdblist = mdblistAnswer(await settle(() => getMdblistClient().getInfoByImdbId(imdbId)));
	if (mdblist?.type === 'movie') return 'movie';
	if (mdblist?.type === 'show') return 'show';

	const found = getTmdbAuth()
		? await settle(() => getMetadataCache().searchTmdbByImdb(imdbId))
		: null;
	if (found?.movie_results?.length) return 'movie';
	if (found?.tv_results?.length) return 'show';
	if (found?.tv_episode_results?.length) return 'episode';
	return null;
}

/** The canonical record for an IMDb id, or null when no provider knows it. */
export async function getMetadata(imdbId: string): Promise<MetadataRecord | null> {
	const omdbPromise = settle(() => getOmdbMetadata(imdbId));
	const omdb = await omdbPromise;
	const type = await detectMediaType(imdbId, omdb);

	if (type === 'episode') return episodeRecordFromOmdb(imdbId, omdb);
	if (type === 'movie') {
		const sources = await fetchMovieSources(imdbId, { omdb: omdbPromise });
		return Object.values(sources).some(Boolean) ? mergeMovieRecord(imdbId, sources) : null;
	}
	if (type === 'show') {
		const sources = await fetchShowSources(imdbId, { omdb: omdbPromise });
		return Object.values(sources).some(Boolean) ? mergeShowRecord(imdbId, sources) : null;
	}
	return null;
}

/** A title as the sponsor metadata API names it: `imdb:tt0852863`, `tmdb:tv:1877`, `tmdb:movie:603`. */
export type MetadataId =
	| { by: 'imdb'; imdb: string }
	| { by: 'tmdb'; kind: 'movie' | 'tv'; tmdb: number };

export function parseMetadataId(raw: string): MetadataId | null {
	const imdb = /^imdb:(tt\d{7,})$/.exec(raw);
	if (imdb) return { by: 'imdb', imdb: imdb[1] };
	// TMDB numbers movies and shows separately: movie 155 is The Dark Knight, show 155 3rd Rock.
	const tmdb = /^tmdb:(movie|tv):(\d{1,9})$/.exec(raw);
	if (tmdb) return { by: 'tmdb', kind: tmdb[1] as 'movie' | 'tv', tmdb: Number(tmdb[2]) };
	return null;
}

export type MetadataBundle = {
	ids: { imdb?: string; tmdb?: number; tvdb?: number };
	type: 'movie' | 'show' | 'episode';
	/** DMM's merged record (`getMetadata`'s), null for a title no IMDb id names. */
	merged: MetadataRecord | null;
	/** Each provider's own answer, null where it failed or does not know the title. */
	sources: Record<string, unknown>;
};

/**
 * Every source's answer for one title, beside DMM's merge of them. `season` (and
 * `episode`) add TMDB's list of that season (and that episode, with its ids), which
 * no merged record carries: rex places a pack's files by the names in it.
 */
export async function getMetadataBundle(
	id: MetadataId,
	extra: { season?: number; episode?: number; tmdbOnly?: boolean } = {}
): Promise<MetadataBundle | null> {
	const cache = getMetadataCache();
	let imdb = id.by === 'imdb' ? id.imdb : undefined;
	let kind = id.by === 'tmdb' ? id.kind : undefined;
	let tmdbId = id.by === 'tmdb' ? id.tmdb : undefined;
	let tmdb: any = null;
	if (id.by === 'tmdb') {
		tmdb = blank(
			await settle(() =>
				id.kind === 'tv'
					? cache.getTmdbTvInfo(id.tmdb, TMDB_TV_APPEND)
					: cache.getTmdbMovieInfo(id.tmdb, TMDB_MOVIE_APPEND)
			)
		);
		if (!tmdb) return null;
		imdb = tmdb.external_ids?.imdb_id || tmdb.imdb_id || undefined;
	}

	const sources: Record<string, unknown> = {};
	let merged: MetadataRecord | null = null;
	let type: MetadataBundle['type'] = kind === 'movie' ? 'movie' : 'show';
	if (extra.tmdbOnly) {
		// `?sources=tmdb`: TMDB's records alone, for a caller reading one season list after
		// another (rex at start-up), without asking OMDb, mdblist and Trakt each time.
		if (id.by === 'imdb') {
			const found = getTmdbAuth()
				? await settle(() => cache.searchTmdbByImdb(id.imdb))
				: null;
			sources.tmdbFind = found;
			const movie = found?.movie_results?.[0]?.id;
			const show = found?.tv_results?.[0]?.id;
			if (typeof movie === 'number' || typeof show === 'number') {
				type = typeof show === 'number' ? 'show' : 'movie';
				tmdb = blank(
					await settle(() =>
						type === 'show'
							? cache.getTmdbTvInfo(show, TMDB_TV_APPEND)
							: cache.getTmdbMovieInfo(movie, TMDB_MOVIE_APPEND)
					)
				);
			} else if (found?.tv_episode_results?.length) {
				type = 'episode';
			} else {
				return null;
			}
		}
		sources.tmdb = tmdb;
	} else if (imdb) {
		const omdbPromise = settle(() => getOmdbMetadata(imdb!));
		const omdb = await omdbPromise;
		const found = getTmdbAuth() ? await settle(() => cache.searchTmdbByImdb(imdb!)) : null;
		sources.tmdbFind = found;
		const detected = kind
			? kind === 'movie'
				? 'movie'
				: 'show'
			: await detectMediaType(imdb, omdb);
		if (!detected) return null;
		type = detected;
		if (detected === 'episode') {
			sources.omdb = omdb;
			merged = episodeRecordFromOmdb(imdb, omdb);
		} else if (detected === 'movie') {
			const movie = await fetchMovieSources(imdb, { omdb: omdbPromise, tmdbId });
			Object.assign(sources, movie);
			merged = Object.values(movie).some(Boolean) ? mergeMovieRecord(imdb, movie) : null;
			tmdb = movie.tmdb ?? tmdb;
		} else {
			const show = await fetchShowSources(imdb, { omdb: omdbPromise, tmdbId });
			Object.assign(sources, show);
			merged = Object.values(show).some(Boolean) ? mergeShowRecord(imdb, show) : null;
			tmdb = show.tmdb ?? tmdb;
		}
	} else {
		// A title TMDB has and IMDb does not (an anime cour TMDB files as its own show):
		// only TMDB can answer for it.
		sources.tmdb = tmdb;
	}
	tmdbId = typeof tmdb?.id === 'number' ? tmdb.id : tmdbId;

	if (type === 'show' && tmdbId && extra.season !== undefined) {
		sources.tmdbSeason = await settle(() =>
			cache.getTmdbPassthrough(`tv/${tmdbId}/season/${extra.season}`, {})
		);
		if (extra.episode !== undefined) {
			sources.tmdbEpisode = await settle(() =>
				cache.getTmdbPassthrough(
					`tv/${tmdbId}/season/${extra.season}/episode/${extra.episode}`,
					{
						append_to_response: 'external_ids',
					}
				)
			);
		}
	}
	const tvdb = tmdb?.external_ids?.tvdb_id ?? (sources.mdblist as any)?.tvdbid;
	return {
		ids: {
			...(imdb ? { imdb } : {}),
			...(tmdbId ? { tmdb: tmdbId } : {}),
			...(typeof tvdb === 'number' ? { tvdb } : {}),
		},
		type,
		merged,
		sources,
	};
}

/** TMDB's search for a title, for the sponsor metadata API's `search`: films by year, shows by first air year. */
export async function searchMetadata(
	query: string,
	type: 'movie' | 'show',
	year?: number
): Promise<{ sources: Record<string, unknown> }> {
	const kind = type === 'movie' ? 'movie' : 'tv';
	const params: Record<string, string> = { query };
	if (year) params[type === 'movie' ? 'year' : 'first_air_date_year'] = String(year);
	const tmdb = getTmdbAuth()
		? await settle(() => getMetadataCache().getTmdbPassthrough(`search/${kind}`, params))
		: null;
	return { sources: { tmdb } };
}
