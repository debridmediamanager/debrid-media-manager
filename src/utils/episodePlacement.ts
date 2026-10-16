/**
 * Which TMDB season and episode a show's file is, for the sponsor placement API
 * (`/api/sponsor/place`). Nothing here asks a provider: the caller hands in the show's TMDB
 * seasons, the anime index and an IMDb lookup, so the rules run the same over captured
 * answers in tests as over live ones.
 *
 * A file is placed by the first rule that lands on an episode TMDB lists, else not at all:
 *
 * - `anime`: a fansub-shaped name (`[Group] ...` or a `[CRC32]`) whose title the anime index
 *   knows, numbered the way the entry's cour is (`Hibike Euphonium 3 - 01` is Sound!
 *   Euphonium S3E1); or a scene name of a mapped anime numbered as TVDB numbers it
 *   (`Jujutsu.Kaisen.S03E03` is TMDB's S1E50).
 * - `tmdb`: the numbers as named, or a year-numbered season (`MythBusters.2004x01`) as
 *   TMDB's season that aired that year.
 * - `imdb`: IMDb's episode by those numbers, and the TMDB episode TMDB's find names for it,
 *   when that is the identified show's (Detective Conan S33, which TMDB keeps in season 1).
 * - `absolute`: a number with no season, counted through TMDB's seasons.
 *
 * The rules are rex's (`rust/src/runtime/anime.rs`, `scan.rs`), each measured on a production
 * library; rex keeps its own name parser for whatever arrives here unplaced.
 */
import type { FranchiseIndex } from '@/services/anime/animeFranchise';
import { parseAnimeEpisode } from '@/utils/animeEpisodes';
import { namedEpisodes, namedSeasons } from '@/utils/seasonNaming';
import { FANSUB_SEASON } from '@/utils/tvEpisodes';
import ptt from 'parse-torrent-title';

export type PlacementRule = 'tmdb' | 'anime' | 'imdb' | 'absolute';

/** A file's numbers as its name (or its folder, or its release) gives them. */
export interface FileNumbers {
	season: number | null;
	episode: number;
	/** The last episode of a multi-episode file (`S04E17E18`), else null. */
	end: number | null;
	/** The season came from the file's folder or release, not its own name. */
	borrowed?: true;
	/** The number is a pack's running code (`102a-b - …`, `14. …`), not the name's episode. */
	coded?: true;
}

export interface TmdbSeason {
	season: number;
	episodes: number;
	airDate: string | null;
}

/** The identified show as TMDB has it. */
export interface PlacementShow {
	tmdbId: number;
	imdbId: string | null;
	/** TMDB's name and original name: a release named as one of them plus a subtitle is another series. */
	names: string[];
	seasons: TmdbSeason[];
	/**
	 * The episodes TMDB lists in a season, ascending; null when the list could not be read.
	 * Counts alone cannot tell: TMDB numbers One Piece's season 21 from 892.
	 */
	episodes(
		season: number
	): Promise<{ episode: number; name: string; airDate: string | null }[] | null>;
}

export interface Placement {
	season: number;
	episode: number;
	episodeEnd: number | null;
	how: PlacementRule;
}

/** TMDB's season and episode for IMDb's episode of the show by these numbers, if TMDB files it under that show. */
export type ImdbLookup = (season: number, episode: number) => Promise<[number, number] | null>;

/** Lowercase letters and digits, words split on everything else: `Hibike! Euphonium 3` is `hibike euphonium 3`. */
export function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.join(' ');
}

// `[Erai-raws] …`, `[SubsPlease] …`, `… [8FAE9300].mkv`: what fansubs name and scene releases do not.
const SHAPED = /^\s*\[[^\]]+\]|[[(][0-9A-F]{8}[\])]/i;
export const fansubShaped = (name: string) => SHAPED.test(name);
const LEADING_GROUPS = /^\s*(?:\[[^\]]*\][\s._-]*)+/;

/** A name's title, year and single season, the release group left off. */
export function parseName(name: string): {
	title: string;
	year: number | null;
	season: number | null;
} {
	const parsed = ptt.parse(name.replace(LEADING_GROUPS, ''));
	const seasons = parsed.seasons ?? [];
	return {
		title: (parsed.title ?? '').trim(),
		year: typeof parsed.year === 'number' ? parsed.year : null,
		season: seasons.length === 1 ? seasons[0] : null,
	};
}

// `Season 6`, `Stagione 6`, `S2 (2009-11)`, `Saturday Night Live -  Season 05`; `Season 2006` names none.
const FOLDER_SEASON =
	/(?:^|[\s._-])(?:season|stagione|staffel|saison|temporada|s)[\s._-]*(\d{1,2})(?:$|[^\d\-–+&,e])/i;
// A name of several seasons: `Season 1 2 3 4`, `S01-S07`, `Seasons 1-15`, `Complete Series`.
const SEVERAL_SEASONS =
	/seasons|complete|\bs\d{1,2}\s*[-+&]\s*s?\d|season[\s._]*\d{1,2}[\s._,&+-]+\d/i;
// A folder of what is not an episode: Smallville's `Stagione 6/Extra`.
const EXTRAS_FOLDER =
	/^(?:extras?|bonus|featurettes?|behind the scenes|deleted scenes|interviews?|trailers?|samples?|other)$/i;
// `35. Returning Memories`, `02 - Who Mourns for Adonais`, `-01 Are You Afraid of the Dark`.
const LEADING = /^-?(\d{1,3})(?:\.\s*|\s+-\s+|\s+)[^\d\s]/;
// The season's number before the episode's, in that season's folder: `601 - The Tale of…`, `1.01. A Night…`.
const SEASON_LEADING =
	/^(\d{1,2})\.?(\d{2})(?:[a-z](?:-[a-z])?|-\d{1,2})?(?:\.\s*|\s+-\s+|\s+)[^\d\s]/;
// `011 - Terror Of The Ancient Noh Mask`: absolute, zero-padded to three digits.
const LEADING_ABSOLUTE = /^([01]\d{2})(?:-[01]\d{2})?(?:\.\s*|\s+-\s+)\S/;
// `MythBusters.2004x01`, `MythBusters.S2009E05`: a season numbered by its year (`1920x816` is a frame size).
const YEAR_EPISODE = /(?:^|[^a-z0-9])s?((?:19|20)\d{2})[xe](\d{2})(?![0-9])/i;
// `MLB_S6EP01_Climatiqueen`, `Grand.Blue.Season.3-09`, `Kingdom.4th.Season-21`.
const UNDERSCORE_SEASON_EP = /(?:^|[\s._-])S(\d{1,2})[._-]?EP?(\d{1,4})(?:[^\da-z]|$)/i;
const SEASON_DASH_EP =
	/(?:^|[\s._-])(?:Season[\s._]*(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)[\s._]Season)[\s._]*-[\s._]*(\d{1,4})(?:v\d)?(?:[^\da-z]|$)/i;
// `The Amazing World of Gumball - 207, 208 - The Phone - The Job`: season 2's 7th and 8th.
const PAIRED_CODES = /(?:^|\s-\s)(\d{3}),\s*(\d{3})\s-\s/;
// `aaf-wilty.302` in `Would.I.Lie.To.You.S03E01`: the season and episode as one number.
const SCENE_SHORTHAND = /(?:^|[\s._-])(\d)(\d{2})(?:[\s._-]|$)/;
// `[CyC] Natsume Yuujinchou Shi 03`: a season as a Japanese numeral (shi, four), capitalised.
const JAPANESE_NUMERALS = ['Ni', 'San', 'Shi', 'Go', 'Roku', 'Nana', 'Hachi', 'Kyuu', 'Juu'];
const JAPANESE_SEASON = new RegExp(
	`[\\s._](${JAPANESE_NUMERALS.join('|')})[\\s._]+(\\d{2,3})(?:v\\d)?(?:[\\s._(\\[]|$)`
);
// `One Piece - 0160 - 10 Survival Rate!`: a run's zero-padded number before a title that has its own.
const ZERO_PADDED = /\s-\s(0\d{3})(?:v\d)?\s-\s/;
// `Carl.Sagans.Cosmos.10of13`.
const OF_COUNT = /(?:^|[\s._-])(\d{1,3})of(\d{1,3})(?:[\s._-]|$)/i;
// `[Coalgirls]_Hunter_X_Hunter_001_(…)`, `House M.D. 14 - Private Lives`: the show's name, then the number.
const TITLE_NUMBER = /^(.*?\S)\s+(\d{2,4})(?:v\d)?(?:\s.*)?$/;
// What a release holds beside its episodes, named like them: `To LOVE-Ru OVA 04`, `Mawaru_Penguindrum_NCED_07`.
const NOT_EPISODE =
	/\b(?:nc(?:op|ed)\w*|ova|oad|op|ed|sp|pv|cm|special|specials|movie|menu|preview|trailer|recap|extra|extras|bonus|featurette|interview|behind|making|creditless|clean|teaser|promo|omake)\b/i;
// Plex's local-extra suffixes: `002 - Deleted Scene Episodes 2-4 [iKaos]-deleted`.
const EXTRA_SUFFIX =
	/-(?:behindthescenes|deleted|featurette|interview|scene|short|trailer|other)$/i;
const BRACKETS = /[[(][^\])]*[\])]/g;
const SAMPLE = /(?:^|[\s._-])sample(?:[\s._-]|$)/i;
const EXTENSION = /\.[a-z0-9]{2,4}$/i;
const RESOLUTIONS = new Set([480, 576, 720, 1080, 2160]);

const positive = (raw: string | undefined) => {
	const value = Number(raw);
	return Number.isInteger(value) && value > 0 ? value : null;
};
const fold = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** Scene notation, which proves a season and an episode together: `S04E17E18`, `3x04`, `2004x01`, `S6EP03`. */
function sceneNumbers(name: string): FileNumbers | null {
	const year = YEAR_EPISODE.exec(name);
	if (year) return { season: Number(year[1]), episode: Number(year[2]), end: null };
	const pairs = [...namedEpisodes(name)].map((key) => key.split(':').map(Number));
	if (pairs.length > 0) {
		// the first as named: `Family Guy - S11E16 - 12 and a Half Angry Men` is no episode 12
		const [season, first] = pairs[0];
		const last = Math.max(...pairs.filter(([s]) => s === season).map(([, e]) => e));
		return first < 1 ? null : { season, episode: first, end: last > first ? last : null };
	}
	const dashed = UNDERSCORE_SEASON_EP.exec(name) ?? SEASON_DASH_EP.exec(name);
	if (dashed) {
		const season = positive(dashed[1] ?? dashed[2]);
		const episode = positive(dashed.at(-1));
		return season && episode ? { season, episode, end: null } : null;
	}
	const paired = PAIRED_CODES.exec(name);
	if (paired) {
		const [a, b] = [Number(paired[1]), Number(paired[2])];
		if (Math.floor(a / 100) === Math.floor(b / 100) && b === a + 1 && a % 100 > 0) {
			return { season: Math.floor(a / 100), episode: a % 100, end: b % 100 };
		}
	}
	return null;
}

/** Fansub and loose numbering: `Oshi no Ko S2 - 05`, `Kingdom 4th Season - 21`, `- 05`, `[05]`, `10of13`. */
function looseNumbers(stem: string): FileNumbers | null {
	if (NOT_EPISODE.test(stem.replace(BRACKETS, ' ').replace(/_/g, ' '))) return null;
	const fansub = FANSUB_SEASON.exec(stem);
	if (fansub && fansub[4] === undefined) {
		const episode = positive(fansub[3]);
		if (episode) return { season: Number(fansub[1] ?? fansub[2]), episode, end: null };
	}
	const japanese = JAPANESE_SEASON.exec(stem);
	if (japanese) {
		const episode = positive(japanese[2]);
		const season = JAPANESE_NUMERALS.indexOf(japanese[1]) + 2;
		if (episode) return { season, episode, end: null };
	}
	const padded = positive(ZERO_PADDED.exec(stem)?.[1]);
	if (padded) return { season: null, episode: padded, end: null };
	const anime = parseAnimeEpisode(stem);
	if (anime?.kind === 'episode' && anime.episode > 0) {
		const seasons = namedSeasons(stem.replace(BRACKETS, ' '));
		return {
			season: seasons.size === 1 ? [...seasons][0] : null,
			episode: anime.episode,
			end: null,
		};
	}
	const counted = OF_COUNT.exec(stem);
	if (counted && Number(counted[1]) >= 1 && Number(counted[1]) <= Number(counted[2])) {
		return { season: null, episode: Number(counted[1]), end: null };
	}
	return null;
}

/**
 * `Lovely Runner 14`, `[Zurako]_Mawaru_Penguindrum_08_…`: the release's own title, then a
 * number, so `To LOVE-Ru OVA 04` or `Room 104` never reads as an episode. A file at the top of
 * a one-folder release is an episode of it whatever it calls the show (`[EG]Cowbop_Bebop_01`).
 */
function titleNumber(release: string, folder: string | null, stem: string): number | null {
	const found = TITLE_NUMBER.exec(stem.replace(/[_.]/g, ' ').replace(BRACKETS, ' ').trim());
	const number = positive(found?.[2]);
	if (!found || !number) return null;
	if ((found[2].length === 4 && number >= 1900 && number <= 2099) || RESOLUTIONS.has(number)) {
		return null;
	}
	const [head, show] = [fold(found[1]), fold(parseName(release).title)];
	const alone = found[2].length === 4 && show === `${head}${found[2]}`;
	const named =
		head.length >= 4 &&
		(alone || show === head || (show.startsWith(head) && !/^\d/.test(show.slice(head.length))));
	const topLevel = folder === '' && head.length >= 4 && !NOT_EPISODE.test(found[1]);
	return named || topLevel ? number : null;
}

/** The one season a release names, unless it names several. */
function releaseSeason(release: string): number | null {
	if (SEVERAL_SEASONS.test(release)) return null;
	const fansub = FANSUB_SEASON.exec(release);
	if (fansub) return Number(fansub[1] ?? fansub[2]);
	const seasons = namedSeasons(release);
	return seasons.size === 1 ? [...seasons][0] : null;
}

/**
 * A show file's numbers: its name's scene notation; else the shapes that number a file only
 * beside its season (Smallville's `Stagione 6/01 - …` is numbered from 01 in every season of
 * its pack, so a leading number counts only under a season folder, or a release of one season);
 * else fansub and loose numbering; else, for a release of one file, the release's own numbers.
 * A season the name leaves out comes from its folder, else its release. `folder` is where the
 * provider lists the file inside its release, `""` at the top, null when unknown.
 */
export function fileNumbers(
	release: string,
	folder: string | null,
	path: string,
	single: boolean
): FileNumbers | null {
	const file = path.split('/').pop() ?? path;
	const stem = file.replace(EXTENSION, '');
	if (SAMPLE.test(stem) || EXTRA_SUFFIX.test(stem)) return null;
	const below = (folder?.split('/').pop() ?? '').trim();
	const folderSeason =
		below && !SEVERAL_SEASONS.test(below) ? positive(FOLDER_SEASON.exec(below)?.[1]) : null;
	const season = folderSeason ?? releaseSeason(release);
	const withSeason = (found: FileNumbers | null): FileNumbers | null =>
		found &&
		(found.season === null && season !== null ? { ...found, season, borrowed: true } : found);
	const coded = (episode: number, from: number | null): FileNumbers => ({
		season: from,
		episode,
		end: null,
		coded: true,
		...(from === null ? {} : { borrowed: true }),
	});

	const scene = sceneNumbers(stem.replace(LEADING_GROUPS, ''));
	if (scene) return withSeason(scene);
	// Suits' `Extras/Season 03/Episode 16 Alternate Opening`
	if (folder?.split('/').some((part) => EXTRAS_FOLDER.test(part.trim()))) return null;

	if (folderSeason !== null) {
		const code = SEASON_LEADING.exec(stem);
		if (code && positive(code[1]) === folderSeason && positive(code[2])) {
			return coded(Number(code[2]), folderSeason);
		}
	}
	const shorthand = SCENE_SHORTHAND.exec(stem);
	if (season !== null && season <= 9 && shorthand && Number(shorthand[1]) === season) {
		const episode = positive(shorthand[2]);
		if (episode) return { season, episode, end: null };
	}
	const leading = positive(LEADING.exec(stem)?.[1]);
	if (season !== null && leading) return coded(leading, season);
	if (season === null && !SEVERAL_SEASONS.test(release)) {
		const absolute = positive(LEADING_ABSOLUTE.exec(stem)?.[1]);
		if (absolute) return coded(absolute, null);
		// a file at the top of a one-folder release: no pack's seasons were folded into it
		if (folder === '' && leading) return coded(leading, null);
	}

	const loose = looseNumbers(stem);
	if (loose) return withSeason(loose);
	const titled = titleNumber(release, folder, stem);
	if (titled) return withSeason({ season: null, episode: titled, end: null });
	if (single) return withSeason(sceneNumbers(release) ?? looseNumbers(release));
	return null;
}

/** One anime entry (an AniDB cour) as TMDB numbers it. */
export interface AnimeTarget {
	anidb: number;
	tmdb: number;
	/** TMDB's season; -1 when TMDB numbers the show absolutely, which names the show and numbers nothing. */
	season: number;
	offset: number;
	tvdbSeason: number | null;
	tvdbOffset: number;
}

export interface AnimeIndex {
	titles: Map<string, number[]>;
	targets: Map<number, AnimeTarget>;
	byShow: Map<number, AnimeTarget[]>;
}

/** The Fribb dataset's TMDB places, named by every title and alias the `Anime` table holds for each entry. */
export function buildAnimeIndex(
	franchise: Pick<FranchiseIndex, 'byAnidb'>,
	titles: { anidbId: number; names: string[] }[]
): AnimeIndex {
	const targets = new Map<number, AnimeTarget>();
	const byShow = new Map<number, AnimeTarget[]>();
	for (const entry of franchise.byAnidb.values()) {
		const place = entry.tmdb;
		if (!place) continue;
		const target: AnimeTarget = {
			anidb: entry.anidbId,
			tmdb: place.show,
			season: place.season ?? -1,
			offset: place.offset,
			tvdbSeason: place.tvdbSeason,
			tvdbOffset: place.tvdbOffset,
		};
		targets.set(target.anidb, target);
		byShow.set(target.tmdb, [...(byShow.get(target.tmdb) ?? []), target]);
	}
	const index = new Map<string, Set<number>>();
	for (const { anidbId, names } of titles) {
		if (!targets.has(anidbId)) continue;
		for (const name of names) {
			const key = normalizeTitle(name);
			if (key) index.set(key, (index.get(key) ?? new Set()).add(anidbId));
		}
	}
	return {
		titles: new Map([...index].map(([key, ids]) => [key, [...ids]])),
		targets,
		byShow,
	};
}

/**
 * The entry a title names, the first season's when several share it: `Ranma ½` names the
 * 1989 series, Nettou Hen and the 2024 remake alike, and `Dragon Ball Z` the show and its
 * specials. Asked for a season, an entry of that season comes first: manami gives
 * `Dorohedoro Season 2` to both of Dorohedoro's entries.
 */
function findTitle(index: AnimeIndex, title: string, season?: number): AnimeTarget | null {
	const rank = (t: AnimeTarget) => [
		season === undefined || t.tvdbSeason === season || t.season === season ? 0 : 1,
		t.season === 0 ? 1 : 0,
		Math.max(t.season, 1),
		t.offset,
		t.anidb,
	];
	let best: AnimeTarget | null = null;
	for (const id of index.titles.get(normalizeTitle(title)) ?? []) {
		const target = index.targets.get(id);
		if (!target) continue;
		if (!best) best = target;
		else {
			const [a, b] = [rank(target), rank(best)];
			const at = a.findIndex((value, n) => value !== b[n]);
			if (at >= 0 && a[at] < b[at]) best = target;
		}
	}
	return best;
}

const ordinal = (n: number) =>
	n % 10 === 1 && n % 100 !== 11
		? 'st'
		: n % 10 === 2 && n % 100 !== 12
			? 'nd'
			: n % 10 === 3 && n % 100 !== 13
				? 'rd'
				: 'th';

interface AnimeHit {
	target: AnimeTarget;
	/** The name's numbers are this entry's own (a bare title with a later season names only the show). */
	numbered: boolean;
}

function lookupEntry(index: AnimeIndex, name: string): AnimeHit | null {
	const { title, year, season } = parseName(name);
	if (!title) return null;
	// AniDB names a sequel by its year: `Mairimashita! Iruma-kun (2026)`.
	if (year) {
		const target = findTitle(index, `${title} (${year})`);
		if (target) return { target, numbered: true };
	}
	if (season !== null && season > 1) {
		for (const candidate of [
			`${title} ${season}${ordinal(season)} Season`,
			`${title} Season ${season}`,
			`${title} ${season}`,
		]) {
			const target = findTitle(index, candidate, season);
			if (target) return { target, numbered: true };
		}
		const target = findTitle(index, title);
		// TVDB's numbering of the show (`Bleach-Thousand-Year.Blood.War-S17E23`) is the entry's.
		return target ? { target, numbered: target.tvdbSeason === season } : null;
	}
	const target = findTitle(index, title);
	if (target) return { target, numbered: true };
	const words = normalizeTitle(title).split(' ');
	// `Jojo's Bizarre Adventure Stone Ocean 25 (1920x1080 Blu-Ray Opus)`: the episode, left in the title
	const last = words.length > 1 && /^\d{1,4}$/.test(words.at(-1)!);
	// `Bleach 2 Sennen Kessen-hen - 46`: a series number between the title's words, which AniDB leaves out
	const lone = words.findIndex(
		(word, at) => at > 0 && at < words.length - 1 && /^\d{1,2}$/.test(word)
	);
	const without =
		(last ? findTitle(index, words.slice(0, -1).join(' ')) : null) ??
		(lone >= 0 ? findTitle(index, words.filter((_, at) => at !== lone).join(' ')) : null);
	return without ? { target: without, numbered: true } : null;
}

function lookup(index: AnimeIndex, name: string): AnimeHit | null {
	const hit = lookupEntry(index, name);
	return hit && { target: hit.target, numbered: hit.numbered && hit.target.season >= 0 };
}

/**
 * A file of a release: the release's entry, else the file's. A batch named for its first
 * season, or several (`[Reza] Food Wars`, `[Pog42] Bakuman Seasons 1-3`), holds files naming
 * their own (`S03E01`): such a file is the entry its own name finds, numbered as that lookup
 * says, and keeps its own numbers otherwise. rex also required the file's
 * season to be TVDB's, which refused the cour's own numbering of `BLEACH Thousand-Year Blood
 * War - S01E04` (TVDB's season 17) and `Shiguang Dailiren Season 3 - 01` (TVDB's season 4).
 */
export function lookupAnime(index: AnimeIndex, release: string, file: string): AnimeHit | null {
	const found = lookup(index, release) ?? lookup(index, file);
	if (!found) return null;
	const { season } = parseName(file);
	if (season === null || season === found.target.tvdbSeason) return found;
	const own = lookup(index, file);
	// Scene notation in a batch is TVDB's (`[Reza] Food Wars S04E01`, `Fruits Basket (2019) -
	// s02e01`) unless it is a cour's own first season; a special (`Aria The Animation -
	// S00E01`, a `Dragon Ball Z (1989)` special) is never a TV cour's episode.
	const scene = namedEpisodes(file).size > 0;
	return own &&
		own.target.season > 0 &&
		season > 0 &&
		(season === own.target.tvdbSeason || season === 1 || !scene)
		? own
		: { target: (own ?? found).target, numbered: false };
}

/**
 * TMDB's season and episode for an entry's episode: numbered within its cour (`Kashin Tan -
 * 01` is Bleach S2E41), already counted from the show's first cour (`Bleach 2 Sennen
 * Kessen-hen - 46`), or in TVDB's season (`S17E23`).
 * ponytail: a number past the offset is read as already absolute only when the offset is 10
 * or more, a whole cour; an entry that starts two episodes in is counted from its own first.
 */
export function animeNumbers(
	target: AnimeTarget,
	season: number | null,
	episode: number
): [number, number] {
	const counted =
		season !== null && season === target.tvdbSeason && season > 1
			? episode - target.tvdbOffset + target.offset
			: target.offset >= 10 && episode > target.offset
				? episode
				: episode + target.offset;
	return [target.season, Math.max(counted, 1)];
}

/**
 * TMDB's numbers for a file of a mapped anime show numbered as TVDB numbers it
 * (`Jujutsu.Kaisen.S03E03`, `Oshi.no.Ko.S02E01`): the show's entry for that TVDB season whose
 * offset the episode is past. A season TVDB lacks, of a show TVDB keeps as one season of cours,
 * is the cour by that number (Bookworm's BD remux `S02E01` is TMDB's S1E15).
 */
export function tvdbToTmdb(
	index: AnimeIndex,
	show: number,
	season: number,
	episode: number
): [number, number] | null {
	const all = index.byShow.get(show) ?? [];
	const entries = all.filter((t) => t.season >= 0 && t.tvdbSeason === season);
	if (entries.length === 0) {
		if (season <= 1) return null;
		const cours = all.filter((t) => t.season > 0);
		if (cours.length === 0 || cours.some((t) => t.tvdbSeason !== 1)) return null;
		cours.sort((a, b) => a.tvdbOffset - b.tvdbOffset || a.anidb - b.anidb);
		const cour = cours[season - 1];
		return cour ? [cour.season, episode + cour.offset] : null;
	}
	const past = entries.filter((t) => t.tvdbOffset < episode);
	const target = (past.length ? past : entries).reduce((a, b) =>
		past.length ? (b.tvdbOffset > a.tvdbOffset ? b : a) : b.tvdbOffset < a.tvdbOffset ? b : a
	);
	return [target.season, episode - target.tvdbOffset + target.offset];
}

/** Whether the release names the show and then a subtitle: `BLEACH.Thousand-Year.Blood.War` under Bleach is another series of it. */
function namesASubtitle(release: string, show: PlacementShow): boolean {
	const title = normalizeTitle(parseName(release).title);
	return show.names.some((name) => {
		const named = normalizeTitle(name);
		return named !== '' && title !== named && title.startsWith(`${named} `);
	});
}

/**
 * Where a show's file goes on TMDB, by the first rule that lands on an episode TMDB lists,
 * or null. `anime` is null when the index could not be loaded; `imdb` when the show has no
 * IMDb id.
 */
export async function placeFile(
	show: PlacementShow,
	anime: AnimeIndex | null,
	release: string,
	path: string,
	numbers: FileNumbers,
	imdb: ImdbLookup | null
): Promise<Placement | null> {
	const counts = new Map(show.seasons.map((row) => [row.season, row.episodes]));
	const fits = async (season: number, episode: number) => {
		if (!counts.has(season) || episode < 0) return false;
		const listed = await show.episodes(season);
		return listed
			? listed.some((row) => row.episode === episode)
			: episode >= 1 && episode <= counts.get(season)!;
	};
	const { season, episode } = numbers;
	const span = numbers.end === null ? 0 : numbers.end - episode;
	const placed = async (at: [number, number], how: PlacementRule): Promise<Placement | null> => {
		if (!(await fits(at[0], at[1]))) return null;
		const end = span > 0 && (await fits(at[0], at[1] + span)) ? at[1] + span : null;
		// an anime rule that lands where the name already said is the name's own numbering
		const own = how === 'anime' && at[0] === season && at[1] === episode;
		return { season: at[0], episode: at[1], episodeEnd: end, how: own ? 'tmdb' : how };
	};
	const file = path.split('/').pop() ?? path;
	const mapped = anime?.byShow.has(show.tmdbId) ? anime : null;

	// a fansub name its title maps; otherwise the name's numbers are its own (scene) ones
	let scene = true;
	// whether the number may be counted through the show's seasons (`absolute`)
	let counted = true;
	if (mapped && (fansubShaped(release) || fansubShaped(file))) {
		const hit = lookupAnime(mapped, release, file);
		// A fansub cour whose numbers TMDB does not list is not counted through the show when
		// its title found a special or a later cour: `[Holomux] Gintama° Love Potion Arc 01` is
		// an OVA the dataset files as a special TMDB no longer lists, not Gintama's first episode.
		counted = !(
			hit?.numbered &&
			(hit.target.season === 0 || hit.target.season > 1 || hit.target.offset > 0)
		);
		if (hit?.numbered && hit.target.tmdb === show.tmdbId) {
			scene = false;
			const found = await placed(animeNumbers(hit.target, season, episode), 'anime');
			if (found) return found;
		}
	}
	if (mapped && scene && season !== null && season > 0) {
		const tvdb = tvdbToTmdb(mapped, show.tmdbId, season, episode);
		const found = tvdb && (await placed(tvdb, 'anime'));
		if (found) return found;
	}
	if (season !== null) {
		const titled =
			numbers.coded || numbers.borrowed ? await byTitle(show, season, file, numbers) : null;
		const named = await placed(titled ? [season, titled] : [season, episode], 'tmdb');
		if (named) return named;
		if (season >= 1900) {
			const year = await ofYear(show, season, file);
			const found = year && (await placed(year, 'tmdb'));
			if (found) return found;
		}
		if (imdb && !namesASubtitle(release, show)) {
			const found = await imdb(season, episode);
			const answer = found && (await placed(found, 'imdb'));
			if (answer) return answer;
		}
	}
	return counted ? absolute(show, season, episode, Boolean(mapped), placed) : null;
}

/**
 * TMDB's episode for a year-numbered one (`MythBusters.S2004E18.Exploding.House`, TVDB's
 * numbering) by the title after the number, among the episodes TMDB lists as aired that
 * year: TMDB numbers MythBusters' seasons 1 to 16, and releases disagree about TVDB's year
 * numbers (`2005x21` is Escape Slide Parachute in one, MythBusters Revisited in another).
 */
async function ofYear(
	show: PlacementShow,
	year: number,
	file: string
): Promise<[number, number] | null> {
	const token = YEAR_EPISODE.exec(file);
	if (!token) return null;
	const aired = show.seasons.filter((row) => {
		const started = Number(row.airDate?.slice(0, 4));
		// specials too: TVDB's year holds the ones TMDB files as season 0
		return row.season === 0 || started === year || started === year - 1;
	});
	const lists = await Promise.all(aired.map((row) => show.episodes(row.season)));
	const found = titled(
		file.slice(token.index + token[0].length),
		aired.flatMap((row, n) =>
			(lists[n] ?? [])
				.filter((item) => item.airDate?.startsWith(String(year)))
				.map((item) => ({ ...item, season: row.season }))
		)
	);
	return found ? [found.season, found.episode] : null;
}

/** The candidate whose whole name (6 letters or more) the title starts with, the longest when several do. */
function titled<T extends { name: string }>(title: string, candidates: T[]): T | null {
	const text = fold(title.replace(EXTENSION, '').replace(BRACKETS, ' '));
	const named = candidates
		.map((item) => ({ item, name: fold(item.name) }))
		.filter(({ name }) => name.length >= 6 && text.startsWith(name))
		.sort((a, b) => b.name.length - a.name.length);
	return named.length && named[0].name.length > (named[1]?.name.length ?? 0)
		? named[0].item
		: null;
}

// What a pack's file name says before its title: `14. `, `1.01. `, `101a-b - `, `237-8 - `, `-01 `.
const TITLE_LEAD = /^-?\d+(?:\.\d+)?(?:[a-z](?:-[a-z])?|-\d{1,2})?\.?\s*(?:-\s+)?/;

/**
 * The TMDB episode a pack's file is titled as, in its season. TMDB files Courage the
 * Cowardly Dog, Phineas and Ferb and PAW Patrol by their 11-minute segments and their packs
 * by the half hour: `S1 (2007-9)/102a-b - The Fast and the Phineas; Lawn Gnome Beach Party`
 * is TMDB's episode "The Fast and the Phineas", not S1E2. The file's title must start with
 * one episode's whole name, the longest when several do. Only a number that is no name's own
 * notation is read so: a scene release's S02E05 is its own.
 */
async function byTitle(
	show: PlacementShow,
	season: number,
	file: string,
	numbers: FileNumbers
): Promise<number | null> {
	// a pack's code leads its title; a name that borrowed its season has its title after the
	// number: `Season 2/Episode 17 Climax` is My Hero Academia's S2E4 "Climax"
	const after = new RegExp(`(?<!\\d)0*${numbers.episode}(?!\\d)`).exec(file);
	const title = numbers.coded
		? file.replace(TITLE_LEAD, '')
		: after
			? file.slice(after.index + after[0].length)
			: '';
	return titled(title, (await show.episodes(season)) ?? [])?.episode ?? null;
}

/**
 * Files of a season folder numbered on from the season before it, as one run: [Anime Time]'s
 * `My Hero Academia Season 02/My Hero Academia - 14` is the season's first episode, the 14th
 * of the show. Read so only when the folder's lowest number is the first after every earlier
 * season's episodes; their season is then left to the absolute count.
 */
export function absoluteFolders(
	files: { folder: string | null; numbers: FileNumbers | null }[],
	seasons: TmdbSeason[]
): (FileNumbers | null)[] {
	const lowest = new Map<string, number>();
	const key = (f: { folder: string | null; numbers: FileNumbers | null }) =>
		f.numbers?.borrowed && f.numbers.season !== null && f.numbers.season > 1
			? `${f.folder}|${f.numbers.season}`
			: null;
	for (const file of files) {
		const at = key(file);
		if (at) lowest.set(at, Math.min(lowest.get(at) ?? Infinity, file.numbers!.episode));
	}
	return files.map((file) => {
		const at = key(file);
		if (!at) return file.numbers;
		const before = seasons
			.filter((row) => row.season > 0 && row.season < file.numbers!.season!)
			.reduce((sum, row) => sum + row.episodes, 0);
		return before > 0 && lowest.get(at) === before + 1
			? { ...file.numbers!, season: null }
			: file.numbers;
	});
}

/**
 * A number counted through TMDB's numbered seasons: one with no season, an anime's
 * `S01E1100`, or an anime's `S03E46` that is episode 46 of the show and the third season's
 * ninth. A western show's named season is never counted through: `Show - 101 - Title` in
 * `Season 1` is a code, not the 101st episode.
 */
async function absolute(
	show: PlacementShow,
	season: number | null,
	episode: number,
	anime: boolean,
	placed: (at: [number, number], how: PlacementRule) => Promise<Placement | null>
): Promise<Placement | null> {
	if (season !== null && !anime) return null;
	const numbered = show.seasons
		.filter((row) => row.season > 0)
		.sort((a, b) => a.season - b.season);
	// the season's nth episode as TMDB numbers it
	const nth = async (row: TmdbSeason, n: number): Promise<[number, number]> => [
		row.season,
		(await show.episodes(row.season))?.[n - 1]?.episode ?? n,
	];
	let before = 0;
	for (const row of numbered) {
		if (season !== null && season > 1 && row.season === season) {
			return episode > row.episodes && episode - before <= row.episodes
				? placed(await nth(row, episode - before), 'absolute')
				: null;
		}
		if ((season === null || season === 1) && episode <= before + row.episodes) {
			return placed(await nth(row, episode - before), 'absolute');
		}
		before += row.episodes;
	}
	return null;
}
