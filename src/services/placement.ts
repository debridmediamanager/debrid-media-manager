/**
 * What each release of a sponsor's library is and where its files go on TMDB, for
 * `/api/sponsor/place`: the release's movie or show (an IMDb id the caller knows, else
 * content-identifier's answer for its name), then each file's TMDB season and episode by the
 * rules in `@/utils/episodePlacement`. Every provider answer comes from DMM's caches.
 */
import { getFranchiseIndex, type FranchiseIndex } from '@/services/anime/animeFranchise';
import { getAnimeSynonyms } from '@/services/anime/animeSynonyms';
import {
	identifyFilenamesRemembered,
	refused,
	type IdentifierMatch,
	type IdentifierResult,
} from '@/services/contentIdentifier';
import type { ImdbSeries, NamesakeSeries } from '@/services/database/hashImdb';
import { settle, TMDB_TV_APPEND } from '@/services/metadata';
import { getMetadataCache } from '@/services/metadataCache';
import {
	isOnePace,
	onePaceCatalogue,
	placeOnePace,
	type OnePaceCatalogue,
} from '@/services/onePace';
import { repository } from '@/services/repository';
import {
	absoluteFolders,
	airDated,
	alignTvdb,
	buildAnimeIndex,
	fansubShaped,
	fileNumbers,
	keepImdbOrder,
	lookupAnime,
	normalizeTitle,
	numberedByTvdb,
	parseName,
	placeFile,
	specialOf,
	spelledAlike,
	stackedParts,
	TITLE_EPISODE,
	titleOf,
	titleText,
	yieldToTitles,
	type AlignedEpisode,
	type AnimeIndex,
	type FileNumbers,
	type ImdbLookup,
	type Placement,
	type PlacementRule,
	type PlacementShow,
	type TmdbSeason,
} from '@/utils/episodePlacement';
import { getTmdbAuth } from '@/utils/tmdbAuth';

/**
 * The rules an answer was placed by. Bump it with any change that places a release differently:
 * zurg asks again about every placement made under other rules, and otherwise keeps one a day
 * (a file left unplaced) or a week (a release placed whole), so a fix reached rex-fun's library
 * that much later (2026-10-22). Never bump it only because an answer gains a field: every
 * caller then asks about its whole library again, old builds included, which cannot read the
 * new field and gain nothing ('2026-10-25.1' for `tvdbId` sent fun's zurgs through 11,600
 * releases they discarded). A caller that starts reading a field decides for itself whether to
 * ask again (zurg's placementReader). Deploys that place nothing differently keep it.
 */
export const PLACEMENT_RULES = '2026-11-10.4';

export interface PlaceRequest {
	name: string;
	hash: string | null;
	imdbId: string | null;
	/** `folder`: where the provider lists the file inside the release, `""` at its top, null when unknown. */
	/**
	 * `duration`: the file's length in seconds, where the caller has probed it; it tells apart
	 * same-named shows whose episodes run differently.
	 */
	files: { path: string; folder: string | null; duration?: number }[];
	/** The caller reads `part`: a file may be placed as one part of TMDB's episode. */
	parts?: true;
	/** The caller reads a file's own show (`kind` `tv` on a file): a file may be placed on another show than its release's. */
	shows?: true;
}

export interface PlacedFile {
	path: string;
	season: number | null;
	episode: number | null;
	episodeEnd: number | null;
	how: PlacementRule | null;
	/**
	 * TMDB's own id for the episode, which Plex's episode rows carry as `tmdb://`: Plex numbers
	 * many shows otherwise than TMDB (Re:ZERO's TMDB S1E84 is Plex's S4E18). Null where the file
	 * is unplaced or placed on IMDb's numbering.
	 */
	tmdbEpisodeId: number | null;
	/**
	 * The file's part of TMDB's episode (1, 2, …), where it holds only one: TVDB's S04E14 of Lost
	 * is the second part of TMDB's S4E13. Null where the file is the whole episode; only for a
	 * request that sends `parts`.
	 */
	part?: number | null;
	/**
	 * A film inside a show's release, named on its own (`[Movie 02] Heroes Rising` in a My Hero
	 * Academia pack): `kind` `movie` with the film's ids, present only on such files. Or, for a
	 * request that sends `shows`, an episode of another show than the release's (`The New Batman
	 * Adventures - S01 E01 - Holiday Knights` in a Batman: The Animated Series pack): `kind` `tv`
	 * with that show's ids, the file's numbers being on it.
	 */
	kind?: 'movie' | 'tv';
	imdbId?: string;
	tmdbId?: number;
	/** That film's or show's TMDB title and year, which a client names its folder by. */
	title?: string;
	year?: number;
	/** That show's TheTVDB id and whether it is anime, as a release's `tvdbId` and `anime`. */
	tvdbId?: number;
	anime?: boolean;
	/** The file's episode of its release's `series`, present only on a file the series numbers. */
	series?: SeriesEpisode;
}

/**
 * A show no TMDB, IMDb or Plex record numbers, which DMM numbers itself (One Pace): a release's
 * files it numbers are this show's, whichever release holds them, grouped by `key`.
 */
export interface PlacedSeries {
	key: string;
	title: string;
	summary: string;
	poster?: string;
	art?: string;
	/** The seasons the release's numbered files are on. */
	seasons: { season: number; title: string; summary: string; poster?: string }[];
}

export interface SeriesEpisode {
	season: number;
	episode: number;
	title: string;
	summary: string;
	thumb?: string;
}

export interface PlacedRelease {
	kind: 'movie' | 'tv' | null;
	imdbId: string | null;
	tmdbId: number | null;
	/**
	 * TMDB's title and first year of the movie or show the ids name, for a client that files the
	 * release under a folder of its own (`Title (Year)`); absent where TMDB has none.
	 */
	title?: string;
	year?: number;
	/** The show's TheTVDB id as TMDB records it, which Plex's show rows carry as `tvdb://`; absent for a movie or where TMDB has none. */
	tvdbId?: number;
	/**
	 * Whether the show is anime, which zurg files under `__anime__`: TMDB lists it as Japanese
	 * animation (the Animation genre, 16, `original_language` `ja` and `JP` among
	 * `origin_country`, all three), or tags it with the keyword `anime` (Cyberpunk: Edgerunners,
	 * `en`; One Piece Log: Fish-Man Island Saga, no Animation genre). Absent for a movie, or
	 * where the show's TMDB record could not be read.
	 */
	anime?: boolean;
	/**
	 * The show DMM numbers itself that the release's files are episodes of, with `kind` and the
	 * ids null; absent for every other release.
	 */
	series?: PlacedSeries;
	files: PlacedFile[];
	/** Not placed in this request's time budget, or a source could not be asked; ask again. */
	skipped?: true;
}

/** A release's title as content-identifier named it. */
export interface Identified {
	imdbId: string;
	kind: 'movie' | 'tv';
}

/** What placement reads, so tests and the oracle replay can hand in captured answers. */
export interface PlacementSources {
	/** TMDB's `/find` for an IMDb id. */
	find(imdbId: string): Promise<any | null>;
	/**
	 * TMDB's show details (seasons with episode counts and air dates, names, external ids), or
	 * TMDB's 404 body (`status_code` 34) for a show it has deleted; null when it could not be asked.
	 */
	show(tmdbId: number): Promise<any | null>;
	/** TMDB's list of one season (`tv/{id}/season/{n}`). */
	season(tmdbId: number, season: number): Promise<any | null>;
	/** TMDB's names of one season in other languages (`tv/{id}/season/{n}/translations`); absent or null where it cannot be asked. */
	seasonTranslations?(tmdbId: number, season: number): Promise<any | null>;
	/** The show an IMDb episode id belongs to. */
	episodeShow(imdbId: string): Promise<string | null>;
	/** TMDB's episode groups of a show (`tv/{id}/episode_groups`). */
	episodeGroups(tmdbId: number): Promise<any | null>;
	/** One TMDB episode group with its episodes (`tv/episode_group/{id}`). */
	episodeGroup(id: string): Promise<any | null>;
	/** IMDb's episode ids of one season of a show, by episode number. */
	seasonEpisodes(showImdbId: string, season: number): Promise<Map<number, string>>;
	anime(): Promise<AnimeIndex | null>;
	/** TMDB's TV search for a title (`search/tv`). */
	searchTv(query: string): Promise<any | null>;
	/** TMDB's movie search for a title in a year (`search/movie`); absent or null where it cannot be asked. */
	searchMovie?(query: string, year?: number): Promise<any | null>;
	/** TMDB's external ids of a movie (`movie/{id}/external_ids`); absent or null where it cannot be asked. */
	movieIds?(tmdbId: number): Promise<any | null>;
	/** A series and its episodes as IMDb lists them (dmmdb's imdb_title_*); null when IMDb has no such title. */
	imdbSeries(imdbId: string): Promise<ImdbSeries | null>;
	/** The series IMDb titles exactly as this film or TV film (dmmdb's imdb_title_basics); absent or null where it cannot be asked. */
	namesakeSeries?(imdbId: string): Promise<NamesakeSeries[] | null>;
	/** content-identifier's own answers for these names, unjudged; null when it could not be asked. */
	identifier(names: string[]): Promise<Map<string, IdentifierResult> | null>;
	/** TheTVDB's series for an IMDb id (`search/remoteid`); absent or null where TVDB cannot be asked. */
	tvdbSeriesOf?(imdbId: string): Promise<number[] | null>;
	/** TheTVDB's series search for a title first aired in a year (`search`); absent or null where TVDB cannot be asked. */
	searchTvdb?(query: string, year: number): Promise<any[] | null>;
	/** A TheTVDB series' episodes in its default (aired) order, which Plex numbers by, or its DVD order. */
	tvdbEpisodes?(tvdbId: number, order?: 'dvd'): Promise<any[] | null>;
	/** TMDB's `/find` for a TheTVDB episode id; absent or null where it cannot be asked. */
	findTvdbEpisode?(tvdbEpisodeId: number): Promise<any | null>;
	/** One Pace's list; absent, the list DMM holds now. */
	onePace?(): OnePaceCatalogue;
}

/** Releases placed at once; each one's files go one after another, sharing its lookups. */
const CONCURRENCY = 4;

const unplaced = (path: string): PlacedFile => ({
	path,
	season: null,
	episode: null,
	episodeEnd: null,
	how: null,
	tmdbEpisodeId: null,
});

/** Names releases by their names (content-identifier); `undefined` where it could not be asked. */
export type Identify = (
	releases: { name: string; hash: string | null }[]
) => Promise<(Identified | null | undefined)[]>;

/** What DMM knows of a release's title; `tmdbId` is null where TMDB cannot use the id. */
interface Title {
	kind: 'movie' | 'tv' | null;
	imdbId: string | null;
	tmdbId: number | null;
	/** IMDb's episodes of a series TMDB cannot use, which the files are numbered on instead. */
	listed?: ImdbSeries;
}

/**
 * Each release's answer, in order. A release with no IMDb id, or one TMDB cannot use, is
 * named by its name. A release still waiting when `deadline` passes, or that needed an
 * identifier or a TMDB answer that could not be had, is skipped: `kind`, `imdbId`, `tmdbId`
 * and every file's numbers null, which zurg reads as "ask again", and `complete` is false.
 * A release looked at and not identified answers what DMM does know, such as the id sent.
 */
export async function placeReleases(
	releases: PlaceRequest[],
	identify: Identify,
	sources: PlacementSources,
	deadline: number
): Promise<{ releases: PlacedRelease[]; complete: boolean }> {
	const anime = await sources.anime();
	// One Pace is numbered by its own list alone: the id zurg holds for it (One Piece's) and its
	// name would place its files on One Piece's episodes
	const onePace = releases.map(isOnePace);
	const titles: (Title | null | undefined)[] = await Promise.all(
		releases.map((release, at) =>
			release.imdbId && !onePace[at] ? resolve(release.imdbId, null, release, sources) : null
		)
	);
	// a series IMDb numbers is the id sent, numbered there, never one its name reads as: the
	// identifier reads `Digimon.Adventure.02.E03` as TMDB's Digimon: Digital Monsters, whose
	// season 1 is the 1999 series
	const ask = releases.flatMap((_, at) =>
		!onePace[at] &&
		titles[at] !== undefined &&
		titles[at]?.tmdbId == null &&
		!titles[at]?.listed
			? [at]
			: []
	);
	if (ask.length) {
		const answers = await identify(ask.map((at) => releases[at]));
		await Promise.all(
			ask.map(async (at, n) => {
				const answer = answers[n];
				if (answer === undefined) titles[at] = undefined;
				else if (answer) {
					const named = await resolve(answer.imdbId, answer.kind, releases[at], sources);
					titles[at] = named && { ...named, kind: named.kind ?? answer.kind };
				}
			})
		);
	}
	const out: PlacedRelease[] = new Array(releases.length);
	let next = 0;
	const worker = async () => {
		while (next < releases.length) {
			const at = next++;
			const release = releases[at];
			if (onePace[at]) {
				out[at] = placeOnePace(release, sources.onePace?.() ?? onePaceCatalogue());
				continue;
			}
			// without the anime index a fansub cour would be placed on its own numbers
			// (`Hibike Euphonium 3 - 01` as season 1), so it waits for the index instead
			const waits =
				Date.now() > deadline ||
				titles[at] === undefined ||
				(!anime && [release.name, ...release.files.map((f) => f.path)].some(fansubShaped));
			out[at] = waits
				? skipped(release)
				: await placeRelease(release, titles[at] ?? null, sources, anime);
			if (!waits) out[at] = await seriesLook(release, out[at], sources, anime);
			if (!waits) out[at] = await secondLook(release, out[at], sources, anime);
			if (!waits) out[at] = await filmByTitle(release, out[at], sources);
			if (!waits) out[at] = await siblingLook(release, out[at], sources, anime);
			if (!waits) out[at] = await namesakeLook(release, out[at], sources, anime);
			if (!waits) out[at] = await tvdbNameLook(release, out[at], sources, anime);
			if (!waits) out[at] = await filmLook(release, out[at], sources);
			if (!waits) out[at] = await tvdbLook(out[at], sources);
			if (!waits) out[at] = await revivalLook(release, out[at], sources);
			if (!waits) out[at] = await spellingLook(release, out[at], sources);
			if (!waits) out[at] = await otherShowLook(release, out[at], sources, anime);
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	return { releases: out, complete: out.every((release) => !release.skipped) };
}

/**
 * TMDB's title and first year of a movie or show, and a show's TVDB id and whether it is anime,
 * from the record placement already read.
 */
async function tmdbTitle(
	kind: 'movie' | 'tv',
	imdbId: string | null | undefined,
	tmdbId: number | null | undefined,
	sources: PlacementSources
): Promise<{ title?: string; year?: number; tvdbId?: number; anime?: boolean }> {
	const record =
		kind === 'tv'
			? tmdbId == null
				? null
				: await sources.show(tmdbId)
			: imdbId
				? (await sources.find(imdbId))?.movie_results?.find((m: any) => m?.id === tmdbId)
				: null;
	const title = kind === 'tv' ? record?.name : record?.title;
	const year = Number(
		String((kind === 'tv' ? record?.first_air_date : record?.release_date) ?? '').slice(0, 4)
	);
	const tvdbId = kind === 'tv' ? Number(record?.external_ids?.tvdb_id) : 0;
	// all three fields, or the keyword: The Simpsons is Animation from the US, Alice in Borderland
	// Japanese live action, and neither is tagged anime; a record without `genres` (unread, or
	// TMDB's 404 for a deleted show) answers nothing
	const anime =
		kind === 'tv' && Array.isArray(record?.genres)
			? (record.genres.some((genre: any) => genre?.id === 16) &&
					record.original_language === 'ja' &&
					Array.isArray(record.origin_country) &&
					record.origin_country.includes('JP')) ||
				(Array.isArray(record.keywords?.results) &&
					record.keywords.results.some(
						(keyword: any) =>
							typeof keyword?.name === 'string' &&
							keyword.name.trim().toLowerCase() === 'anime'
					))
			: undefined;
	return {
		...(typeof title === 'string' && title.trim()
			? { title: title.trim(), ...(year > 0 ? { year } : {}) }
			: {}),
		...(Number.isInteger(tvdbId) && tvdbId > 0 ? { tvdbId } : {}),
		...(anime === undefined ? {} : { anime }),
	};
}

/**
 * The release's title and year (and a show's TVDB id and anime verdict), and those of each film placed inside it. Asked after placement,
 * from the records placement already read, so what a release is placed as never depends on it.
 */
export async function titled(
	placed: PlacedRelease,
	sources: PlacementSources
): Promise<PlacedRelease> {
	if (placed.skipped || !placed.kind || placed.tmdbId === null) return placed;
	const own = await tmdbTitle(placed.kind, placed.imdbId, placed.tmdbId, sources);
	const files = await Promise.all(
		placed.files.map(async (file) =>
			file.kind && file.tmdbId
				? { ...file, ...(await tmdbTitle(file.kind, file.imdbId, file.tmdbId, sources)) }
				: file
		)
	);
	return { ...placed, ...own, files };
}

const letters = (text = '') => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const unarticled = (text = '') => letters(text.replace(/^\s*(?:the|an?)\s+/i, ''));
const placesFiles = (answer: PlacedRelease) => answer.files.some((file) => file.season !== null);

/**
 * Plex's numbers for a show TMDB lists apart from the series TVDB files it under: TMDB keeps the
 * 2023 Kitchen Nightmares revival as a show of its own (235884, no TVDB id) and numbers
 * `Kitchen.Nightmares.2023.S02E03.Voleos` its S2E3, while TVDB, and Plex with it, keeps the
 * revival as seasons 7-9 of the 2007 series (80552), where it is S8E3 (zurg#285). Asked only of a
 * show TMDB gives no TVDB id. The series is one TVDB lists for the release's IMDb id, or the TVDB
 * id of a TMDB show of the same name; each placed episode is found there by its TMDB air date, a
 * date two episodes share by title. The release moves only when every placed file is found, on one
 * series alone, at other numbers; `tmdbEpisodeId` stays TMDB's, which Plex lists on no such row.
 */
async function tvdbLook(placed: PlacedRelease, sources: PlacementSources): Promise<PlacedRelease> {
	if (placed.skipped || placed.kind !== 'tv' || placed.tmdbId === null || !sources.tvdbEpisodes)
		return placed;
	const files = placed.files.filter((file) => file.season !== null);
	// ponytail: multi-episode files and IMDb's numbering keep the release as it is; map them when one turns up
	if (!files.length || files.some((f) => f.tmdbEpisodeId === null || f.episodeEnd !== null))
		return placed;
	const show = await sources.show(placed.tmdbId);
	if (!show?.name || show.external_ids?.tvdb_id) return placed;
	const tmdbEpisodes = new Map<number, any>();
	for (const season of new Set(files.map((file) => file.season as number)))
		for (const episode of (await sources.season(placed.tmdbId, season))?.episodes ?? [])
			tmdbEpisodes.set(episode?.id, episode);
	const named = ((await sources.searchTv(show.name))?.results ?? [])
		.filter(
			(row: any) => row?.id !== placed.tmdbId && letters(row?.name) === letters(show.name)
		)
		.slice(0, 5);
	const series = new Set<number>(
		placed.imdbId ? ((await sources.tvdbSeriesOf?.(placed.imdbId)) ?? []) : []
	);
	for (const row of named) {
		const tvdbId = Number((await sources.show(row.id))?.external_ids?.tvdb_id);
		if (Number.isInteger(tvdbId) && tvdbId > 0) series.add(tvdbId);
	}
	let found: { tvdbId: number; at: any[] } | null = null;
	for (const tvdbId of series) {
		const listed = ((await sources.tvdbEpisodes(tvdbId)) ?? []).filter(
			(episode: any) => episode?.seasonNumber > 0
		);
		const at = files.map((file) => {
			const tmdb = tmdbEpisodes.get(file.tmdbEpisodeId as number);
			const aired = tmdb?.air_date
				? listed.filter((episode: any) => episode?.aired === tmdb.air_date)
				: [];
			const hit =
				aired.length > 1
					? aired.filter((episode: any) => letters(episode?.name) === letters(tmdb.name))
					: aired;
			return hit.length === 1 ? hit[0] : null;
		});
		if (at.some((episode) => !episode) || new Set(at).size < at.length) continue;
		if (found) return placed;
		found = { tvdbId, at };
	}
	if (
		!found ||
		found.at.every(
			(episode, n) =>
				episode.seasonNumber === files[n].season && episode.number === files[n].episode
		)
	)
		return placed;
	const { tvdbId, at } = found;
	return {
		...placed,
		tvdbId,
		files: placed.files.map((file) => {
			const n = files.indexOf(file);
			return n < 0
				? file
				: { ...file, season: at[n].seasonNumber, episode: at[n].number, how: 'tvdbSeries' };
		}),
	};
}

/**
 * A release of a season TVDB lists under the show and TMDB as a show of its own, `tvdbLook` the
 * other way round: TVDB, and Plex with it, keeps The Wonderfully Weird World of Gumball (2025) as
 * The Amazing World of Gumball's season 7, which TMDB lists as 291904 with no TVDB id, so
 * `The.Amazing.World.of.Gumball.S07E01.The.Burger` named a season TMDB's 37606 does not have.
 * Each such file is found by its TVDB episode through TMDB's find. The release moves only where
 * it places nothing, every numbered file is of a season the show lacks, and all are found on one
 * other show TMDB records no TVDB id for: answered as `tvdbSeries`, with TVDB's numbers and TMDB's
 * episode ids.
 */
async function revivalLook(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources
): Promise<PlacedRelease> {
	if (
		placed.skipped ||
		placed.kind !== 'tv' ||
		placed.tmdbId === null ||
		placesFiles(placed) ||
		!sources.tvdbEpisodes ||
		!sources.findTvdbEpisode
	)
		return placed;
	const numbered = releaseNumbers(release).flatMap((numbers, at) =>
		numbers ? [{ numbers, at }] : []
	);
	if (!numbered.length) return placed;
	const show = await sources.show(placed.tmdbId);
	const tvdbId = Number(show?.external_ids?.tvdb_id);
	if (!(tvdbId > 0) || !Array.isArray(show?.seasons)) return placed;
	const listed = new Set((show.seasons as any[]).map((row) => row?.season_number));
	// ponytail: a multi-episode file keeps the release where it is; map both ends when one turns up
	if (
		numbered.some(
			({ numbers: n }) =>
				n.season === null || n.season < 1 || listed.has(n.season) || n.end !== null
		)
	)
		return placed;
	const episodes: any[] = (await sources.tvdbEpisodes(tvdbId)) ?? [];
	const found = await Promise.all(
		numbered.map(async ({ numbers: n }) => {
			const tvdb = episodes.find(
				(row) => row?.seasonNumber === n.season && row?.number === n.episode
			);
			const hit = Number.isInteger(tvdb?.id)
				? (await sources.findTvdbEpisode!(tvdb.id))?.tv_episode_results?.[0]
				: null;
			return Number.isInteger(hit?.show_id) && Number.isInteger(hit?.id) ? hit : null;
		})
	);
	const shows = new Set(found.map((hit) => hit?.show_id));
	const [other] = shows;
	if (found.some((hit) => !hit) || shows.size !== 1 || other === placed.tmdbId) return placed;
	const there = await sources.show(other);
	if (!there?.name || there.external_ids?.tvdb_id) return placed;
	const external = there.external_ids?.imdb_id;
	const files = [...placed.files];
	numbered.forEach(({ numbers: n, at }, k) => {
		files[at] = {
			...files[at],
			season: n.season,
			episode: n.episode,
			episodeEnd: null,
			how: 'tvdbSeries',
			tmdbEpisodeId: found[k].id,
		};
	});
	return {
		kind: 'tv',
		imdbId: typeof external === 'string' && /^tt\d{7,}$/.test(external) ? external : null,
		tmdbId: other,
		tvdbId,
		files,
	};
}

/**
 * The files of another show a show's release holds, each answered as that show's episode, for a
 * caller that reads them (`shows`): a release is placed whole on one show (`siblingLook`), and the
 * files left unplaced there may name another. A file is taken only where its own name, before its
 * numbers, names that show (its letters within the show's name), and on one other show alone:
 * - the show of a season TVDB lists under the release's series and TMDB as a show of its own, by
 *   TVDB's episode (`revivalLook`): Whose Line Is It Anyway (US)'s `S09E01 - Lauren Cohan` is the 2013
 *   revival (TMDB 64978), which TVDB numbers on as the 1998 series' season 9;
 * - a show the file's own title places it on (`titled`), one TMDB titles as the file's name where the
 *   release's show's name does not hold it (a Batman: The Animated Series pack's `The New Batman
 *   Adventures - S01 E01 - Holiday Knights`), or the one the id sent names, which the release was
 *   taken from (`Batman - 066 - Sideshow` in a pack of Batman TAS seasons 2-3 that most of its
 *   files place on The New Batman Adventures).
 * Each such file carries `kind` `tv` and that show's ids beside its numbers on it. Asked last, of
 * files no other rule placed, so the release and its other files stay as they are.
 */
async function otherShowLook(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources,
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	const own = placed.tmdbId;
	if (!release.shows || placed.skipped || placed.kind !== 'tv' || own === null) return placed;
	const shown = await sources.show(own);
	const names = (details: any) =>
		[details?.name, details?.original_name].map((name) => letters(name)).filter(Boolean);
	const single = release.files.length === 1;
	const left = release.files.flatMap((file, at) => {
		const numbers =
			placed.files[at].season === null && !placed.files[at].kind
				? fileNumbers(release.name, file.folder, file.path, single)
				: null;
		const stem = file.path.split('/').pop() ?? file.path;
		const show = numbers ? parseName(stem).title : '';
		const title = numbers && titleOf(stem, numbers);
		// the name before the numbers, never the title after them (`s03e02 - Journey to the Red Centre`)
		const named =
			letters(show).length >= 4 && !(title && letters(show).includes(letters(title.first)));
		return named ? [{ at, numbers: numbers!, show }] : [];
	});
	if (!left.length) return placed;
	const found = new Map<number, { answer: PlacedRelease; file: PlacedFile }[]>();
	const take = (rows: typeof left, answer: PlacedRelease, keep: (n: number) => boolean) =>
		rows.forEach(({ at }, n) => {
			if (answer.tmdbId === null || answer.tmdbId === own || !keep(n)) return;
			found.set(at, [...(found.get(at) ?? []), { answer, file: answer.files[n] }]);
		});
	const part = (rows: typeof left): PlaceRequest => ({
		...release,
		files: rows.map(({ at }) => release.files[at]),
	});
	const none = (asked: PlaceRequest): PlacedRelease => ({
		...placed,
		files: asked.files.map((file) => unplaced(file.path)),
	});
	const listed = new Set(((shown?.seasons as any[]) ?? []).map((row) => row?.season_number));
	const later = left.filter(
		({ numbers }) =>
			numbers.season !== null && numbers.season > 0 && !listed.has(numbers.season)
	);
	if (later.length) {
		const asked = part(later);
		const there = await revivalLook(asked, none(asked), sources);
		take(later, there, (n) => there.files[n].season !== null);
	}
	const shows = new Set<number>();
	const sent = release.imdbId ? await resolve(release.imdbId, 'tv', release, sources) : null;
	if (sent?.kind === 'tv' && sent.tmdbId !== null) shows.add(sent.tmdbId);
	for (const show of new Set(left.map((row) => row.show))) {
		if (names(shown).some((name) => name.includes(letters(show)))) continue;
		for (const row of ((await sources.searchTv(show))?.results ?? []).slice(0, 8))
			if (names(row).includes(letters(show)) && typeof row.id === 'number') shows.add(row.id);
	}
	shows.delete(own);
	const asked = part(left);
	for (const tmdbId of [...shows].slice(0, 8)) {
		const external = (await sources.show(tmdbId))?.external_ids?.imdb_id;
		const imdbId =
			typeof external === 'string' && /^tt\d{7,}$/.test(external) ? external : null;
		const there = await placeOnShow(
			asked,
			{ kind: 'tv', imdbId, tmdbId },
			false,
			sources,
			anime
		);
		const byTitle = titledEach.get(there) ?? [];
		if (!there.skipped) take(left, there, (n) => byTitle[n] && there.files[n].season !== null);
	}
	const files = [...placed.files];
	for (const { at, show } of left) {
		const hits = found.get(at) ?? [];
		if (new Set(hits.map((hit) => hit.answer.tmdbId)).size !== 1) continue;
		const [{ answer, file }] = hits;
		const other = await sources.show(answer.tmdbId!);
		// the file's own name names that show: one the release's show's name does not hold, the one
		// the id sent names, or the one TVDB numbers as the release's series
		const theirs = names(other).some((name) => name.includes(letters(show)));
		const ours = names(shown).some((name) => name.includes(letters(show)));
		if (!theirs || (ours && answer.tmdbId !== sent?.tmdbId && file.how !== 'tvdbSeries'))
			continue;
		files[at] = {
			...file,
			path: files[at].path,
			kind: 'tv',
			...(answer.imdbId ? { imdbId: answer.imdbId } : {}),
			tmdbId: answer.tmdbId!,
			...(answer.tvdbId ? { tvdbId: answer.tvdbId } : {}),
		};
	}
	return { ...placed, files };
}

/**
 * A file its release's show left unplaced whose title is TMDB's but for its spelling
 * (`spelledAlike`), in its own season or the one before or after: The Backyardigans' `S04E04
 * Attack of the 50 Foot Worman` is S4E12 "Attack of the Fifty-Foot Worman", The Crocodile Hunter's
 * `s03e02 - Journey to the Red Centre` S4E4 "Journey to the Red Center". Asked last, of the files
 * every other rule left unplaced, so it moves no file and decides no show; an episode another
 * file holds is not given twice.
 */
async function spellingLook(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources
): Promise<PlacedRelease> {
	const { tmdbId } = placed;
	if (placed.skipped || placed.kind !== 'tv' || tmdbId === null) return placed;
	// numbered as TVDB or IMDb do, not on TMDB's lists
	if (placed.files.some((file) => file.how === 'tvdbSeries' || file.how === 'imdb'))
		return placed;
	const single = release.files.length === 1;
	const asked = release.files.flatMap((file, at) => {
		const numbers =
			placed.files[at].season === null && !placed.files[at].kind
				? fileNumbers(release.name, file.folder, file.path, single)
				: null;
		const title =
			numbers?.season != null && numbers.end === null
				? titleOf(file.path.split('/').pop() ?? file.path, numbers)
				: null;
		return title ? [{ at, season: numbers!.season!, title: title.whole }] : [];
	});
	if (!asked.length) return placed;
	const listed = new Set(
		(((await sources.show(tmdbId))?.seasons as any[]) ?? []).map((row) => row?.season_number)
	);
	const lists = new Map<
		number,
		Promise<{ season: number; episode: number; name: string; id: unknown }[]>
	>();
	const episodes = (season: number) => {
		if (!lists.has(season))
			lists.set(
				season,
				sources.season(tmdbId, season).then((list) =>
					((list?.episodes as any[]) ?? []).flatMap((row) =>
						Number.isInteger(row?.episode_number) && typeof row.name === 'string'
							? [
									{
										season,
										episode: row.episode_number as number,
										name: row.name as string,
										id: row.id,
									},
								]
							: []
					)
				)
			);
		return lists.get(season)!;
	};
	const taken = new Set(
		placed.files.flatMap((file) =>
			file.season === null ? [] : [`${file.season}|${file.episode}`]
		)
	);
	const files = [...placed.files];
	for (const { at, season, title } of asked) {
		// specials only for a special
		const near = [season - 1, season, season + 1].filter(
			(n) => listed.has(n) && (n > 0 || season === 0)
		);
		const found = spelledAlike(title, (await Promise.all(near.map(episodes))).flat());
		const key = found && `${found.season}|${found.episode}`;
		if (!found || taken.has(key!)) continue;
		taken.add(key!);
		files[at] = {
			...files[at],
			season: found.season,
			episode: found.episode,
			how: 'tmdb',
			tmdbEpisodeId: Number.isInteger(found.id) ? (found.id as number) : null,
		};
	}
	return { ...placed, files };
}

/**
 * Another look at a release DMM could not name, or whose show holds none of its numbered
 * files: the identifier's own answers for the release's name and, when that names nothing,
 * for its first numbered file (`Season 3`, a folder of `Dragon Ball Z Abridged - S03E25 …`).
 * Each title it offers is checked by placing the files on it, and one is taken only if it
 * alone places them; a film only when the release has no numbered file and the title is the
 * name's own. The ids zurg sends come from DMM's hash map, which zurg fills from Plex's
 * matcher: `The.Magicians.S03` came as The Ancient Magus' Bride, `The.100.S04` as It's All
 * About the Looks, and their files placed nowhere on those shows.
 *
 * An answer below the identifier's 98% bar counts only when its title is the name's own by
 * letters, as `ReZERO.-Starting.Life.in.Another.World-.S04E13` reads Re: Zero - Starting
 * Life in Another World. That is a deterministic check, not a lower bar: lowering the bar
 * was measured to add answers right only ~40% of the time (2026-10-12), while a title
 * spelled as the name and a show holding the file's episode are two facts that agree.
 */
/**
 * The show a release's titled files name, when it is another show than the one it was placed
 * on: one TMDB lists under the same name (the 2003 PBS Berenstain Bears beside the 1985 CBS
 * one), one the identifier ranked beside it (`Batman - 086 - Holiday Knights` from a pack of
 * Batman TAS seasons 2-3 is The New Batman Adventures' S1E1), or a franchise show that holds a
 * title as a season (TMDB's Power Rangers numbers Dino Charge as its season 22, which TMDB's
 * find for Dino Charge's own IMDb id does not know). Taken only when most of the release's
 * titled files place on it by their titles, more than on the show it had: the release is
 * placed whole, so a pack that mixes two shows stays on the one most of it is.
 */
async function siblingLook(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources,
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	if (placed.skipped || placed.kind !== 'tv') return placed;
	const single = release.files.length === 1;
	const titled = release.files.filter((file) => {
		const numbers = fileNumbers(release.name, file.folder, file.path, single);
		return numbers && titleOf(file.path.split('/').pop() ?? file.path, numbers);
	}).length;
	const had = titledFiles.get(placed) ?? 0;
	// a release on IMDb's own list still looks for a show TMDB lists that its titles name as
	// well: Plex's agent knows Power Rangers Dino Charge only as Power Rangers' season 22, not by
	// Dino Charge's IMDb id (tt3521854), which IMDb lists as a series of its own
	const onImdb = placed.tmdbId === null && placesFiles(placed);
	if (titled < 2 || (had * 2 >= titled && !onImdb)) return placed;
	const shown = placed.tmdbId === null ? null : await sources.show(placed.tmdbId);
	const queries = [parseName(release.name).title, shown?.name].filter(
		(query): query is string => typeof query === 'string' && letters(query).length >= 3
	);
	const answer = (await sources.identifier([release.name]))?.get(release.name);
	const ranked = await Promise.all(
		(answer?.kind === 'tv' ? answer.matches.slice(0, 5) : []).map(
			async (match) => (await sources.find(match.imdbId))?.tv_results?.[0]?.id
		)
	);
	// a show TMDB names as the title or a part of it (Power Rangers in Power Rangers Dino Charge),
	// never one that only shares a word (Among Friends, Thomas & Friends for Friends)
	const searched = await Promise.all(
		[...new Set(queries.map((query) => query.toLowerCase()))].map(async (query) =>
			((await sources.searchTv(query))?.results ?? [])
				.filter((row: any) => {
					const name = letters(row?.name);
					return name.length >= 3 && letters(query).includes(name);
				})
				.slice(0, 5)
				.map((row: any) => row?.id)
		)
	);
	const shows = [...new Set([...ranked, ...searched.flat()])].filter(
		(id): id is number => typeof id === 'number' && id !== placed.tmdbId
	);
	let best = placed;
	let most = Math.max(had, Math.ceil(titled / 2) - 1, 1);
	for (const tmdbId of shows.slice(0, 8)) {
		const details = await sources.show(tmdbId);
		const external = details?.external_ids?.imdb_id;
		const imdbId =
			typeof external === 'string' && /^tt\d{7,}$/.test(external) ? external : null;
		const there = await placeOnShow(
			release,
			{ kind: 'tv', imdbId, tmdbId },
			false,
			sources,
			anime
		);
		const count = titledFiles.get(there) ?? 0;
		if (!there.skipped && (count > most || (onImdb && best === placed && count >= most)))
			[best, most] = [there, count];
	}
	return best;
}

/**
 * A show TMDB lists under the release's own title, by its name or a season's, when the show it
 * was placed on leaves numbered files unplaced: the id sent with `[HEVC] Nodame Cantabile
 * [Season 1]` is the 11-episode drama (34142), the 23 files the anime of that name (45527); TMDB
 * files `[Delta] Rascal Does Not Dream of Santa Claus S02` as season 2, "Rascal Does Not Dream of
 * Santa Claus", of Bunny Girl Senpai (82739), and that title's own show is a one-episode stub.
 * Taken only where one such show places more of the files than any other and than the one it had,
 * or, of those that place as many, is the one made for the service the name was taken from
 * (`streamedOn`). A release DMM named nothing is looked for so too: the identifier reads
 * `JoJos.Bizarre.Adventure.E25…` as a film, and of TMDB's two JoJo's Bizarre Adventure only the
 * 2012 series has an E25, not the 13-episode OVA of 1993.
 */
async function namesakeLook(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources,
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	const unnamed = !placed.kind && !placed.imdbId;
	if (placed.skipped || (!unnamed && (placed.kind !== 'tv' || placed.tmdbId === null)))
		return placed;
	const single = release.files.length === 1;
	const numbered = release.files.filter(
		(file) => fileNumbers(release.name, file.folder, file.path, single) !== null
	).length;
	const count = (answer: PlacedRelease) =>
		answer.files.filter((file) => file.season !== null).length;
	if (!numbered || count(placed) >= numbered) return placed;
	// a number by a day written year, month and day is a site's scene, no episode: `Freeze.25.03.21…`
	if (unnamed && SHORT_DATE.test(release.name)) return placed;
	const title = letters(parseName(release.name).title);
	if (title.length < 4) return placed;
	const named = ((await sources.searchTv(parseName(release.name).title))?.results ?? [])
		.map((row: any) => row?.id)
		.filter((id: unknown): id is number => typeof id === 'number' && id !== placed.tmdbId)
		.slice(0, 8);
	const better: PlacedRelease[] = [];
	for (const tmdbId of named) {
		const details = await sources.show(tmdbId);
		const names = [
			details?.name,
			details?.original_name,
			...((details?.seasons as any[]) ?? []).map((row) => row?.name),
		];
		if (!names.some((name) => typeof name === 'string' && letters(name) === title)) continue;
		const external = details?.external_ids?.imdb_id;
		const imdbId =
			typeof external === 'string' && /^tt\d{7,}$/.test(external) ? external : null;
		const there = await placeOnShow(
			release,
			{ kind: 'tv', imdbId, tmdbId },
			false,
			sources,
			anime
		);
		if (!there.skipped && count(there) > count(placed)) better.push(there);
	}
	const most = better.filter((there) => count(there) === Math.max(...better.map(count)));
	const made = most.length > 1 ? await streamedOn(release, most, sources) : most;
	const [best, ...tied] = made.length > 1 ? await runsAsLong(release, made, sources) : made;
	return best && !tied.length ? best : placed;
}

/**
 * A show TVDB finds by the release's title and year where TMDB's search cannot: TMDB names the
 * 1995 TBS drama Second Chance (130211) only `セカンド．チャンス`, with no English title, so
 * `Second.Chance.1995.dvdrip-xpost`'s `Second.Chance.01`-`12` found no show, while TVDB (342780)
 * names it Second Chance in English and links TMDB's id. Taken only for a release that places
 * nothing and whose name gives a year, where one TMDB show is linked from the TVDB series of that
 * title first aired that year, and that show places its files.
 */
async function tvdbNameLook(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources,
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	if (placed.skipped || placed.tmdbId !== null || placesFiles(placed) || !sources.searchTvdb)
		return placed;
	const { title, year } = parseName(release.name);
	if (!year || letters(title).length < 4) return placed;
	const shows = new Set<number>();
	for (const row of (await sources.searchTvdb(title, year)) ?? []) {
		const names = [row?.name, ...Object.values(row?.translations ?? {})];
		if (
			Number(row?.year) !== year ||
			!names.some((name) => typeof name === 'string' && letters(name) === letters(title))
		)
			continue;
		for (const remote of row?.remote_ids ?? [])
			if (remote?.sourceName === 'TheMovieDB.com' && Number(remote.id) > 0)
				shows.add(Number(remote.id));
	}
	if (shows.size !== 1) return placed;
	const [tmdbId] = shows;
	const external = (await sources.show(tmdbId))?.external_ids?.imdb_id;
	const imdbId = typeof external === 'string' && /^tt\d{7,}$/.test(external) ? external : null;
	const there = await placeOnShow(release, { kind: 'tv', imdbId, tmdbId }, false, sources, anime);
	return !there.skipped && placesFiles(there) ? there : placed;
}

/** How far a file's length may be from its episode's runtime on TMDB and still be that episode. */
const RUNTIME_SHARE = 0.2;

/**
 * Of shows a release places as well on, the one whose episodes run as long as its files, by the
 * lengths the caller sent: TMDB's two JoJo's Bizarre Adventure both hold an E01, and
 * `JoJos.Bizarre.Adventure.E01…`'s 24.2 minutes are the 2012 series' 24, not the 1993 OVA's 35
 * (zurg-usenet on fun, 2026-11-10). Narrowed only where every other show has a file running
 * further than RUNTIME_SHARE from the runtime TMDB lists for its episode (or episodes); a show
 * with no such runtime, a file sent without a length, or one placed as a part, rules out nothing.
 */
async function runsAsLong(
	release: PlaceRequest,
	shows: PlacedRelease[],
	sources: PlacementSources
): Promise<PlacedRelease[]> {
	const verdicts = await Promise.all(
		shows.map(async (there) => {
			let fits: boolean | null = null;
			for (const [at, file] of there.files.entries()) {
				const seconds = release.files[at]?.duration;
				if (!seconds || file.season === null || file.episode === null || file.part)
					continue;
				const list = (await sources.season(there.tmdbId!, file.season))?.episodes ?? [];
				let minutes = 0;
				for (let e = file.episode; e <= (file.episodeEnd ?? file.episode); e++) {
					const runtime = list.find((row: any) => row?.episode_number === e)?.runtime;
					if (typeof runtime !== 'number' || runtime <= 0) return null;
					minutes += runtime;
				}
				if (Math.abs(seconds / 60 - minutes) > RUNTIME_SHARE * minutes) return false;
				fits = true;
			}
			return fits;
		})
	);
	const fitting = shows.filter((_, at) => verdicts[at]);
	return fitting.length === 1 && verdicts.every((v) => v !== null) ? fitting : shows;
}

const SHORT_DATE = /(?<!\d)\d{2}([\s._-])(?:0[1-9]|1[0-2])\1(?:0[1-9]|[12]\d|3[01])(?!\d)/;

// The service a scene name says it was taken from, as TMDB's network id: `Kingdom.S02E02.1080p.NF.
// WEB-DL…-ExREN` is Netflix's Korean Kingdom, beside three other Kingdoms that hold an S02E02
const SERVICES: [RegExp, number][] = [
	[/(?:^|[\s._-])NF(?=[\s._-]|$)/i, 213], // Netflix
	[/(?:^|[\s._-])AMZN(?=[\s._-]|$)/i, 1024], // Prime Video
	[/(?:^|[\s._-])DSNP(?=[\s._-]|$)/i, 2739], // Disney+
	[/(?:^|[\s._-])ATVP(?=[\s._-]|$)/i, 2552], // Apple TV
	[/(?:^|[\s._-])HULU(?=[\s._-]|$)/i, 453], // Hulu
];

/** Of shows a release places as well on, those TMDB lists as made for the service its name says it was taken from. */
async function streamedOn(
	release: PlaceRequest,
	shows: PlacedRelease[],
	sources: PlacementSources
): Promise<PlacedRelease[]> {
	const network = SERVICES.find(([tag]) => tag.test(release.name))?.[1];
	if (network === undefined) return shows;
	const made = await Promise.all(
		shows.map(async (there) =>
			((await sources.show(there.tmdbId!))?.networks ?? []).some(
				(row: any) => row?.id === network
			)
		)
	);
	return shows.filter((_, at) => made[at]);
}

// A film a show's release carries beside its episodes: `[Movie 02] Heroes Rising`, `One Piece Movie
// 05 (2004) - The Cursed Holy Sword`, `Mask of The Phantasm (1993 - 1080p BluRay)`, a `Movies` folder.
// A title's words: a number (`Jujutsu Kaisen 0`), never an article (`Ranma ½: The Movie, Big Trouble…`).
const titleWords = (text: string) =>
	text
		.toLowerCase()
		.replace(/['’`]/g, '')
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => (word.length > 2 || /^\d+$/.test(word)) && word !== 'the');
const FILM_WORD = /(?:^|[^a-z])(?:movies?|films?)(?:[^a-z]|$)/i;
const FILM_YEAR = /[[(]\s*(?:19|20)\d{2}\b/;
const FILM_FOLDER = /(?:^|\/)[^/]*\b(?:movies?|films?|tv movies)\b[^/]*$/i;

/**
 * Each film of a show's release named on its own: a file left unplaced whose name or folder says
 * it is a film, asked about by its name with the show's title before it where the name lacks it,
 * and taken where the identifier is sure of a film, or its film is titled as the name by letters
 * in the year the name says, and TMDB's find knows the film.
 */
async function filmLook(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources
): Promise<PlacedRelease> {
	if (placed.skipped || placed.kind !== 'tv') return placed;
	const shown = placed.tmdbId === null ? null : await sources.show(placed.tmdbId);
	const show = shown?.name ?? parseName(release.name).title;
	const asked = placed.files.flatMap((file, at) => {
		if (file.season !== null) return [];
		const { path, folder } = release.files[at];
		const stem = (path.split('/').pop() ?? path).replace(/\.[a-z0-9]{2,4}$/i, '');
		// or a release's one file: `[Arid] Fate kaleid liner Prisma☆Illya Prisma☆Phantasm`
		const shaped =
			FILM_WORD.test(stem) ||
			FILM_YEAR.test(stem) ||
			FILM_FOLDER.test(folder ?? '') ||
			release.files.length === 1;
		if (!shaped) return [];
		const own = stem.replace(/^\s*(?:\[[^\]]*\][\s._-]*)+/, '');
		const name = letters(own).includes(letters(show)) ? own : `${show} ${own}`;
		return [{ at, name }];
	});
	if (!asked.length) return placed;
	const answers = await sources.identifier([...new Set(asked.map((a) => a.name))]);
	const files = [...placed.files];
	for (const { at, name } of asked) {
		const answer = answers?.get(name);
		const top = answer?.matches[0];
		if (!answer || !top || answer.kind !== 'movie' || refused(name, answer)) continue;
		const spelled =
			letters(top.title) === letters(answer.parsedTitle) &&
			(!answer.parsedYear || !top.year || Math.abs(answer.parsedYear - top.year) <= 1);
		if (!answer.confident && !spelled) continue;
		// the film's own title in the name, the show's words aside: `Beavis and Butt-Head {1995}
		// Virtual Stupidity` is no Beavis and Butt-Head Do America, and the Six Million Dollar Man's
		// three pilot films all read as the one titled as the show
		// or, the film's words and number left out, as the name may leave them (`Ranma ½: The Movie 2,
		// Nihao My Concubine` is `Ranma_½_Movie_Nihao_My_Concubine`)
		const named = titleWords(name);
		const holds = (title: string) => {
			const own = titleWords(title).filter((word) => !titleWords(show).includes(word));
			return own.length > 0 && own.every((word) => named.includes(word));
		};
		if (!holds(top.title) && !holds(top.title.replace(/\b(?:movie|film)s?\s*\d*/gi, ' ')))
			continue;
		const movie = (await sources.find(top.imdbId))?.movie_results?.[0]?.id;
		if (typeof movie !== 'number') continue;
		files[at] = { ...files[at], kind: 'movie', imdbId: top.imdbId, tmdbId: movie };
	}
	// else TMDB's one film titled as the show and the words the file names beyond it, in the year the
	// name gives if it does: `[Anime Time] Fairy Tail - Movie 01 - Dragon Cry` is "Fairy Tail: Dragon
	// Cry", `[SubsPlease] Kaijuu 8-gou - Mission Recon` "Kaiju No. 8: Mission Recon" (a fansub's title
	// before its first ` - ` is the show's, however it spells it)
	for (const { at } of asked) {
		if (files[at].kind || !sources.searchMovie || !sources.movieIds) continue;
		const stem = (release.files[at].path.split('/').pop() ?? release.files[at].path)
			.replace(/\.[a-z0-9]{2,4}$/i, '')
			.replace(/^\s*(?:\[[^\]]*\][\s._-]*)+/, '');
		const dashed = fansubShaped(release.files[at].path) ? stem.split(' - ') : [];
		const own = filmWords(dashed.length > 1 ? dashed.slice(1).join(' - ') : stem, show);
		if (letters(own).length < 4) continue;
		const { year } = parseName(stem);
		const yearOf = (row: any) => Number(String(row?.release_date ?? '').slice(0, 4));
		// a name with no year that says no film names only one titled with the show's name too:
		// `Rivales [HDTV] 1080p][Cap.208]`, sent with Rivals' id, is no part of the 2008 film Rivales
		const withShow = (title: string) => {
			const all = new Set(titleText(title)?.whole.split(' ') ?? []);
			return (titleText(show)?.whole.split(' ') ?? []).every((word) => all.has(word));
		};
		const found = (
			(await sources.searchMovie(`${show} ${own}`, year ?? undefined))?.results ?? []
		).filter(
			(row: any) =>
				typeof row?.title === 'string' &&
				filmWords(row.title, show) === own &&
				(year
					? Math.abs(yearOf(row) - year) <= 1
					: FILM_WORD.test(stem) || withShow(row.title))
		);
		const imdbId = found.length === 1 ? (await sources.movieIds(found[0].id))?.imdb_id : null;
		if (typeof imdbId === 'string' && /^tt\d{7,}$/.test(imdbId))
			files[at] = { ...files[at], kind: 'movie', imdbId, tmdbId: found[0].id };
	}
	return { ...placed, files };
}

/**
 * A film's title as words, the show's, a film's words and its number in the series, an episode token
 * and the release's tags left out: `Movie 01 - Dragon Cry` and "Fairy Tail: Dragon Cry" are both
 * `dragon cry` beside Fairy Tail.
 */
function filmWords(text: string, show: string): string {
	const shown = new Set(titleText(show)?.whole.split(' ') ?? []);
	const list = (titleText(text.replace(/[[(][^\])]*[\])]/g, ' '))?.whole ?? '').split(' ');
	return list
		.filter(
			(word, n) =>
				word &&
				!shown.has(word) &&
				!/^(?:movies?|films?|the|an?)$/.test(word) &&
				!/^s\d{1,2}e\d{1,3}$/.test(word) &&
				!(/^\d+$/.test(word) && /^(?:movies?|films?)$/.test(list[n - 1] ?? ''))
		)
		.join(' ');
}

async function secondLook(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources,
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	const single = release.files.length === 1;
	const numbered = release.files.filter(
		(file) => fileNumbers(release.name, file.folder, file.path, single) !== null
	);
	const unnamed = placed.tmdbId === null;
	// files placed by their numbers alone, while their titles name none of the episodes there, are
	// not that show's: `Season 3` came with Chihayafuru's episode tt2741248, and Dragon Ball Z
	// Abridged's `S03E01 - There's Something About Maron` landed on Chihayafuru's S3E1
	const titled = numbered.filter((file) => {
		const numbers = fileNumbers(release.name, file.folder, file.path, single);
		return numbers && titleOf(file.path.split('/').pop() ?? file.path, numbers);
	}).length;
	const untitled = titled >= 2 && (titledFiles.get(placed) ?? 0) === 0;
	if (
		placed.skipped ||
		(unnamed && placesFiles(placed)) ||
		(!unnamed &&
			(placed.kind !== 'tv' || !numbered.length || (placesFiles(placed) && !untitled)))
	) {
		return placed;
	}
	const file = numbered[0]?.path
		.split('/')
		.pop()
		?.replace(/\.[a-z0-9]{2,4}$/i, '');
	const names = [...new Set([release.name, ...(file ? [file] : [])])];
	const answers = await sources.identifier(names);
	for (const name of names) {
		const answer = answers?.get(name);
		const top = answer?.matches[0];
		if (!answer || !top || !answer.kind || refused(name, answer)) continue;
		// a title the name only spells, with no other fact behind it, never overrides the id sent:
		// `Batman - 086 - Holiday Knights` spells the 1966 Batman, whose season 2 has an E52
		if (!answer.confident && !unnamed) continue;
		// the title as the identifier read the name, or as DMM does where the identifier runs on past
		// it: `Would.I.Lie.to.You-S16E03-Shirley.Ballas…` is one title to the identifier, and
		// `[philosophy-raws][Samurai Champloo][26]…` none
		const spelled = [answer.parsedTitle, parseName(name).title]
			.flatMap((title = '') => [title, title.replace(TITLE_EPISODE, '')])
			.map((title) => letters(title))
			.filter((title) => title.length >= 3);
		const own = (match: IdentifierMatch) => spelled.includes(letters(match.title));
		const leading = answer.matches.findIndex((match) => !own(match));
		const offered = answer.confident
			? [top]
			: answer.matches
					.slice(0, leading === -1 ? undefined : leading)
					.filter(
						(match) =>
							!(
								answer.kind === 'movie' &&
								answer.parsedYear &&
								match.year &&
								Math.abs(answer.parsedYear - match.year) > 1
							)
					);
		// a title IMDb spells otherwise than the name and TMDB as it, among the identifier's: `KonoSuba`
		// is an alternative title of TMDB's KONOSUBA - God's blessing on this wonderful world!,
		// `Teasing Master Takagi-san` TMDB's name for IMDb's Karakai Jouzu no Takagi-san, and `Would I
		// Lie To You AU` the Australian show's, which the identifier ranks below the British one
		if (!offered.length && answer.kind === 'tv' && spelled.length) {
			for (const match of answer.matches.slice(0, 5)) {
				const tv = (await sources.find(match.imdbId))?.tv_results?.[0]?.id;
				const shown = typeof tv === 'number' ? await sources.show(tv) : null;
				const names = [
					shown?.name,
					shown?.original_name,
					...((shown?.alternative_titles?.results as any[]) ?? []).map(
						(row) => row?.title
					),
				];
				if (names.some((name) => spelled.includes(letters(name)))) offered.push(match);
			}
		}
		if (answer.kind === 'movie') {
			if (!unnamed || numbered.length || offered.length !== 1) continue;
			const title = await resolve(offered[0].imdbId, 'movie', release, sources);
			if (title?.kind === 'movie' && title.tmdbId !== null) {
				return { ...title, files: release.files.map((f) => unplaced(f.path)) };
			}
			continue;
		}
		const tried: PlacedRelease[] = [];
		for (const match of offered) {
			const title = await resolve(match.imdbId, 'tv', release, sources);
			if (
				title?.kind !== 'tv' ||
				(title.tmdbId === null && !title.listed) ||
				(title.tmdbId ?? title.imdbId) === (placed.tmdbId ?? placed.imdbId)
			)
				continue;
			const there = await placeRelease(release, title, sources, anime);
			const show = (answer: PlacedRelease) => answer.tmdbId ?? answer.imdbId;
			// two titles can land on one show: the 2024 drama Teasing Master Takagi-san, holding no
			// season 2, hands `S02E01` to the anime index's show, the anime the identifier ranked first
			if (!there.skipped && placesFiles(there) && !tried.some((t) => show(t) === show(there)))
				tried.push(there);
		}
		if (tried.length === 1) return tried[0];
		// shows titled alike that both hold the files' numbers (Animaniacs of 1993 and of 2020): the
		// one whose episodes the files' titles name, at their own numbers before elsewhere (Fruits
		// Basket of 2019 lists "Let's Go Home" as S1E24, that of 2001 as S1E26)
		const rank = (there: PlacedRelease) =>
			(agreedFiles.get(there) ?? 0) * (release.files.length + 1) +
			(titledFiles.get(there) ?? 0);
		const [best, next] = tried.map(rank).sort((a, b) => b - a);
		if (best > 0 && best > next) return tried.find((there) => rank(there) === best)!;
		// the id sent placed nothing and the identifier is sure of another title, which TMDB
		// cannot number the files on either: that title, unplaced, rather than one it is not
		if (answer.confident && !unnamed && !tried.length) {
			// TMDB's find knows neither Dragon Ball Z Abridged nor Power Rangers Dino Charge
			const title = await resolve(top.imdbId, 'tv', release, sources);
			// a sequel TMDB files under its show is no other title: `Mushishi Zoku Shou` is Mushi-Shi's
			// season 2, `Monogatari Series Second Season` Monogatari's
			const shown = placed.tmdbId === null ? null : await sources.show(placed.tmdbId);
			const own = [shown?.name, shown?.original_name]
				.map((name) => letters(name))
				.filter(Boolean);
			const sequel = own.some(
				(name) => letters(top.title).includes(name) || name.includes(letters(top.title))
			);
			if (
				title &&
				!sequel &&
				(title.kind ?? 'tv') === 'tv' &&
				title.imdbId !== placed.imdbId &&
				title.tmdbId !== placed.tmdbId
			) {
				return { ...title, kind: 'tv', files: release.files.map((f) => unplaced(f.path)) };
			}
		}
		// a file is asked about only when the release's own name names nothing: `The Avengers (EMH)
		// - S01 E15` in Earth's Mightiest Heroes' pack reads as the 1961 Avengers
		if (answer.confident || offered.length) break;
	}
	return placed;
}

/**
 * A film neither the id sent nor the identifier names, by TMDB's search for the name's title in
 * the year it gives: the identifier reads Chaplin's `The.Bank.1915…` as the 2018 series The Bank
 * and `The.Immigrant.1917…` as the 2013 film, where TMDB's search for the title in that year finds
 * the 1915 and 1917 shorts. Only for a release DMM knows nothing of, with no numbered file, and
 * only where one film of that year (a year either way, where none is of it) is titled as the name
 * by letters, under its title or else its original title (`Macbeth.2010` is the English TV film,
 * not the Polish `Makbet` TMDB also titles Macbeth), and TMDB knows its IMDb id. A release placed
 * on a show that first aired after that year is no episode of it either (`laterShow`).
 */
async function filmByTitle(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources
): Promise<PlacedRelease> {
	if (placed.skipped || !sources.searchMovie || !sources.movieIds) return placed;
	if (releaseNumbers(release).some(Boolean)) return placed;
	const { title, year } = parseName(release.name);
	if (!year || letters(title).length < 3) return placed;
	if ((placed.kind || placed.imdbId) && !(await laterShow(placed, year, sources))) return placed;
	const yearOf = (row: any) => Number(String(row?.release_date ?? '').slice(0, 4));
	const results: any[] = (await sources.searchMovie(title, year))?.results ?? [];
	const near = results.filter((row) => Math.abs(yearOf(row) - year) <= 1);
	const titledAs = (spell: (text: string) => string) =>
		near.filter((row) =>
			[row?.title, row?.original_title].some((text) => spell(text) === spell(title))
		);
	// a leading article only where nothing is titled as the name: `Burlesque.on.Carmen.1915` is A
	// Burlesque on Carmen; the title before its colon only where neither is: `Berlin.1927` is Berlin:
	// Symphony of a Great City, `Puffs.2018` Puffs: Filmed Live Off Broadway
	const titled =
		[letters, unarticled, (text = '') => letters(text.split(':')[0])]
			.map(titledAs)
			.find((rows) => rows.length) ?? [];
	const exact = titled.filter((row: any) => yearOf(row) === year);
	let found = exact.length ? exact : titled;
	if (found.length > 1)
		found = found.filter((row: any) => letters(row?.original_title) === letters(title));
	if (found.length !== 1) return placed;
	const imdbId = (await sources.movieIds(found[0].id))?.imdb_id;
	if (typeof imdbId !== 'string' || !/^tt\d{7,}$/.test(imdbId)) return placed;
	const files = release.files.map((file) => unplaced(file.path));
	const film = await resolve(imdbId, 'movie', release, sources);
	if (film?.kind === 'movie' && film.tmdbId !== null) return { ...film, files };
	// TMDB's film of an IMDb id IMDb lists as an episode, which resolves to its series:
	// `Falsettos.2017` is IMDb's episode of Live from Lincoln Center and TMDB's film of it alone
	const own = ((await sources.find(imdbId))?.movie_results ?? []).some(
		(row: any) => row?.id === found[0].id
	);
	return own ? { kind: 'movie', imdbId, tmdbId: found[0].id, files } : placed;
}

/**
 * Whether a release of no numbered file was placed on a show that first aired after the year its
 * name gives, and holds none of it: the ids zurg sent with `Wings.1927…`, `The.Great.Train.Robbery.1903…`
 * and `Behind.The.Screen.1916…` name the 1990 sitcom, the 2013 miniseries and the 1981 soap.
 */
async function laterShow(
	placed: PlacedRelease,
	year: number,
	sources: PlacementSources
): Promise<boolean> {
	if (placed.kind !== 'tv' || placed.tmdbId === null || placesFiles(placed)) return false;
	const aired = (await sources.show(placed.tmdbId))?.first_air_date;
	return Number(String(aired ?? '').slice(0, 4)) > year + 1;
}

/**
 * A miniseries whose id names its namesake film: DMM's hash map gave `Shogun 1980 1080p WEBRip
 * x264 [i_c]` (`Shogun 1980 Episode 1`-`4`) tt0083069, the 1980 TV film, and its name lookup `The
 * Last Place on Earth` (`Last Place on Earth 1 Poles Apart`-`7 Rejoice`) tt0218390, the 2002
 * film, where both are IMDb's miniseries of those titles (tt0080274, tt0088551), and rex filed
 * each episode as a film (2026-11-03). A release of numbered episodes placed as no show goes to
 * the one series IMDb titles as its film, in the year the release names, where TMDB places files.
 */
async function seriesLook(
	release: PlaceRequest,
	placed: PlacedRelease,
	sources: PlacementSources,
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	if (placed.skipped || placed.kind === 'tv' || !placed.imdbId || !sources.namesakeSeries) {
		return placed;
	}
	const episodes = new Set(releaseNumbers(release).map((n) => n?.episode ?? null));
	episodes.delete(null);
	if (episodes.size < 2) return placed;
	const { year } = parseName(release.name);
	const series = ((await sources.namesakeSeries(placed.imdbId)) ?? []).filter(
		({ startYear, endYear }) =>
			year === null ||
			(startYear !== null && year >= startYear - 1 && year <= (endYear ?? startYear) + 1)
	);
	if (series.length !== 1) return placed;
	const title = await resolve(series[0].imdbId, 'tv', release, sources);
	if (title?.kind !== 'tv' || (title.tmdbId === null && !title.listed)) return placed;
	const there = await placeRelease(release, title, sources, anime);
	return !there.skipped && placesFiles(there) ? there : placed;
}

// `Last Place on Earth 1 Poles Apart`: the title, then the episode's number and its own title
const COUNTED = /^(.*?\S)[\s._-]+(\d{1,3})(?:[\s._-]+\S.*)?$/;
// `Part 2`, `Disc 2` and `cd2` number no episode
const PARTED = /(?:^|[\s._-])(?:pt|part|prt|cd|disc|disk|vol|volume)$/i;

/**
 * Episodes a release numbers only beside its title, 1 to n with one file each, where no file's
 * name numbers it otherwise: `Last Place on Earth 1 Poles Apart`-`7 Rejoice`. Null for any other.
 */
function countedRun(release: PlaceRequest): FileNumbers[] | null {
	const show = letters(parseName(release.name).title);
	if (release.files.length < 2 || show.length < 4) return null;
	if (release.files.some((f) => fileNumbers(release.name, f.folder, f.path, false))) return null;
	const read = release.files.map((f) =>
		COUNTED.exec((f.path.split('/').pop() ?? f.path).replace(/\.[a-z0-9]{2,4}$/i, ''))
	);
	if (read.some((found) => !found || PARTED.test(found[1]))) return null;
	const heads = new Set(read.map((found) => letters(found![1])));
	const [head] = heads;
	if (heads.size !== 1 || head.length < 4 || !(show.includes(head) || head.includes(show))) {
		return null;
	}
	const episodes = read.map((found) => Number(found![2]));
	if (new Set(episodes).size !== episodes.length) return null;
	if (Math.min(...episodes) !== 1 || Math.max(...episodes) !== episodes.length) return null;
	return episodes.map((episode) => ({ season: null, episode, end: null }));
}

/** Each file's numbers, as its name gives them or a counted run of the release does. */
function releaseNumbers(release: PlaceRequest): (FileNumbers | null)[] {
	return (
		countedRun(release) ??
		release.files.map((f) => fileNumbers(release.name, f.folder, f.path, false))
	);
}

/** The answer zurg reads as "skipped, ask again": nothing known, every file unplaced, in order. */
function skipped(release: PlaceRequest): PlacedRelease {
	return {
		kind: null,
		imdbId: null,
		tmdbId: null,
		files: release.files.map((file) => unplaced(file.path)),
		skipped: true,
	};
}

/**
 * The movie or show an IMDb id names on TMDB. `tmdbId` is null when TMDB cannot use the id:
 * its find knows nothing by it, or it is a film while the release's files name seasons (DMM's
 * hash map files Star Wars: The Clone Wars S02 under the 2008 film). Undefined when TMDB could
 * not be asked.
 */
async function resolve(
	given: string,
	identified: 'movie' | 'tv' | null,
	release: PlaceRequest,
	sources: PlacementSources
): Promise<Title | undefined> {
	// DMM's hash map files a season pack under one of its episodes (Arrow's pilot for the series)
	const show = await sources.episodeShow(given);
	const imdbId = show ?? given;
	const found = await sources.find(imdbId);
	if (!found) return undefined;
	const tv = found.tv_results?.[0]?.id ?? found.tv_episode_results?.[0]?.show_id;
	const movie = found.movie_results?.[0]?.id;
	// files numbered as a run of episodes are no film either: zurg sent tt0117579, the 1996 film
	// Second Chance, for `Second.Chance.1995.dvdrip-xpost`'s `Second.Chance.01`-`12`, and rex-fun
	// showed eleven copies of it (2026-11-01); `Part 2`, `Disc 2` and `cd2` number no episode
	const numbers = releaseNumbers(release);
	const episodes = new Set(numbers.map((n) => n?.episode).filter((n) => n != null));
	const seasons = numbers.some((n) => n?.season != null) || episodes.size > 1;
	let kind: 'movie' | 'tv' | null = show ? 'tv' : null;
	if (typeof tv === 'number' && typeof movie === 'number') {
		kind ??= identified ?? (seasons ? 'tv' : 'movie');
	} else if (typeof tv === 'number') kind = 'tv';
	else if (typeof movie === 'number' && !seasons) kind = 'movie';
	const tmdbId = kind === 'movie' ? movie : kind === 'tv' ? tv : undefined;
	if (typeof tmdbId !== 'number') {
		if (kind === 'movie') return { kind, imdbId, tmdbId: null };
		const listed = await listedSeries(imdbId, sources);
		return listed
			? { kind: 'tv', imdbId, tmdbId: null, listed }
			: { kind, imdbId, tmdbId: null };
	}
	// DMM's cached find for tt14986406 names show 335660, which TMDB has since deleted: one TMDB
	// cannot use, so the release's name names it
	if (kind === 'tv' && deleted(await sources.show(tmdbId))) {
		const listed = await listedSeries(imdbId, sources);
		return { kind, imdbId, tmdbId: null, ...(listed ? { listed } : {}) };
	}
	return { kind, imdbId, tmdbId };
}

/**
 * IMDb's episodes of a series TMDB cannot use, when IMDb numbers them: TMDB has deleted Dragon
 * Ball Z Abridged (tt10710138, `tv/337297` a 404) and its find knows neither it nor Digimon
 * Adventure 02 (tt0243694), while IMDb lists both by season and episode, as Plex's agent does.
 */
async function listedSeries(imdbId: string, sources: PlacementSources) {
	const series = await sources.imdbSeries(imdbId);
	return series &&
		/^tv(?:Mini)?Series$/.test(series.titleType) &&
		series.episodes.some((row) => row.season !== null && row.season > 0 && row.episode !== null)
		? series
		: null;
}

/** TMDB's answer for a show it has deleted: `/3/tv/335660` is a 404 with `status_code` 34. */
const deleted = (answer: any) => answer?.status_code === 34;

// `Detective.Conan.EP1212.Episode.1212.1080p.NF.WEB-DL.JPN.AAC2.0…`: Japanese audio
const JAPANESE = /(?:^|[\s._\-[(])(?:jpn|jap|japanese)(?=[\s._\-\])]|$)/i;

/**
 * A release's show: the one its title names, else the one the anime index names by the
 * release's name. That is a fansub's name, or a scene name of numbered episodes something else
 * says is anime: Japanese audio, or a TV title its id or the identifier named that TMDB cannot
 * use. The identifier names neither `Detective.Conan.EP1212…JPN…` nor
 * `Kingdom.S02E06.1080p.NF.WEB-DL…-ExREN`, which is Netflix's Korean Kingdom and no anime.
 * The anime index's show also stands in for a Japanese show of TMDB's that holds none of the
 * release's numbers, and for a film's on a fansub cour of numbered episodes.
 */
async function placeRelease(
	release: PlaceRequest,
	title: Title | null,
	sources: PlacementSources,
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	const numbered = release.files.some(
		(file) =>
			fileNumbers(release.name, file.folder, file.path, release.files.length === 1) !== null
	);
	const named = () =>
		anime ? lookupAnime(anime, release.name, release.files[0]?.path ?? '') : null;
	const onIndex = (hit: ReturnType<typeof named>) =>
		hit && { kind: 'tv' as const, imdbId: title?.imdbId ?? null, tmdbId: hit.target.tmdb };
	const animeShaped =
		fansubShaped(release.name) ||
		(numbered &&
			(JAPANESE.test(release.name) || (title?.kind === 'tv' && title.tmdbId === null)));
	// TMDB knows tt43383343 only as the Calamity's film, and `[Onalrie] Bleach Sennen Kessen Hen -
	// Kashin Tan - E08` is the cour's eighth episode: Bleach's S2E48
	const film =
		title?.kind === 'movie' && title.tmdbId !== null && fansubShaped(release.name) && numbered;
	const hit = (title?.tmdbId == null && animeShaped) || film ? named() : null;
	const indexed = hit && (!film || hit.target.season > 0) ? onIndex(hit) : null;
	const listed = title?.listed
		? await placeOnImdb(release, { ...title, listed: title.listed }, anime)
		: null;
	if (indexed) {
		const there = await placeOnShow(release, indexed, true, sources, anime);
		if (!listed || !placesFiles(listed)) return there;
		// the anime index's show is read off the name, IMDb's list is the id sent: the list wins
		// where more of the files' titles name its episodes (`Season 2`'s `Dragon Ball Z Abridged -
		// S02E01 - …` read as another series), or where the index's show only counted them
		// (`Digimon.Adventure.02.E03` as Digimon: Digital Monsters' S1E3, the 1999 series); else
		// the index's numbering stands (Thousand-Year Blood War's `S04E01` as Bleach's S2E41)
		const titles = (answer: PlacedRelease) => titledFiles.get(answer) ?? 0;
		const counted = there.files.every((file) => file.how === null || file.how === 'absolute');
		return titles(listed) > titles(there) || counted ? listed : there;
	}
	if (listed) return listed;
	if (title?.kind !== 'tv' || title.tmdbId === null) {
		return {
			kind: title?.kind ?? null,
			imdbId: title?.imdbId ?? null,
			tmdbId: title?.tmdbId ?? null,
			files: release.files.map((file) => unplaced(file.path)),
		};
	}
	const placed = await placeOnShow(
		release,
		{ ...title, tmdbId: title.tmdbId },
		false,
		sources,
		anime
	);
	// TMDB's live find for tt14986406 names `Bleach: Sennen Kessen-hen` (336301), a Japanese
	// stub whose one season holds an E13 alone, and none of the release's numbers: the anime
	// index's show, if it does
	if (placed.skipped || !numbered || placed.files.some((file) => file.season !== null)) {
		return placed;
	}
	if ((await sources.show(title.tmdbId))?.original_language !== 'ja') return placed;
	const other = onIndex(named());
	if (!other || other.tmdbId === title.tmdbId) return placed;
	const there = await placeOnShow(release, other, true, sources, anime);
	return there.files.some((file) => file.season !== null) ? there : placed;
}

/** A release's files on one TMDB show; `hit` when the anime index named the show. */
async function placeOnShow(
	release: PlaceRequest,
	title: Title & { tmdbId: number },
	hit: boolean,
	sources: PlacementSources,
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	const { kind, tmdbId } = title;
	let imdbId = title.imdbId;
	const answer = (files: PlacedFile[]): PlacedRelease => ({ kind, imdbId, tmdbId, files });
	const showId = tmdbId;
	const details = await sources.show(showId);
	if (deleted(details)) return answer(release.files.map((file) => unplaced(file.path)));
	// TMDB's show could not be read: ask again rather than answer it unplaced
	if (!details?.seasons) return skipped(release);
	const external = details.external_ids?.imdb_id;
	const showImdb = typeof external === 'string' && /^tt\d{7,}$/.test(external) ? external : null;
	// the show's own id where the anime index named it: `Monogatari Series Second Season`'s
	// tt2922300 is a title TMDB files under Monogatari (tt1480925)
	imdbId = hit ? (showImdb ?? imdbId) : (imdbId ?? showImdb);
	const lists = new Map<
		number,
		Promise<{ episode: number; name: string; airDate: string | null; id?: number }[] | null>
	>();
	const episodes = (season: number) => {
		if (!lists.has(season)) {
			lists.set(
				season,
				sources.season(showId, season).then((list) =>
					Array.isArray(list?.episodes)
						? (list.episodes as any[])
								.filter((row) => Number.isInteger(row?.episode_number))
								.map((row) => ({
									episode: row.episode_number as number,
									name: typeof row.name === 'string' ? row.name : '',
									airDate: typeof row.air_date === 'string' ? row.air_date : null,
									...(Number.isInteger(row.id) ? { id: row.id as number } : {}),
								}))
								.sort((a, b) => a.episode - b.episode)
						: null
				)
			);
		}
		return lists.get(season)!;
	};
	const placement: PlacementShow = {
		episodes,
		tmdbId,
		imdbId,
		names: [details.name, details.original_name].filter(
			(name): name is string => typeof name === 'string'
		),
		seasons: (details.seasons as any[]).flatMap((row) =>
			Number.isInteger(row?.season_number)
				? [
						{
							season: row.season_number as number,
							episodes: Number.isInteger(row.episode_count) ? row.episode_count : 0,
							airDate: typeof row.air_date === 'string' ? row.air_date : null,
							...(typeof row.name === 'string' ? { name: row.name } : {}),
						},
					]
				: []
		),
	};
	placement.tvdbOrder = tvdbOrderLookup(showId, sources, TVDB_ORDER);
	placement.aligned = alignedLookup(showId, details, sources, release);
	if (release.parts) placement.parts = true;
	if (DUBBED.test(release.name)) placement.dubOrder = tvdbOrderLookup(showId, sources, DUB_ORDER);
	placement.packOrder = await packOrderLookup(release, placement.seasons, showId, sources);
	placement.namedRun = await namedRunLookup(release, placement.seasons, episodes);
	placement.subtitled = subtitledLookup(release, details, showId, placement.seasons, sources);
	const imdb = imdbId ? imdbLookup(imdbId, tmdbId, sources) : null;
	return placeFiles(release, placement, anime, imdb, (files) => answer(files));
}

/**
 * A release's files on one show, by the rules in `@/utils/episodePlacement`, as `answer` reports
 * them; `how` rewrites each file's rule.
 */
async function placeFiles(
	release: PlaceRequest,
	placement: PlacementShow,
	anime: AnimeIndex | null,
	imdb: ImdbLookup | null,
	answer: (files: PlacedFile[]) => PlacedRelease,
	how: (found: Placement) => PlacementRule | null = (found) => found.how,
	byTitle = false
): Promise<PlacedRelease> {
	const run = countedRun(release);
	const numbers = stackedParts(
		absoluteFolders(
			release.files.map((file, at) => ({
				folder: file.folder,
				numbers:
					run?.[at] ??
					fileNumbers(release.name, file.folder, file.path, release.files.length === 1),
			})),
			placement.seasons
		)
	);
	// a release's one file named by a hash is titled as the release: Usenet's
	// `SpongeBob.SquarePants.1999.S10E25.Yeti.Krabs.…` holds `1501ec8cb21ed376ee71db04c4bb2dfb.mkv`
	const titledAs = (path: string) => {
		const stem = (path.split('/').pop() ?? path).replace(/\.[a-z0-9]{2,4}$/i, '');
		return release.files.length === 1 && /^[0-9a-f]{16,}$/i.test(stem) ? release.name : path;
	};
	// a release whose titles name TMDB's episodes at its own numbers, where TVDB's list differs,
	// numbers as TMDB does
	if (
		placement.aligned &&
		!(await numberedByTvdb(
			placement,
			release.files.map((file) => titledAs(file.path)),
			numbers
		))
	)
		placement = { ...placement, aligned: undefined };
	const placed: (Placement | null)[] = [];
	for (const [at, file] of release.files.entries()) {
		placed.push(
			numbers[at]
				? await placeFile(
						placement,
						anime,
						release.name,
						titledAs(file.path),
						numbers[at]!,
						imdb
					)
				: // a release of one file may carry the air date its file's name leaves out
					((await airDated(placement, titledAs(file.path))) ??
						(release.files.length === 1
							? await airDated(placement, release.name)
							: null) ??
						(await specialOf(placement, release.name, file.path)))
		);
	}
	const yielded = yieldToTitles(keepImdbOrder(numbers, placed));
	// once a release's titled files show its numbers are not TMDB's (most of them), a file whose title placed it
	// nowhere is not placed by its number either: the 2003 Berenstain Bears' `E53 (New Neighbors)`,
	// a title TMDB lacks, counted to S2E26 "Count Their Blessings"
	const titles = release.files.map((file, at) => {
		const own = numbers[at];
		const path = titledAs(file.path);
		return own ? titleOf(path.split('/').pop() ?? path, own) : null;
	});
	// most of them: QI's pack numbers as TMDB does, its one titled stray aside. Moved from where its
	// numbers place it by the rules, not from the numbers as written: Shangri-La Frontier's
	// `S02E01` is TMDB's S1E26 by its title and by its number alike, TMDB numbering on through S1
	const movedBy = await Promise.all(
		yielded.map(async (found, at) => {
			if (!found?.titled || !numbers[at]) return false;
			const path = titledAs(release.files[at].path);
			const own = await placeFile(
				placement,
				anime,
				release.name,
				path,
				numbers[at]!,
				imdb,
				false
			);
			return own?.season !== found.season || own?.episode !== found.episode;
		})
	);
	const moved = movedBy.filter(Boolean).length * 2 > titles.filter(Boolean).length;
	// scene notation is the list's own numbering; a count or a folder's season is not
	const counted = (at: number) =>
		numbers[at]!.season === null || Boolean(numbers[at]!.coded || numbers[at]!.borrowed);
	const dropped = yielded.map((found, at) =>
		found && !found.titled && titles[at] && (moved || (byTitle && counted(at))) ? null : found
	);
	// a file its title and numbers placed nowhere, between the nearest files numbered before and after
	// it that their titles placed as many episodes apart as their numbers are: Hell's Paradise's
	// `S02E06.Conflict.and.Growing.Together` is TMDB's S1E19 "Hindering and Restoration", `S02E05` and
	// `S02E07` S1E18 and S1E20 by their titles; [bonkai77]'s `Bleach.Episode.35`-`38` lie between
	// `Episode.34` and `Episode.39`, S1E34 and S1E39 by theirs
	const taken = new Set(dropped.flatMap((p) => (p ? [`${p.season}|${p.episode}`] : [])));
	const titledAt = new Map<string, Placement>();
	numbers.forEach((n, i) => {
		const found = dropped[i];
		const key = `${n?.season}|${n?.episode}`;
		if (n && n.end === null && found?.titled && !titledAt.has(key)) titledAt.set(key, found);
	});
	// ponytail: a gap of up to a cour's episodes; widen it when a longer one turns up
	const nearest = (season: number | null, episode: number, step: 1 | -1) => {
		for (let k = 1; k <= 13; k++) {
			const found = titledAt.get(`${season}|${episode + step * k}`);
			if (found) return { found, k };
		}
		return null;
	};
	const kept = dropped.map((found, at) => {
		const own = numbers[at];
		if (found || !own || own.end !== null) return found;
		const [before, after] = [
			nearest(own.season, own.episode, -1),
			nearest(own.season, own.episode, 1),
		];
		if (
			!before ||
			!after ||
			before.found.season !== after.found.season ||
			after.found.episode - before.found.episode !== before.k + after.k
		)
			return found;
		const between = { season: before.found.season, episode: before.found.episode + before.k };
		return taken.has(`${between.season}|${between.episode}`)
			? found
			: { ...between, episodeEnd: null, how: before.found.how };
	});
	// the one file of an episode beside a later part of it named so is its first: `Lost.S01E24`
	// beside `Lost.S01E24.Part.2`
	const parted = placement.parts
		? kept.map((found) => {
				const same = (other: Placement | null) =>
					other?.season === found?.season && other?.episode === found?.episode;
				return found &&
					!found.part &&
					found.episodeEnd === null &&
					kept.some((other) => same(other) && (other?.part ?? 0) > 1) &&
					kept.filter((other) => same(other) && !other?.part).length === 1
					? { ...found, part: 1 }
					: found;
			})
		: kept;
	// every rule lands on an episode of TMDB's season lists, which carry its id; IMDb's list has none
	const episodeId = async (found: Placement) =>
		placement.tmdbId > 0
			? ((await placement.episodes(found.season))?.find(
					(row) => row.episode === found.episode
				)?.id ?? null)
			: null;
	const placedAnswer = answer(
		await Promise.all(
			parted.map(async (found, at) => {
				const path = release.files[at].path;
				const rule = found && how(found);
				return found && rule
					? {
							path,
							season: found.season,
							episode: found.episode,
							episodeEnd: found.episodeEnd,
							how: rule,
							tmdbEpisodeId: await episodeId(found),
							...(found.part ? { part: found.part } : {}),
						}
					: unplaced(path);
			})
		)
	);
	titledFiles.set(placedAnswer, kept.filter((found) => found?.titled).length);
	titledEach.set(
		placedAnswer,
		kept.map((found) => Boolean(found?.titled))
	);
	agreedFiles.set(placedAnswer, kept.filter((found, at) => found?.titled && !movedBy[at]).length);
	return placedAnswer;
}

/**
 * A release's files on IMDb's episode list of a series TMDB cannot use, by the same rules as on
 * TMDB's (a file's own title first) and all answered `imdb`: the show's ids are IMDb's alone, and
 * Plex's agent knows the show by them with IMDb's seasons. A number counted through the seasons is
 * taken only for a series of one season, and a file numbered by a count or its folder, with a
 * title, only by its title: TFS numbers Dragon Ball Z Abridged on through its seasons and splits
 * episodes in parts (`DBZ Abridged - 025 - Nail Is Piccolo, And So Can You!` is IMDb's S2E15,
 * `DragonBall Z Abridged Episode 11` its S2E1), which no count reaches.
 */
async function placeOnImdb(
	release: PlaceRequest,
	title: Title & { listed: ImdbSeries },
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	const bySeason = new Map<number, { episode: number; name: string; airDate: string | null }[]>();
	for (const row of title.listed.episodes) {
		if (row.season === null || row.episode === null) continue;
		const list = bySeason.get(row.season) ?? [];
		list.push({ episode: row.episode, name: row.name, airDate: null });
		bySeason.set(row.season, list);
	}
	for (const list of bySeason.values()) list.sort((a, b) => a.episode - b.episode);
	const placement: PlacementShow = {
		episodes: async (season) => bySeason.get(season) ?? null,
		// no TMDB show, so no anime entry names it
		tmdbId: -1,
		imdbId: title.imdbId,
		names: title.listed.title ? [title.listed.title] : [],
		seasons: [...bySeason]
			.map(([season, list]) => ({ season, episodes: list.length, airDate: null }))
			.sort((a, b) => a.season - b.season),
	};
	return placeFiles(
		release,
		placement,
		anime,
		null,
		(files) => ({ kind: 'tv', imdbId: title.imdbId, tmdbId: null, files }),
		// a count only through a series of one season: Digimon Adventure 02's 50
		(found) =>
			found.how === 'absolute' && placement.seasons.filter((row) => row.season > 0).length > 1
				? null
				: 'imdb',
		// a file with a title only by it: TFS's `Episode 11 - TeamFourStar (TFS)` is IMDb's S2E1
		true
	);
}

/** How many of an answer's files placeOnShow placed by their own titles. */
const titledFiles = new WeakMap<PlacedRelease, number>();
/** How many of those its titles placed on the episode its numbers name as well. */
const agreedFiles = new WeakMap<PlacedRelease, number>();
/** Which of an answer's files placeOnShow placed by their own titles. */
const titledEach = new WeakMap<PlacedRelease, boolean[]>();

// TMDB names Detective Conan's "Aired Order (TheTVDB)": `S33E26.a.Ghost` (Crunchyroll's, TVDB's
// season 33) is its S1E1173 "It's a Ghost!"
const TVDB_ORDER = /tvdb/i;
const DUB_ORDER = /\bdub\b/i;
// `[Rillant] Medabots S01-03 (English Dubbed)`: numbered in the dub's own seasons
const DUBBED = /(?:^|[\s._([-])(?:english[\s._-]+)?dub(?:bed)?(?=[\s._)\]-]|$)/i;

/**
 * TMDB's episode for another order's season and episode: the nth episode of that season in the
 * show's episode group of that order ("TVDB Order", "Dub Order"), read once per release and only
 * when a file needs it.
 */
/** One episode group's seasons, by its order: each the TMDB season and episode of its nth episode. */
async function groupSeasons(
	id: string,
	sources: PlacementSources
): Promise<Map<number, [number, number][]>> {
	const groups: any[] = (await sources.episodeGroup(id))?.groups ?? [];
	const seasons = new Map<number, [number, number][]>();
	for (const group of groups) {
		if (!Number.isInteger(group?.order)) continue;
		const episodes: any[] = (group.episodes ?? []).filter(
			(row: any) =>
				Number.isInteger(row?.order) &&
				Number.isInteger(row?.season_number) &&
				Number.isInteger(row?.episode_number)
		);
		episodes.sort((a, b) => a.order - b.order);
		seasons.set(
			group.order,
			episodes.map((row) => [row.season_number, row.episode_number])
		);
	}
	return seasons;
}

/**
 * The season a release names after the show, each by a name TMDB gives it in some language:
 * `[ANi] 小書痴的下剋上 為了成為圖書管理員不擇手段！領主的養女 - 21` is Ascendance of a Bookworm,
 * as Taiwan's TMDB names it, and then 領主的養女, Hong Kong's name for its season 2. Null where
 * not exactly one season is named; the seasons' names are read only when asked for.
 */
function subtitledLookup(
	release: PlaceRequest,
	details: any,
	tmdbId: number,
	seasons: TmdbSeason[],
	sources: PlacementSources
): PlacementShow['subtitled'] {
	const ask = sources.seasonTranslations;
	if (!ask) return undefined;
	const title = normalizeTitle(parseName(release.name).title);
	const shows = [
		details.name,
		details.original_name,
		...(details.translations?.translations ?? []).map((row: any) => row?.data?.name),
	].flatMap((name) => (typeof name === 'string' ? [normalizeTitle(name)] : []));
	const rests = shows.flatMap((name) =>
		name && title.startsWith(`${name} `) ? [title.slice(name.length + 1)] : []
	);
	if (rests.length === 0) return undefined;
	let found: Promise<number | null> | null = null;
	const read = async () => {
		const named = await Promise.all(
			seasons
				.filter((row) => row.season > 0)
				.map(async (row) => {
					const names = [
						row.name,
						...((await ask(tmdbId, row.season))?.translations ?? []).map(
							(t: any) => t?.data?.name
						),
					];
					return names.some(
						(name) => typeof name === 'string' && rests.includes(normalizeTitle(name))
					)
						? [row.season]
						: [];
				})
		);
		const hits = named.flat();
		return hits.length === 1 ? hits[0] : null;
	};
	return () => (found ??= read());
}

/**
 * The run of episodes TMDB names after a release whose numbered files are one season, numbered 1
 * to n: a season of the release's name (smol's `[smol] Monogatari Series Second Season` numbers
 * its 23 files `S04E01`-`E23`, TMDB's season 3 "Monogatari Series: Second Season"), or the
 * episodes titled after it (`[smol] Zoku Owarimonogatari`'s `S10E01`-`E06` are S0E42-E47 "Zoku
 * Owarimonogatari: Koyomi Reverse (1)"-"(6)"). Taken where exactly one such run is n long.
 */
async function namedRunLookup(
	release: PlaceRequest,
	seasons: TmdbSeason[],
	episodes: PlacementShow['episodes']
): Promise<PlacementShow['namedRun'] | undefined> {
	const title = letters(parseName(release.name).title);
	if (title.length < 8) return undefined;
	const single = release.files.length === 1;
	const held = new Map<number, Set<number>>();
	for (const file of release.files) {
		const numbers = fileNumbers(release.name, file.folder, file.path, single);
		if (!numbers || numbers.season === null || numbers.coded) continue;
		held.set(numbers.season, (held.get(numbers.season) ?? new Set()).add(numbers.episode));
	}
	if (held.size !== 1) return undefined;
	const [[season, set]] = [...held];
	if (set.size < 4 || Math.max(...set) !== set.size) return undefined;
	const lists = await Promise.all(
		seasons.map(async (row) => ({ row, list: (await episodes(row.season)) ?? [] }))
	);
	const runs: [number, number][][] = [];
	for (const { row, list } of lists) {
		if (row.season > 0 && row.season !== season && letters(row.name ?? '') === title) {
			runs.push(list.map((item) => [row.season, item.episode]));
		}
	}
	const titled = lists.flatMap(({ row, list }) =>
		list.flatMap((item) => {
			const name = letters(item.name);
			return name.startsWith(title) && name.length > title.length
				? [[row.season, item.episode] as [number, number]]
				: [];
		})
	);
	if (titled.length) runs.push(titled);
	const fit = runs.filter((run) => run.length === set.size);
	if (fit.length !== 1) return undefined;
	const [run] = fit;
	return async (at, episode) => (at === season ? (run[episode - 1] ?? null) : null);
}

/**
 * The order of a pack numbered in one of the show's episode groups rather than as TMDB aired it:
 * the group whose seasons hold exactly as many episodes as the pack's, in more of its seasons
 * than TMDB's own list does, used for the seasons where it does and TMDB's does not. The Polish
 * `Futurama HD PL` numbers seasons 7-10 by 13 as TMDB's "Digital Order" does, where TMDB lists
 * 26 and 10s, so its `s08e05` is not TMDB's S8E5 of 2023. Read only when a season of four
 * files or more runs past TMDB's list; two groups alike leave the pack to TMDB's numbering.
 */
async function packOrderLookup(
	release: PlaceRequest,
	seasons: TmdbSeason[],
	tmdbId: number,
	sources: PlacementSources
): Promise<PlacementShow['packOrder'] | undefined> {
	const single = release.files.length === 1;
	const held = new Map<number, Set<number>>();
	for (const file of release.files) {
		const numbers = fileNumbers(release.name, file.folder, file.path, single);
		if (
			!numbers ||
			numbers.season === null ||
			numbers.season < 1 ||
			numbers.coded ||
			numbers.borrowed
		)
			continue;
		const set = held.get(numbers.season) ?? new Set<number>();
		for (let episode = numbers.episode; episode <= (numbers.end ?? numbers.episode); episode++)
			set.add(episode);
		held.set(numbers.season, set);
	}
	const aired = new Map(seasons.map((row) => [row.season, row.episodes]));
	const runs = [...held].filter(([, set]) => set.size >= 4);
	if (!runs.some(([season, set]) => Math.max(...set) > (aired.get(season) ?? 0)))
		return undefined;
	// a season the pack holds whole: as many episodes as the order lists, numbered 1 to n
	const whole = (season: number, size: number | undefined) => {
		const set = held.get(season)!;
		return size === set.size && Math.max(...set) === size;
	};
	const own = runs.filter(([season]) => whole(season, aired.get(season))).length;
	const results: any[] = (await sources.episodeGroups(tmdbId))?.results ?? [];
	let best: { order: Map<number, [number, number][]>; count: number } | null = null;
	let tie = false;
	// an order in seasons (aired, DVD, digital, production, TV), never an absolute or story-arc one
	for (const group of results.filter((group) => [1, 3, 4, 6, 7].includes(group?.type))) {
		if (typeof group?.id !== 'string') continue;
		const order = await groupSeasons(group.id, sources);
		// the group agrees with TMDB's list wherever that holds the pack's season, and names no special
		const agrees = runs.every(
			([season]) =>
				!whole(season, aired.get(season)) ||
				order.get(season)?.every(([s, e], at) => s === season && e === at + 1)
		);
		// a season the group numbers whole where TMDB's list does not, and only regular episodes
		const used = runs.filter(
			([season]) =>
				whole(season, order.get(season)?.length) && !whole(season, aired.get(season))
		);
		const regular = used.every(([season]) => order.get(season)!.every(([s]) => s > 0));
		const count = runs.filter(([season]) => whole(season, order.get(season)?.length)).length;
		if (!agrees || !regular || !used.length || count <= own) continue;
		if (!best || count > best.count) [best, tie] = [{ order, count }, false];
		else if (count === best.count) tie = true;
	}
	if (!best || tie) return undefined;
	const { order } = best;
	const used = new Set(
		runs.flatMap(([season]) =>
			whole(season, order.get(season)?.length) && !whole(season, aired.get(season))
				? [season]
				: []
		)
	);
	return async (season, episode) =>
		used.has(season) ? (order.get(season)?.[episode - 1] ?? null) : null;
}

/** A show's `alignTvdb` in one of TVDB's orders, with the last episode each list numbers a season to. */
interface Alignment {
	aligned: Map<string, AlignedEpisode | null>;
	tvdbLast: Map<number, number>;
	tmdbLast: Map<number, number>;
}

/** Each show's alignments, kept as long as the season lists they are read from. */
const alignments = new WeakMap<
	PlacementSources,
	Map<string, { until: number; alignment: Promise<Alignment | null> }>
>();
const ALIGNMENT_MS = 12 * 3600_000;

const listedEpisodes = (rows: any[], season: string, episode: string, aired: string) =>
	rows.flatMap((row) =>
		Number.isInteger(row?.[season]) && Number.isInteger(row?.[episode])
			? [
					{
						season: row[season] as number,
						episode: row[episode] as number,
						airDate: typeof row[aired] === 'string' ? (row[aired] as string) : null,
						name: typeof row.name === 'string' ? (row.name as string) : '',
						runtime:
							typeof row.runtime === 'number' && row.runtime > 0 ? row.runtime : null,
					},
				]
			: []
	);

const lastOf = (rows: { season: number; episode: number }[]) => {
	const last = new Map<number, number>();
	for (const row of rows) last.set(row.season, Math.max(last.get(row.season) ?? 0, row.episode));
	return last;
};

/** A show's alignment in TVDB's `order`, read once per show and kept; null where a list cannot be read. */
function showAlignment(
	showId: number,
	details: any,
	tvdbId: number,
	sources: PlacementSources,
	order?: 'dvd'
) {
	const shows = alignments.get(sources) ?? new Map();
	alignments.set(sources, shows);
	const at = `${showId}/${order ?? 'default'}`;
	let cached = shows.get(at);
	if (!cached || cached.until < Date.now()) {
		const read = async (): Promise<Alignment | null> => {
			const listed = await sources.tvdbEpisodes!(tvdbId, order);
			const seasons = await Promise.all(
				(details.seasons as any[])
					.filter((row) => Number.isInteger(row?.season_number))
					.map((row) => sources.season(showId, row.season_number))
			);
			if (!listed || seasons.some((list) => !Array.isArray(list?.episodes))) return null;
			const tvdb = listedEpisodes(listed, 'seasonNumber', 'number', 'aired');
			const tmdb = listedEpisodes(
				seasons.flatMap((list) => list.episodes),
				'season_number',
				'episode_number',
				'air_date'
			);
			return {
				aligned: alignTvdb(tvdb, tmdb),
				tvdbLast: lastOf(tvdb),
				tmdbLast: lastOf(tmdb),
			};
		};
		const alignment = read().catch(() => null);
		cached = { until: Date.now() + ALIGNMENT_MS, alignment };
		shows.set(at, cached);
		// a list that could not be read is asked again next time
		void alignment.then((found) => found || shows.delete(at));
	}
	return cached.alignment;
}

/**
 * TMDB's episode for TVDB's numbers on a show whose TVDB id TMDB records (`alignTvdb`), read once
 * a file asks; undefined for every number where a list cannot be had. TVDB's aired order, but its
 * DVD order for a season the release numbers past both that and TMDB's list: HiQVE's Lost BluRay
 * numbers "Exodus (2)", TVDB's aired S1E24 and TMDB's, as E24 and E25. A show TMDB records no
 * TVDB id for is `tvdbLook`'s.
 */
function alignedLookup(
	showId: number,
	details: any,
	sources: PlacementSources,
	release: PlaceRequest
): PlacementShow['aligned'] {
	const tvdbId = Number(details.external_ids?.tvdb_id);
	if (!sources.tvdbEpisodes || !(tvdbId > 0)) return undefined;
	const choose = async () => {
		const aired = await showAlignment(showId, details, tvdbId, sources);
		if (!aired) return null;
		const last = new Map<number, number>();
		for (const file of release.files) {
			const numbers = fileNumbers(
				release.name,
				file.folder,
				file.path,
				release.files.length === 1
			);
			if (numbers?.season != null && numbers.season > 0)
				last.set(
					numbers.season,
					Math.max(last.get(numbers.season) ?? 0, numbers.end ?? numbers.episode)
				);
		}
		const past = [...last].filter(
			([season, episode]) =>
				episode > (aired.tvdbLast.get(season) ?? Infinity) &&
				episode > (aired.tmdbLast.get(season) ?? Infinity)
		);
		const dvd = past.length
			? await showAlignment(showId, details, tvdbId, sources, 'dvd')
			: null;
		const onDvd = new Set(
			past.flatMap(([season, episode]) =>
				(dvd?.tvdbLast.get(season) ?? 0) >= episode ? [season] : []
			)
		);
		return (season: number) => (onDvd.has(season) ? dvd! : aired).aligned;
	};
	let chosen: ReturnType<typeof choose> | null = null;
	return async (season, episode) => {
		chosen ??= choose();
		return (await chosen)?.(season).get(`${season}|${episode}`);
	};
}

function tvdbOrderLookup(
	tmdbId: number,
	sources: PlacementSources,
	name: RegExp
): PlacementShow['tvdbOrder'] {
	let order: Promise<Map<number, [number, number][]> | null> | null = null;
	const read = async () => {
		const results: any[] = (await sources.episodeGroups(tmdbId))?.results ?? [];
		const named = results.filter((group) => name.test(group?.name ?? ''));
		const id = (named.find((group) => group?.type === 1) ?? named[0])?.id;
		if (typeof id !== 'string') return null;
		return groupSeasons(id, sources);
	};
	return async (season, episode) => {
		order ??= read();
		return (await order)?.get(season)?.[episode - 1] ?? null;
	};
}

/** IMDb's episode by these numbers, and the TMDB episode TMDB's find names for it if it is this show's. */
function imdbLookup(show: string, tmdbId: number, sources: PlacementSources): ImdbLookup {
	const seasons = new Map<number, Promise<Map<number, string>>>();
	return async (season, episode) => {
		if (!seasons.has(season)) seasons.set(season, sources.seasonEpisodes(show, season));
		const tconst = (await seasons.get(season)!).get(episode);
		if (!tconst) return null;
		const hit = (await sources.find(tconst))?.tv_episode_results?.[0];
		return hit?.show_id === tmdbId &&
			Number.isInteger(hit.season_number) &&
			Number.isInteger(hit.episode_number)
			? [hit.season_number, hit.episode_number]
			: null;
	};
}

let animeIndex: {
	from: FranchiseIndex;
	synonyms: Map<number, string[]> | null;
	index: AnimeIndex;
} | null = null;

/**
 * The anime index, rebuilt whenever the Fribb dataset (about daily) or manami's synonyms
 * (weekly) are; null while the Fribb dataset cannot load.
 */
async function currentAnimeIndex(): Promise<AnimeIndex | null> {
	const franchise = await getFranchiseIndex();
	if (!franchise) return null;
	const synonyms = await getAnimeSynonyms((id) => Boolean(franchise.byAnidb.get(id)?.tmdb));
	if (animeIndex?.from !== franchise || animeIndex.synonyms !== synonyms) {
		const ids = [...franchise.byAnidb.values()].filter((e) => e.tmdb).map((e) => e.anidbId);
		const titles = await repository.getAnimeTitles(ids);
		const names = [...(synonyms ?? [])].map(([anidbId, list]) => ({ anidbId, names: list }));
		animeIndex = {
			from: franchise,
			synonyms,
			index: buildAnimeIndex(franchise, [...titles, ...names]),
		};
	}
	return animeIndex.index;
}

/** TMDB's 404 body in place of the error, so a show TMDB deleted is not one it could not be asked about. */
function tmdbNotFound(error: unknown): unknown {
	const response = (error as { response?: { status?: number; data?: any } } | null)?.response;
	if (response?.status === 404 && deleted(response.data)) return response.data;
	throw error;
}

/** DMM's own caches: TMDB through `metadataCache`, IMDb's episodes and anime titles from the database. */
export const cachedSources: PlacementSources = {
	find: (imdbId) =>
		getTmdbAuth()
			? settle(() => getMetadataCache().searchTmdbByImdb(imdbId))
			: Promise.resolve(null),
	show: (tmdbId) =>
		getTmdbAuth()
			? settle(() =>
					getMetadataCache().getTmdbTvInfo(tmdbId, TMDB_TV_APPEND).catch(tmdbNotFound)
				)
			: Promise.resolve(null),
	season: (tmdbId, season) =>
		getTmdbAuth()
			? settle(() =>
					getMetadataCache().getTmdbPassthrough(`tv/${tmdbId}/season/${season}`, {})
				)
			: Promise.resolve(null),
	seasonTranslations: (tmdbId, season) =>
		getTmdbAuth()
			? settle(() =>
					getMetadataCache().getTmdbPassthrough(
						`tv/${tmdbId}/season/${season}/translations`,
						{}
					)
				)
			: Promise.resolve(null),
	episodeGroups: (tmdbId) =>
		getTmdbAuth()
			? settle(() => getMetadataCache().getTmdbPassthrough(`tv/${tmdbId}/episode_groups`, {}))
			: Promise.resolve(null),
	episodeGroup: (id) =>
		getTmdbAuth()
			? settle(() => getMetadataCache().getTmdbPassthrough(`tv/episode_group/${id}`, {}))
			: Promise.resolve(null),
	episodeShow: (imdbId) => repository.getImdbEpisodeShow(imdbId),
	seasonEpisodes: (show, season) => repository.getImdbSeasonEpisodeIds(show, season),
	anime: () => settle(currentAnimeIndex),
	imdbSeries: (imdbId) => repository.getImdbSeries(imdbId),
	namesakeSeries: (imdbId) => repository.getNamesakeSeries(imdbId),
	searchTv: (query) =>
		getTmdbAuth()
			? settle(() => getMetadataCache().searchTmdbTitles('tv', query))
			: Promise.resolve(null),
	searchMovie: (query, year) =>
		getTmdbAuth()
			? settle(() => getMetadataCache().searchTmdbTitles('movie', query, year))
			: Promise.resolve(null),
	movieIds: (tmdbId) =>
		getTmdbAuth()
			? settle(() => getMetadataCache().getTmdbExternalIds(tmdbId, 'movie'))
			: Promise.resolve(null),
	// asks about at most 300 names it has not answered today: zurg asks again daily
	identifier: (names) =>
		settle(() => identifyFilenamesRemembered(names, 300)).then((r) => r?.answers ?? null),
	tvdbSeriesOf: (imdbId) =>
		settle(() => getMetadataCache().getTvdb(`search/remoteid/${imdbId}`)).then(
			(answer) =>
				answer &&
				(answer.data ?? [])
					.map((row: any) => row?.series?.id)
					.filter((id: unknown) => typeof id === 'number')
		),
	searchTvdb: (query, year) =>
		settle(() =>
			getMetadataCache().getTvdb(
				`search?query=${encodeURIComponent(query)}&type=series&year=${year}`
			)
		).then((answer) => answer && (answer.data ?? [])),
	onePace: () => onePaceCatalogue(),
	findTvdbEpisode: (id) =>
		getTmdbAuth()
			? settle(() =>
					getMetadataCache().getTmdbPassthrough(`find/${id}`, {
						external_source: 'tvdb_id',
					})
				)
			: Promise.resolve(null),
	tvdbEpisodes: async (tvdbId, order) => {
		const episodes: any[] = [];
		// 500 a page: Kitchen Nightmares' 126 episodes are one
		for (let page = 0; page < 20; page++) {
			const answer = await settle(() =>
				getMetadataCache().getTvdb(
					`series/${tvdbId}/episodes/${order ?? 'default'}?page=${page}`
				)
			);
			if (!answer) return null;
			episodes.push(...(answer.data?.episodes ?? []));
			if (!answer.links?.next) break;
		}
		return episodes;
	},
};
