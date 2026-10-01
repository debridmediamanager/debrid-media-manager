/**
 * Which episode of one season a release name is, for the season page's chips.
 *
 * Nothing here reads a name from scratch. `seasonNaming` already reads the
 * notations TV release groups write (`S03E04`, `3x04`, `S03E01-E03`,
 * `S03E01E02`, `Season 3`, `S01-S05`) for the Stremio trove and the All
 * Seasons run, and `parseAnimeEpisode` reads what fansub groups write
 * (`- 05`, `[49]`, `Episode 5`, `E05`, `EP01-12`, `01 ~ 28`) for the anime
 * page. This file decides what those readings mean for one season of one
 * show, which neither of them knows.
 *
 * A release lands in exactly one place: some episodes of this season, a pack
 * of this season (or of several seasons including it), or `other`. `other` is
 * a release the name does not place here: it names a different season, or
 * nothing that can be pinned to this one. A number is only read as an episode
 * of this season when nothing else could explain it.
 *
 * Anime seasons need one more step. Groups number by the whole run as often as
 * by season: Spy x Family's third season is `S03E46` and `- 38` as well as
 * `S03E09`, because episode 46 of the show is episode 9 of that season. On a
 * show with AniDB entries, a number past the season's own count is read as an
 * absolute one, but only when it lands inside this season and cannot also be
 * the season's own numbering.
 */

import { parseAnimeEpisode, type AnimeEpisodeMatch } from '@/utils/animeEpisodes';
import { namedEpisodes, namedSeasons } from '@/utils/seasonNaming';

export interface TvEpisodeContext {
	/** The season the page shows. */
	season: number;
	/** `season_episode_counts`: episodes per season, specials under 0. */
	episodeCounts: Record<number, number>;
	/** `season_count`: numbered seasons, not counting specials. */
	seasonCount: number;
	/** The show has AniDB entries, so fansub and absolute numbering are read. */
	anime: boolean;
}

export type TvEpisodeMatch =
	/** Episodes of this season, ascending. A two-parter or a range names several. */
	| { kind: 'episodes'; episodes: number[] }
	/** The whole season, or several seasons including it. */
	| { kind: 'pack' }
	/** Another season's release, or one whose name places nothing here. */
	| { kind: 'other' };

const PACK: TvEpisodeMatch = { kind: 'pack' };
const OTHER: TvEpisodeMatch = { kind: 'other' };

/** A range wider than this is a misread, not a batch of episodes. */
const MAX_RANGE = 200;

/**
 * The fansub way of naming a season: `S3 - 06`, `Season 3 - 05`,
 * `3rd Season - 05`. `namedSeasons` reads the spaced hyphen as a season range
 * (`S01 - 24` as seasons 1 to 24), which on a season page would turn every
 * such episode into a multi-season pack. The episode has two digits or more,
 * as fansub numbering always does, which keeps `Season 1 - 2` a range; a
 * batch carries a second number (`S3 - 01 ~ 13`), which must not run into a
 * resolution (`- 05 - 1080p`), and a resolution is not an episode
 * (`Attack on Titan - S03 - 1080p`).
 */
const FANSUB_SEASON =
	/(?:^|[^a-z0-9])(?:(?:s|season[\s._]?)(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)[\s._]season)[\s._]+[-–][\s._]+(\d{2,4})(?![0-9]|[pi]\b)(?:[\s._]*[-~][\s._]*(\d{2,4})(?![0-9a-z]))?/i;

/**
 * Words that name a whole run without numbering it: `Complete Series`,
 * `All Seasons`, `Complete Boxset`. Such a release covers every season, so it
 * is a pack wherever the index filed it.
 */
const WHOLE_RUN =
	/\b(?:complete[\s._-]*(?:tv[\s._-]*)?(?:series|collection|box[\s._-]*set)|all[\s._-]*seasons|integrale)\b/i;

/**
 * `Friends.COMPLETE.FRENCH.BRRip`: on a western show a name that says it is
 * complete and names no season is the whole run. Fansub groups write
 * `(Complete)` on a single cour's batch, so anime pages do not read it.
 */
const COMPLETE_WORD = /\bcomplete\b/i;

/**
 * Bracketed episode tokens (`[01v2]`, `[EP08v2]`), removed before a fansub
 * name's seasons are read. `namedSeasons` reads a number followed by brackets
 * and `Season` as that season (`[EP08v2] [Season 1]` as seasons 2 and 1), and
 * a bracket after `Season 3` as a list (`Season 3 [01v2]` as seasons 3 and 1).
 */
const BRACKETED_EPISODE = /[[(【]\s?(?:ep?\.?\s?|episode\s?)?\d{1,4}(?:v\d{1,2})?\s?[\])】]/gi;

/**
 * `全17集` and `13集全`, "all seventeen (thirteen) episodes": a pack.
 * `parseAnimeEpisode` reads the `7集` inside the first as episode 7 (its guard
 * only looks one character back) and the second as episode 13, so the season
 * page decides these before asking it.
 */
const ALL_EPISODES_CJK = /全\s?\d{1,4}\s?[話话集]|\d{1,4}\s?[話话集]\s?全/;

/** `[第01-17集]`, episodes 1 to 17, which the anime parser reads as episode 17. */
const CJK_RANGE = /第?\s?(\d{1,4})\s?[-~～]\s?(\d{1,4})\s?[話话集]/;

/**
 * Season words `namedSeasons` reads and `parseAnimeEpisode` does not:
 * `Stagione 2`, `Sezon 3`, `3ª Temporada`, `第2季`. Left as they are, the anime
 * parser takes the season number for a trailing episode (`House Stagione 3`
 * as episode 3), so they are spelled `Season N`, which it knows is not one.
 */
const FOREIGN_SEASON_WORD =
	/(?:stagion[ei]|sezon[ae]?|temporadas?|saisons?|staffel|сезон[а-я]*)[\s._:]*(\d{1,2})(?![0-9])/gi;
const FOREIGN_SEASON_WORD_AFTER =
	/(\d{1,2})(?:st|nd|rd|th|ª|°)?[\s._]*(?:temporadas?|saisons?|stagion[ei]|staffel|sezon[ae]?)/gi;
const CJK_SEASON = /第\s?(\d{1,2})\s?季/g;

const asEnglishSeasons = (name: string) =>
	name
		.replace(FOREIGN_SEASON_WORD, ' Season $1 ')
		.replace(FOREIGN_SEASON_WORD_AFTER, ' Season $1 ')
		.replace(CJK_SEASON, ' Season $1 ');

const countOf = (ctx: TvEpisodeContext, season: number): number => {
	const count = ctx.episodeCounts?.[season];
	return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0;
};

/** Episodes before this season's first, when every earlier season's count is known. */
function offsetOf(ctx: TvEpisodeContext): number | null {
	if (ctx.season < 1) return null;
	let offset = 0;
	for (let season = 1; season < ctx.season; season++) {
		const count = countOf(ctx, season);
		if (count === 0) return null;
		offset += count;
	}
	return offset;
}

const singleSeason = (ctx: TvEpisodeContext) => ctx.season === 1 && ctx.seasonCount === 1;

/**
 * This season's episode for a number a release carries, or null.
 *
 * `seasonNamed` says the name itself names this season, so the number is the
 * season's own unless it cannot be. A bare number with no season named is
 * only this season's on a one-season show, or on an anime show where it can
 * only be an absolute number landing inside this season.
 */
function placeNumber(n: number, ctx: TvEpisodeContext, seasonNamed: boolean): number | null {
	if (!Number.isInteger(n) || n < 1) return null;
	const count = countOf(ctx, ctx.season);

	if (seasonNamed) {
		if (count === 0 || n <= count) return n;
		// Past the season's count, a western name is another show filed here
		// (`The Simpsons S04E22` under The Office) or a disc's chapter numbers;
		// `season_episode_counts` includes episodes that have not aired yet, so
		// it is not the count that is short.
		if (!ctx.anime) return null;
	} else if (!ctx.anime && !singleSeason(ctx)) {
		return null;
	} else if (ctx.season === 1 || singleSeason(ctx)) {
		// The first season's own numbering and the absolute one are the same.
		return count > 0 && n <= count ? n : null;
	}

	if (!ctx.anime || count === 0) return null;
	const offset = offsetOf(ctx);
	if (offset === null) return null;
	// `n > count` rules out the season's own numbering, so the absolute
	// reading is the only one left.
	if (n > count && n > offset && n <= offset + count) return n - offset;
	return null;
}

/** Places each number, keeping the ones that land; a full season is a pack. */
function placeEpisodes(
	numbers: number[],
	ctx: TvEpisodeContext,
	seasonNamed: boolean
): TvEpisodeMatch {
	const placed = new Set<number>();
	for (const n of numbers) {
		const episode = placeNumber(n, ctx, seasonNamed);
		if (episode !== null) placed.add(episode);
	}
	if (placed.size === 0) return OTHER;
	const episodes = [...placed].sort((a, b) => a - b);
	const count = countOf(ctx, ctx.season);
	// `S04E01-19` on a nineteen-episode season is the season, not nineteen
	// single episodes.
	if (count > 1 && episodes.length >= count && episodes[0] <= 1 && episodes.at(-1)! >= count) {
		return PACK;
	}
	return { kind: 'episodes', episodes };
}

function placeRange(
	from: number,
	to: number,
	ctx: TvEpisodeContext,
	seasonNamed: boolean
): TvEpisodeMatch {
	if (to < from || to - from > MAX_RANGE) return OTHER;
	const first = placeNumber(from, ctx, seasonNamed);
	const last = placeNumber(to, ctx, seasonNamed);
	// Both ends must land and stay the same distance apart, or the range
	// straddles a season boundary.
	if (first === null || last === null || last - first !== to - from) return OTHER;
	const numbers: number[] = [];
	for (let n = from; n <= to; n++) numbers.push(n);
	return placeEpisodes(numbers, ctx, seasonNamed);
}

/** Reads what `parseAnimeEpisode` finds for a name that may name this season. */
function placeParsed(name: string, ctx: TvEpisodeContext, seasonNamed: boolean): TvEpisodeMatch {
	const cjkRange = CJK_RANGE.exec(name);
	const parsed: AnimeEpisodeMatch | null = ALL_EPISODES_CJK.test(name)
		? { kind: 'batch' }
		: cjkRange
			? { kind: 'batch', from: Number(cjkRange[1]), to: Number(cjkRange[2]) }
			: parseAnimeEpisode(seasonNamed ? asEnglishSeasons(name) : name);
	if (parsed === null) return seasonNamed ? PACK : OTHER;
	if (parsed.kind === 'episode' || (parsed.from !== undefined && parsed.to !== undefined)) {
		const placed =
			parsed.kind === 'episode'
				? placeEpisodes([parsed.episode], ctx, seasonNamed)
				: placeRange(parsed.from!, parsed.to!, ctx, seasonNamed);
		// A western name that names the season and then a number no episode of
		// it can be (`S02 - 2160 BluRay`, `Season 1 ~ 2002`, a disc's chapter
		// numbers) is the season with noise in its name.
		return placed === OTHER && seasonNamed && !ctx.anime ? PACK : placed;
	}
	// A batch that names no range is this season's only when the name says so
	// or there is no other season it could be.
	return seasonNamed || singleSeason(ctx) ? PACK : OTHER;
}

/** Reads one release name against one season. */
export function parseTvEpisode(name: string, ctx: TvEpisodeContext): TvEpisodeMatch {
	if (!name) return OTHER;

	if (ctx.anime) {
		const fansub = FANSUB_SEASON.exec(name);
		if (fansub) {
			if (Number(fansub[1] ?? fansub[2]) !== ctx.season) return OTHER;
			const from = Number(fansub[3]);
			return fansub[4] === undefined
				? placeEpisodes([from], ctx, true)
				: placeRange(from, Number(fansub[4]), ctx, true);
		}
	}

	const seasons = namedSeasons(ctx.anime ? name.replace(BRACKETED_EPISODE, ' ') : name);
	// `S01-S05` claims five seasons and no episode of any one of them, even
	// when it goes on to number the whole run (`S01-S10e001-235`).
	if (seasons.size > 1) return seasons.has(ctx.season) ? PACK : OTHER;

	// `S03E04`, `3x04`, `S03E01-E03`: the only notations that prove a season
	// and an episode together.
	const pairs = namedEpisodes(name);
	if (pairs.size > 0) {
		const prefix = `${ctx.season}:`;
		const numbers: number[] = [];
		for (const key of pairs) {
			if (key.startsWith(prefix)) numbers.push(Number(key.slice(prefix.length)));
		}
		// A release naming another season's episode does not count here.
		if (numbers.length === 0) return OTHER;
		return placeEpisodes(numbers, ctx, true);
	}

	if (seasons.size > 0) {
		if (!seasons.has(ctx.season)) return OTHER;
		// `Season 3 Episode 5`, `S3[49]`, `S10 Ep 07-12`: the season is named
		// and the episode is written some other way.
		return placeParsed(name, ctx, true);
	}

	if (WHOLE_RUN.test(name)) return PACK;
	if (!ctx.anime && COMPLETE_WORD.test(name)) return PACK;
	if (!ctx.anime && !singleSeason(ctx)) return OTHER;
	return placeParsed(name, ctx, false);
}

/** Memoises `parseTvEpisode` per name for one context, so a page parses each title once. */
export function createTvEpisodeReader(ctx: TvEpisodeContext): (name: string) => TvEpisodeMatch {
	const cache = new Map<string, TvEpisodeMatch>();
	return (name: string) => {
		let match = cache.get(name);
		if (match === undefined) {
			match = parseTvEpisode(name, ctx);
			cache.set(name, match);
		}
		return match;
	};
}

export interface TvEpisodeSummary {
	/** Releases naming each episode, keyed by episode. A range counts under each one. */
	episodes: Map<number, number>;
	packs: number;
	other: number;
}

export function summarizeTvEpisodes(
	names: Iterable<string>,
	read: (name: string) => TvEpisodeMatch
): TvEpisodeSummary {
	const episodes = new Map<number, number>();
	let packs = 0;
	let other = 0;
	for (const name of names) {
		const match = read(name);
		if (match.kind === 'pack') packs++;
		else if (match.kind === 'other') other++;
		else
			for (const episode of match.episodes)
				episodes.set(episode, (episodes.get(episode) ?? 0) + 1);
	}
	return { episodes, packs, other };
}

/** One episode, the packs, or what the name places nowhere in this season. */
export type TvEpisodeFilter = number | 'packs' | 'other';

export function matchesTvEpisodeFilter(match: TvEpisodeMatch, filter: TvEpisodeFilter): boolean {
	if (filter === 'packs') return match.kind === 'pack';
	if (filter === 'other') return match.kind === 'other';
	return match.kind === 'episodes' && match.episodes.includes(filter);
}

/** Parses the page's `?episode=` parameter. */
export function parseTvEpisodeFilter(raw: unknown): TvEpisodeFilter | null {
	if (typeof raw !== 'string' || raw === '') return null;
	if (raw === 'packs' || raw === 'other') return raw;
	if (!/^\d{1,4}$/.test(raw)) return null;
	const episode = Number.parseInt(raw, 10);
	return episode >= 1 ? episode : null;
}

/**
 * The first episode of this season that has not aired, or null when all have.
 *
 * `next_episode_to_air` names the boundary when the show has one scheduled;
 * otherwise `last_episode_to_air` does. A season after the one airing now has
 * aired nothing.
 */
export function firstUnairedEpisode(
	season: number,
	next?: { season_number: number; episode_number: number } | null,
	last?: { season_number: number; episode_number: number } | null
): number | null {
	if (next && Number.isInteger(next.season_number) && Number.isInteger(next.episode_number)) {
		if (next.season_number === season) return next.episode_number;
		return next.season_number < season ? 1 : null;
	}
	if (last && Number.isInteger(last.season_number) && Number.isInteger(last.episode_number)) {
		if (last.season_number === season) return last.episode_number + 1;
		return last.season_number < season ? 1 : null;
	}
	return null;
}
