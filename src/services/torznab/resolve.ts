// Turning a Torznab query into the library pages that can answer it.
//
// Every *arr identifies content differently — Radarr sends an IMDb id, Sonarr a
// TVDB id plus a season, Prowlarr's manual search sends whatever a person typed
// — while DMM's torrent library is keyed on IMDb ids from end to end
// (`movie:tt0111161`, `tv:tt0903747:1`). This module is the whole of that
// translation, so the search path never has to think about it.

import { repository as db } from '@/services/repository';
import { resolveImdbIdFromTvdbId } from '@/services/tvdbLookup';
import type { LibraryKind } from './categories';

export const SEARCH_TYPES = ['search', 'tvsearch', 'movie'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export function isSearchType(value: string): value is SearchType {
	return (SEARCH_TYPES as readonly string[]).includes(value);
}

/**
 * How many season pages a TV search that names no season reads.
 *
 * A show with forty season pages cannot be answered whole — the client asked for
 * one page of results, not a library dump — so the most recently refreshed ones
 * are read and the rest left to a search that names a season. See
 * `getScrapedTrueSeasonKeys` for why recency rather than season number decides
 * which ones those are. Sonarr always names a season; this bound only shapes
 * what a person typing a show name into Prowlarr gets back.
 */
export const MAX_UNSPECIFIED_SEASONS = 3;

export interface TorznabTarget {
	kind: LibraryKind;
	imdbId: string;
	season?: number;
	/** The `ScrapedTrue` page key these releases live under. */
	key: string;
}

function movieTarget(imdbId: string): TorznabTarget {
	return { kind: 'movie', imdbId, key: `movie:${imdbId}` };
}

function seasonTarget(imdbId: string, season: number): TorznabTarget {
	return { kind: 'tv', imdbId, season, key: `tv:${imdbId}:${season}` };
}

/**
 * A client's `imdbid` in the form the library stores.
 *
 * Clients disagree about the prefix and about the padding: Prowlarr strips `tt`
 * and sends bare digits, some *arr versions send the id verbatim, and neither is
 * wrong. The zero padding matters — `tt0111161` and `tt111161` are different
 * strings and only the first one is a key in this database.
 */
export function normalizeImdbId(raw: string): string | null {
	const bare = raw.trim().replace(/^tt/i, '');
	if (!/^\d{1,12}$/.test(bare)) return null;
	return `tt${bare.length < 7 ? bare.padStart(7, '0') : bare}`;
}

const YEAR_SUFFIX = /\s\(?(19\d{2}|20\d{2})\)?$/;
// `S01E02`, `S01`, `1x02` and `Season 3` all reach `q` from a manual search, and
// none of them are part of the title the IMDb index is keyed on.
const EPISODE_TOKENS = /\b(?:s\d{1,3}(?:e\d{1,4})?|\d{1,2}x\d{1,3}|season\s*\d{1,3})\b/gi;

export interface ParsedQueryTitle {
	title: string;
	year?: number;
}

/**
 * Splits a free-text query into the title the IMDb index can match and the year
 * that narrows it. A trailing year is only taken as one when it is plausibly a
 * release year — "Blade Runner 2049" keeps its 2049.
 */
export function parseQueryTitle(raw: string): ParsedQueryTitle {
	let text = raw.replace(EPISODE_TOKENS, ' ');

	let year: number | undefined;
	const match = YEAR_SUFFIX.exec(text.trim());
	if (match) {
		const candidate = Number.parseInt(match[1], 10);
		if (candidate >= 1900 && candidate <= new Date().getFullYear() + 1) {
			year = candidate;
			text = text.trim().slice(0, match.index);
		}
	}

	const title = text
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ');
	return year === undefined ? { title } : { title, year };
}

/**
 * The pages to read for one show: the season asked for, or the newest few.
 *
 * The unspecified case is a key-only query, so the cost of listing a show's
 * seasons does not grow with how many releases they hold.
 */
async function existingSeasonTargets(imdbId: string): Promise<TorznabTarget[]> {
	const keys = await db.getScrapedTrueSeasonKeys(imdbId);
	return keys.slice(0, MAX_UNSPECIFIED_SEASONS).map((key) => ({
		kind: 'tv' as const,
		imdbId,
		season: Number(key.split(':')[2]),
		key,
	}));
}

async function showTargets(imdbId: string, season?: number): Promise<TorznabTarget[]> {
	if (season !== undefined) return [seasonTarget(imdbId, season)];

	const existing = await existingSeasonTargets(imdbId);
	// A show nothing has ever scraped has no season pages at all. Season 1 is the
	// one season every show has, and naming it is what gives the debridio
	// backfill something to ask about instead of answering empty.
	return existing.length > 0 ? existing : [seasonTarget(imdbId, 1)];
}

/**
 * The pages for a known id, given whatever the search type told us about kind.
 *
 * `t=search` says nothing about kind, so the id is looked up in DMM's own IMDb
 * index to find out — one indexed read, and the alternative is reading a movie
 * page and a season listing for every id search and discarding one of them. An
 * id the index has never heard of falls back to exactly that fan-out rather than
 * to an empty answer.
 */
async function targetsForImdbId(
	imdbId: string,
	kind: LibraryKind | undefined,
	season: number | undefined
): Promise<TorznabTarget[]> {
	if (kind === 'movie') return [movieTarget(imdbId)];
	if (kind === 'tv') return showTargets(imdbId, season);
	if (season !== undefined) return showTargets(imdbId, season);

	const known = await db.getImdbTitleById(imdbId).catch(() => null);
	if (known) return known.type === 'movie' ? [movieTarget(imdbId)] : showTargets(imdbId);

	// Guessing at both, so only the season pages that actually exist are read —
	// inventing a season 1 here would pair every unknown movie id with a series
	// page that can never answer, and cost the movie its debridio backfill.
	return [movieTarget(imdbId), ...(await existingSeasonTargets(imdbId))];
}

/**
 * The best IMDb id for a free-text query, from DMM's own IMDb index.
 *
 * The index is local, so this costs a query rather than an API call, and it
 * answers with the title's type — which is how a `t=search` for a show name
 * ends up reading season pages instead of a movie page.
 */
async function targetsForTitle(
	q: string,
	kind: LibraryKind | undefined,
	season: number | undefined
): Promise<TorznabTarget[]> {
	const { title, year } = parseQueryTitle(q);
	if (!title) return [];

	const mediaType = kind === 'tv' ? 'show' : kind === 'movie' ? 'movie' : undefined;
	const rows = await db.searchImdbTitles(title, { limit: 1, year, mediaType });
	const top = rows[0];
	if (!top) return [];

	return targetsForImdbId(top.imdbId, top.type === 'show' ? 'tv' : 'movie', season);
}

export interface TargetQuery {
	imdbid?: string;
	tvdbid?: number;
	q?: string;
	season?: number;
	/** The client's `cat=` list, which says what kind of title it is after. */
	categories?: number[];
}

/**
 * What a category filter implies about the kind of title being searched for.
 *
 * Prowlarr's manual search sends `t=search` — which says nothing — together with
 * the categories a person ticked, which say a great deal: a search scoped to
 * Movies has no business matching a series of the same name. Only an unmixed
 * filter is treated as a statement; a client asking for both means both.
 */
export function kindFromCategories(categories: number[]): LibraryKind | undefined {
	if (categories.length === 0) return undefined;
	if (categories.every((id) => id >= 2000 && id < 3000)) return 'movie';
	if (categories.every((id) => id >= 5000 && id < 6000)) return 'tv';
	return undefined;
}

/**
 * Every page that could answer this query, most specific identifier first.
 *
 * The order is the point: an id is an exact statement about what the client
 * wants and a title is a guess, so a title search only runs when no id resolved.
 * A TVDB id costs one metadata lookup, cached by mdblist's own cache table, and
 * falls through to the title path when the mapping is unknown.
 */
export async function resolveTargets(t: SearchType, query: TargetQuery): Promise<TorznabTarget[]> {
	const kind: LibraryKind | undefined =
		t === 'movie'
			? 'movie'
			: t === 'tvsearch'
				? 'tv'
				: kindFromCategories(query.categories ?? []);

	if (query.imdbid) {
		const imdbId = normalizeImdbId(query.imdbid);
		if (imdbId) return targetsForImdbId(imdbId, kind, query.season);
	}

	if (query.tvdbid !== undefined) {
		const imdbId = await resolveImdbIdFromTvdbId(query.tvdbid);
		// A TVDB id names a series whatever search type carried it.
		if (imdbId) return targetsForImdbId(imdbId, 'tv', query.season);
	}

	if (query.q) return targetsForTitle(query.q, kind, query.season);

	return [];
}
