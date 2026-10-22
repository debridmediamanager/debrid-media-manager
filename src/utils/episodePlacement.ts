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

export type PlacementRule = 'tmdb' | 'anime' | 'imdb' | 'tvdb' | 'absolute';

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
	/** The release numbers this season from its start, so a number past its end is not the show's. */
	fromStart?: true;
	/** The show's running number, named beside the season and episode (`S11E01 - 286`). */
	running?: number;
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
	/** TMDB's episode for TVDB's season and episode, by the show's TVDB Order episode group. */
	tvdbOrder?: (season: number, episode: number) => Promise<[number, number] | null>;
}

export interface Placement {
	season: number;
	episode: number;
	episodeEnd: number | null;
	how: PlacementRule;
	/** The file's own title named this episode (not part of the API's answer). */
	titled?: true;
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
	const stripped = name.replace(LEADING_GROUPS, '');
	const parsed = ptt.parse(stripped);
	const seasons = parsed.seasons ?? [];
	// a fansub's version tag is no part of the title: ptt keeps `Mushishi v2.1` and `Mushishi 01v2`
	const title = (parsed.title ?? '').trim().replace(/(?:\s+|(?<=\d))v\d+(?:\.\d+)?$/i, '');
	// ptt reads the `Ru` of `Motto To Love-Ru` as Russian and drops it: a short word joined to
	// the title by a hyphen is the title's own
	const spaced = stripped.replace(/[._]/g, ' ');
	const glued =
		title && spaced.startsWith(title)
			? /^-\p{L}{1,3}(?![\p{L}\p{N}])/u.exec(spaced.slice(title.length))
			: null;
	return {
		title: glued ? title + glued[0] : title,
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
// `MLB_S6EP01_Climatiqueen`, `Seinfeld  (S01EP02)  The Stake Out`, `Grand.Blue.Season.3-09`, `Kingdom.4th.Season-21`.
const UNDERSCORE_SEASON_EP = /(?:^|[\s._\-([])S(\d{1,2})[._-]?EP?(\d{1,4})(?:[^\da-z]|$)/i;
// The second half of a double episode after it: `(S09EP23) plus EP24 The Finale`.
const PLUS_EP = /^[)\]]?\s*plus\s+EP?(\d{1,4})(?![\da-z])/i;
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
// `Détective Conan S11E01 - 286 [MULTI]`: the running number after the episode, nothing but tags after it.
const SCENE_RUNNING = /s\d{1,2}[\s._-]*e\d{1,3}\s+-\s+(\d{2,4})\s*(?=[[(]|$)/i;
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
		// and the run after it (`S04E17E18`, `S01E01-E03`): `Détective Conan S11E01 - 286` is
		// one episode and the show's running number, not episodes 1 to 286
		const named = new Set(pairs.filter(([s]) => s === season).map(([, e]) => e));
		let last = first;
		while (named.has(last + 1)) last++;
		const running = positive(SCENE_RUNNING.exec(name)?.[1]);
		return first < 1
			? null
			: {
					season,
					episode: first,
					end: last > first ? last : null,
					...(running ? { running } : {}),
				};
	}
	const underscored = UNDERSCORE_SEASON_EP.exec(name);
	const dashed = underscored ?? SEASON_DASH_EP.exec(name);
	if (dashed) {
		const season = positive(dashed[1] ?? dashed[2]);
		const episode = positive(dashed.at(-1));
		// the match ends on the character after the number, which may open `) plus EP24`
		const plus = underscored
			? positive(PLUS_EP.exec(name.slice(dashed.index + dashed[0].length - 1))?.[1])
			: null;
		const end = episode && plus && plus > episode ? plus : null;
		return season && episode ? { season, episode, end } : null;
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

/**
 * TMDB's numbers for a file of a series TVDB keeps as one season of cours, numbered by its
 * cours instead (`BLEACH.Thousand-Year.Blood.War.S04E01` is the Calamity's first, TMDB's
 * S2E41, TVDB's S17E41): the `season`th cour of the season the release's entry is in, when
 * the episode is within it.
 */
function courNumbers(
	index: AnimeIndex,
	show: number,
	hit: AnimeHit | null,
	season: number,
	episode: number
): [number, number] | null {
	if (!hit || hit.numbered) return null;
	const entry = hit.target;
	if (entry.tmdb !== show || entry.season < 1 || entry.tvdbSeason === null) return null;
	if (entry.tvdbSeason === season) return null;
	const cours = (index.byShow.get(show) ?? [])
		.filter((t) => t.tvdbSeason === entry.tvdbSeason && t.season === entry.season)
		.sort((a, b) => a.tvdbOffset - b.tvdbOffset || a.anidb - b.anidb);
	const [cour, next] = [cours[season - 1], cours[season]];
	if (cours.length < 2 || !cour || (next && episode > next.offset - cour.offset)) return null;
	return [cour.season, cour.offset + episode];
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
 * IMDb id. A file naming the show's running number beside its season and episode is placed
 * only where TMDB's count reaches that number: `Détective Conan S11E01 - 286`, numbered in
 * the French dub's seasons, is IMDb's S11E01 (TMDB's S1E271) by its first two numbers.
 */
export async function placeFile(
	show: PlacementShow,
	anime: AnimeIndex | null,
	release: string,
	path: string,
	numbers: FileNumbers,
	imdb: ImdbLookup | null
): Promise<Placement | null> {
	const found = await placeByRules(show, anime, release, path, numbers, imdb);
	if (!found || numbers.running === undefined || found.season < 1) return found;
	const before = show.seasons
		.filter((row) => row.season > 0 && row.season < found.season)
		.reduce((sum, row) => sum + row.episodes, 0);
	const listed = await show.episodes(found.season);
	const nth = listed
		? listed.findIndex((row) => row.episode === found.episode) + 1
		: found.episode;
	return before + nth === numbers.running ? found : null;
}

async function placeByRules(
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

	// a file's own title outranks its numbers: Firefly's DVD-ordered `S01E01.Serenity` is TMDB's S1E11
	const titledAt = await byName(show, numbers, file);
	const byTitle = titledAt && (await placed(titledAt, 'tmdb'));
	if (byTitle) return { ...byTitle, titled: true };

	// a fansub name its title maps; otherwise the name's numbers are its own (scene) ones
	let scene = true;
	// whether the number may be counted through the show's seasons (`absolute`)
	let counted = true;
	if (mapped && (fansubShaped(release) || fansubShaped(file))) {
		const hit = lookupAnime(mapped, release, file);
		// A fansub cour whose numbers TMDB does not list is not counted through the show when
		// its title found a special or a later cour: `[Holomux] Gintama° Love Potion Arc 01` is
		// an OVA the dataset files as a special TMDB no longer lists, not Gintama's first episode.
		// Nor is a title the index does not know, of a show the dataset files cour by cour in
		// several TMDB seasons: `[Some-Stuffs] Pocket Monsters - Aim to be a Pokémon Master 10`
		// is a series of its own, numbered from its own first, not Pokémon's tenth episode.
		counted = hit
			? !(
					hit.numbered &&
					(hit.target.season === 0 || hit.target.season > 1 || hit.target.offset > 0)
				)
			: new Set(
					mapped.byShow.get(show.tmdbId)!.flatMap((t) => (t.season > 0 ? [t.season] : []))
				).size < 2;
		if (hit?.numbered && hit.target.tmdb === show.tmdbId) {
			scene = false;
			const found = await placed(animeNumbers(hit.target, season, episode), 'anime');
			if (found) return found;
		}
	}
	if (mapped && scene && season !== null && season > 0) {
		const tvdb =
			tvdbToTmdb(mapped, show.tmdbId, season, episode) ??
			courNumbers(mapped, show.tmdbId, lookupAnime(mapped, release, file), season, episode);
		const found = tvdb && (await placed(tvdb, 'anime'));
		if (found) return found;
	}
	if (season !== null) {
		const named = await placed([season, episode], 'tmdb');
		if (named) return named;
		if (season >= 1900) {
			const year = await ofYear(show, season, file);
			const found = year && (await placed(year, 'tmdb'));
			if (found) return found;
		}
		// A file's title must agree with the episode IMDb's numbers lead to inside a season TMDB
		// has (`Friends.S06E24.The.One.with.the.Proposal.Part.1` is TMDB's S6E23); an untitled
		// one is checked against its release's other files by `keepImdbOrder`.
		if (imdb && !namesASubtitle(release, show)) {
			const title = counts.has(season) ? titleOf(file, numbers) : null;
			const found = await imdb(season, episode);
			const name =
				found && title
					? (await show.episodes(found[0]))?.find((row) => row.episode === found[1])?.name
					: null;
			const answer =
				found && (!title || (name && agrees(title, name))) && (await placed(found, 'imdb'));
			if (answer) return answer;
		}
		// TMDB numbers One Piece's seasons by absolute episode (S23 is 1156-1180) where TVDB and
		// Crunchyroll count each from 1, and start S22 three episodes sooner: the show's TVDB
		// Order group makes `One.Piece.1999.S23E25` TMDB's S23E1180
		const tvdb = show.tvdbOrder && (await show.tvdbOrder(season, episode));
		const ordered = tvdb && (await placed(tvdb, 'tvdb'));
		if (ordered) return ordered;
	}
	return counted && !numbers.fromStart
		? absolute(show, season, episode, Boolean(mapped), placed)
		: null;
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
	const title = titleText(file.slice(token.index + token[0].length));
	if (!title) return null;
	const found = titled(
		title,
		aired.flatMap((row, n) =>
			(lists[n] ?? [])
				.filter((item) => item.airDate?.startsWith(String(year)))
				.map((item) => ({ ...item, season: row.season }))
		)
	);
	return found ? [found.season, found.episode] : null;
}

/** A title's words: lowercase letters and digits, apostrophes dropped (`Don't` is `dont`). */
const words = (text: string) =>
	text
		.toLowerCase()
		.replace(/['’`]/g, '')
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
// TMDB's placeholders name no episode: `Episode 5` is in every season of some shows
const GENERIC = /^(?:episode|ep|part|chapter|folge|episodio|capitulo) \d+$/;
const wordsOf = new WeakMap<object, string>();

// What a release puts after the episode in place of a title, or after its title.
const RELEASE_WORDS =
	/^(?:proper|repack|rerip|real|internal|extended|uncut|uncensored|remastered|dubbed|subbed|multi|dual|end|fin|final)$/;
const SCENE_WORDS = /^(?:proper|repack|rerip|internal)$/;
const TAGS =
	/^(?:\d{3,4}[pi]|[248]k|(?:19|20)\d{2}|uhd|hdr|hdr10|dv|sdr|web|webrip|webdl|amzn|nf|dsnp|hmax|atvp|hulu|uktv|upscaled|bluray|bd|bdrip|brrip|brip|bdremux|remux|hdtv|hdtvrip|pdtv|dvd|dvdrip|dvdr|ws|x264|x265|h|h264|h265|hevc|avc|xvid|divx|aac|aac2|ac3|eac3|dts|ddp|ddp2|ddp5|dd|dd2|dd5|flac|opus|ita|eng|english|german|ger|french|fre|truefrench|vostfr|subfrench|spanish|spa|latino|rus|jap|japanese|kor|korean|chs|cht|hindi|nordic|multisub|\d+bit)$/;
// What separates a pack file's titles, or a title from what follows it: `Stinky Goes Hollywood -
// Olga Gets Engaged`, `One of Us; Vanishing Act`, `Pup Pup Boogie + Pups in a Fog`, `The Magic
// Tree Of Nowhere. Robot Randy`, `The Gimme Ghost[59E47EF7]`, `Eugene's.Birthday__Stinky's.Pumpkin`.
const SEGMENT = /\s+[-+]\s+|;|\.\s|__|--|[[(]/;
const LEADING_MARKS = /^[\s._\-)\]]*(?:[[(][^\])]*[\])][\s._-]*)*/;

/**
 * A title as a file names it, the whole and its first segment, each cut where the release's
 * tags begin (`Serenity.1080p.BRRip` is "serenity"); null when what follows the number is
 * tags alone (`S01E05.1080p.WEB.H264-GRP`).
 */
export function titleText(raw: string): { whole: string; first: string } | null {
	const cut = (text: string) => {
		const list = words(text);
		while (list.length && RELEASE_WORDS.test(list[0])) list.shift();
		const end = list.findIndex((word) => TAGS.test(word));
		const title = end < 0 ? list : list.slice(0, end);
		// and a scene word between the title and the tags: `S10E24.Kenny.the.Cat.REPACK.1080p`
		// (never `end` or `final`, which end titles: Gumball's "The End")
		while (title.length > 1 && SCENE_WORDS.test(title.at(-1)!)) title.pop();
		return title.join(' ');
	};
	const rest = raw.replace(EXTENSION, '').replace(LEADING_MARKS, '');
	const whole = cut(rest);
	return whole ? { whole, first: cut(rest.split(SEGMENT)[0]) } : null;
}

/**
 * The one candidate titled as the file is, word for word (so `The Beast that Shouted 'Love'`
 * is no "The Beast"): by its whole title, else by its first segment. Null when none is, or
 * two are (a "Pilot" in the specials and in season 1).
 */
function titled<T extends { name: string }>(
	title: { whole: string; first: string },
	candidates: T[]
): T | null {
	const keys = candidates.map((item) => {
		if (!wordsOf.has(item)) wordsOf.set(item, words(item.name).join(' '));
		const name = wordsOf.get(item)!;
		const usable = name.replace(/ /g, '').length >= 3 && !GENERIC.test(name);
		// spacing aside (`Bulletproof.Water` is "Bullet Proof Water"), and a part TMDB numbers
		// that the file does not (`Pirate.Special` is "Pirate Special (1)")
		return usable
			? [name.replace(/ /g, ''), name.replace(PART, '').replace(/ /g, '')]
			: ['', ''];
	});
	for (const text of new Set([title.whole, title.first])) {
		const key = text.replace(/ /g, '');
		for (const form of [0, 1]) {
			const found = candidates.filter((_, n) => keys[n][form] === key);
			if (found.length) return found.length === 1 ? found[0] : null;
		}
	}
	return null;
}

const PART = / (?:part |pt )?\d{1,2}$/;

/**
 * Whether the episode at a file's number is titled as the file is, one title holding the
 * other: `Would.I.Lie.To.You.S03E09.Unseen.bits` is TMDB's S3E9 "The Unseen Bits (Series 3)",
 * not S17E10 "Unseen Bits".
 */
function agrees(title: { whole: string; first: string }, name: string): boolean {
	// part numbers aside: `Chuck.Versus.the.Ring.2` is "Chuck Versus the Ring: Part 2"
	const bare = (text: string) => ` ${text.replace(PART, '')} `;
	const named = bare(words(name).join(' '));
	const usable = (text: string) => text.replace(/ /g, '').length >= 3;
	// the file's title inside TMDB's, or TMDB's inside the file's first segment: a pack file's
	// second segment (`102a-b - The Fast and the Phineas; Lawn Gnome Beach Party of Terror`) is
	// not the episode at its number
	return (
		[title.whole, title.first].some((text) => usable(text) && named.includes(bare(text))) ||
		(usable(title.first) && bare(title.first).includes(named))
	);
}

// What a pack's file name says before its title: `14. `, `1.01. `, `101a-b - `, `237-8 - `, `-01 `.
const TITLE_LEAD = /^-?\d+(?:\.\d+)?(?:[a-z](?:-[a-z])?|-\d{1,2})?\.?\s*(?:-\s+)?/;
// The episode token of a scene name, and further episodes of a multi-episode file after it.
const SCENE_TOKEN =
	/(?:^|[^a-z0-9])(?:s\d{1,2}[\s._-]*e\d{1,3}|\d{1,2}x\d{1,3}|s?(?:19|20)\d{2}[xe]\d{2})(?![0-9])/i;
const MORE_EPISODES = /^(?:[\s._-]*-?[\s._-]*e\d{1,3}(?![0-9]))*/i;

/** The title a file's name carries after its episode token, its code or its number. */
function titleOf(file: string, numbers: FileNumbers): { whole: string; first: string } | null {
	const stem = file.replace(EXTENSION, '');
	// a group's bracket is no episode token (`[0x539]`); it can be the number (`[Episode 19] …`)
	const grouped = stem.match(LEADING_GROUPS)?.[0].length ?? 0;
	const token = SCENE_TOKEN.exec(stem.slice(grouped));
	const number = new RegExp(`(?<!\\d)0*${numbers.episode}(?!\\d)`).exec(stem);
	const rest = token
		? stem.slice(grouped + token.index + token[0].length).replace(MORE_EPISODES, '')
		: numbers.coded
			? stem.replace(TITLE_LEAD, '')
			: number
				? stem.slice(number.index + number[0].length)
				: '';
	return titleText(rest);
}

/**
 * The TMDB episode a file's title names when the episode at its number is titled otherwise:
 * the named season's, else one of any season, specials included. Firefly's pack numbers its
 * files in DVD order (`S01E01.Serenity`, `S01E11.Trash`), TMDB in aired order with three
 * episodes as specials; TMDB files Phineas and Ferb by segment and its packs by the half hour
 * (`S1 (2007-9)/102a-b - The Fast and the Phineas`). A title that matches nothing, or two
 * episodes alike, leaves the number to the other rules.
 */
async function byName(
	show: PlacementShow,
	numbers: FileNumbers,
	file: string
): Promise<[number, number] | null> {
	const title = titleOf(file, numbers);
	if (!title) return null;
	const { season, episode } = numbers;
	const listed = season === null ? null : await show.episodes(season);
	const at = listed?.find((row) => row.episode === episode);
	if (at && agrees(title, at.name)) return [season!, episode];
	const inSeason = listed && titled(title, listed);
	if (inSeason) return [season!, inSeason.episode];
	const others = await Promise.all(
		show.seasons
			.filter((row) => row.season !== season)
			.map(async (row) =>
				((await show.episodes(row.season)) ?? []).map((item) => ({
					...item,
					season: row.season,
				}))
			)
	);
	const anywhere = titled(title, others.flat());
	return anywhere ? [anywhere.season, anywhere.episode] : null;
}

/**
 * A release's placements with every file its title did not place taken off an episode a
 * file's title did: Friends' `S06E17.The.One.with.Unagi` is TMDB's S6E16, so the pack's
 * `S06E16.The.One.That.Could.Have.Been.Part.2` is not, and its numbers place it nowhere.
 */
export function yieldToTitles(placements: (Placement | null)[]): (Placement | null)[] {
	const key = (p: Placement) => `${p.season}|${p.episode}`;
	const named = new Set(placements.flatMap((p) => (p?.titled ? [key(p)] : [])));
	return placements.map((p) => (p && !p.titled && named.has(key(p)) ? null : p));
}

/**
 * A release's placements with those the IMDb rule made taken back where they do not keep its
 * files' order. IMDb's order is not every release's: Firefly's DVD-ordered `S01E12`-`E14` (The
 * Message, Heart of Gold, Objects in Space) are IMDb's Heart of Gold, Trash and The Message,
 * which TMDB files as S0E3, S0E1 and S0E2; read by IMDb's numbers they come out scrambled.
 */
export function keepImdbOrder(
	numbers: (FileNumbers | null)[],
	placements: (Placement | null)[]
): (Placement | null)[] {
	const bySeason = new Map<number | null, number[]>();
	placements.forEach((p, at) => {
		if (p?.how !== 'imdb') return;
		const season = numbers[at]?.season ?? null;
		bySeason.set(season, [...(bySeason.get(season) ?? []), at]);
	});
	const refused = new Set<number>();
	for (const ats of bySeason.values()) {
		const ordered = [...ats].sort((a, b) => numbers[a]!.episode - numbers[b]!.episode);
		const keepsOrder = ordered.every((at, n) => {
			if (n === 0) return true;
			const [was, now] = [placements[ordered[n - 1]]!, placements[at]!];
			return (
				numbers[ordered[n - 1]]!.episode === numbers[at]!.episode ||
				now.season > was.season ||
				(now.season === was.season && now.episode > was.episode)
			);
		});
		if (!keepsOrder) ats.forEach((at) => refused.add(at));
	}
	return placements.map((p, at) => (refused.has(at) ? null : p));
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
	const before = (season: number) =>
		seasons
			.filter((row) => row.season > 0 && row.season < season)
			.reduce((sum, row) => sum + row.episodes, 0);
	// the release's lowest number in each season it names, among files numbered alike: Clannad's
	// `S02E22` beside `S02E23` numbers season 2 from its start, so E23 is no 23rd episode of the
	// show; Monster Rancher's `Season 3/… - 53v2 - …` beside `s03e02` is counted through it
	const alike = (n: FileNumbers) => `${n.season}|${n.borrowed ? 'folder' : 'name'}`;
	const first = new Map<string, number>();
	for (const { numbers } of files) {
		if (numbers?.season) {
			first.set(
				alike(numbers),
				Math.min(first.get(alike(numbers)) ?? Infinity, numbers.episode)
			);
		}
	}
	return files.map((file) => {
		const numbers = file.numbers;
		if (!numbers || numbers.season === null) return numbers;
		const earlier = before(numbers.season);
		const at = key(file);
		if (at && earlier > 0 && lowest.get(at) === earlier + 1)
			return { ...numbers, season: null };
		return numbers.season > 1 && first.get(alike(numbers))! <= earlier
			? { ...numbers, fromStart: true }
			: numbers;
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
