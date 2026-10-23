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
import type { ImdbSeries } from '@/services/database/hashImdb';
import { settle, TMDB_TV_APPEND } from '@/services/metadata';
import { getMetadataCache } from '@/services/metadataCache';
import { repository } from '@/services/repository';
import {
	absoluteFolders,
	buildAnimeIndex,
	fansubShaped,
	fileNumbers,
	keepImdbOrder,
	lookupAnime,
	parseName,
	placeFile,
	titleOf,
	yieldToTitles,
	type AnimeIndex,
	type ImdbLookup,
	type Placement,
	type PlacementRule,
	type PlacementShow,
} from '@/utils/episodePlacement';
import { getTmdbAuth } from '@/utils/tmdbAuth';

/**
 * The rules an answer was placed by. Bump it with any change that places a release differently:
 * zurg asks again about every placement made under other rules, and otherwise keeps one a day
 * (a file left unplaced) or a week (a release placed whole), so a fix reached rex-fun's library
 * that much later (2026-10-22). Deploys that change no placement keep it, so callers do not
 * ask about whole libraries again for nothing.
 */
export const PLACEMENT_RULES = '2026-10-23.2';

export interface PlaceRequest {
	name: string;
	hash: string | null;
	imdbId: string | null;
	/** `folder`: where the provider lists the file inside the release, `""` at its top, null when unknown. */
	files: { path: string; folder: string | null }[];
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
}

export interface PlacedRelease {
	kind: 'movie' | 'tv' | null;
	imdbId: string | null;
	tmdbId: number | null;
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
	/** A series and its episodes as IMDb lists them (dmmdb's imdb_title_*); null when IMDb has no such title. */
	imdbSeries(imdbId: string): Promise<ImdbSeries | null>;
	/** content-identifier's own answers for these names, unjudged; null when it could not be asked. */
	identifier(names: string[]): Promise<Map<string, IdentifierResult> | null>;
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
	const titles: (Title | null | undefined)[] = await Promise.all(
		releases.map((release) =>
			release.imdbId ? resolve(release.imdbId, null, release, sources) : null
		)
	);
	// a series IMDb numbers is the id sent, numbered there, never one its name reads as: the
	// identifier reads `Digimon.Adventure.02.E03` as TMDB's Digimon: Digital Monsters, whose
	// season 1 is the 1999 series
	const ask = releases.flatMap((_, at) =>
		titles[at] !== undefined && titles[at]?.tmdbId == null && !titles[at]?.listed ? [at] : []
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
			// without the anime index a fansub cour would be placed on its own numbers
			// (`Hibike Euphonium 3 - 01` as season 1), so it waits for the index instead
			const waits =
				Date.now() > deadline ||
				titles[at] === undefined ||
				(!anime && [release.name, ...release.files.map((f) => f.path)].some(fansubShaped));
			out[at] = waits
				? skipped(release)
				: await placeRelease(release, titles[at] ?? null, sources, anime);
			if (!waits) out[at] = await secondLook(release, out[at], sources, anime);
			if (!waits) out[at] = await siblingLook(release, out[at], sources, anime);
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	return { releases: out, complete: out.every((release) => !release.skipped) };
}

const letters = (text = '') => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const placesFiles = (answer: PlacedRelease) => answer.files.some((file) => file.season !== null);

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
		const own = (match: IdentifierMatch) =>
			letters(match.title) === letters(answer.parsedTitle);
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
			if (!there.skipped && placesFiles(there)) tried.push(there);
		}
		if (tried.length === 1) return tried[0];
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
	const seasons = release.files.some(
		(f) => fileNumbers(release.name, f.folder, f.path, false)?.season != null
	);
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
						},
					]
				: []
		),
	};
	placement.tvdbOrder = tvdbOrderLookup(showId, sources, TVDB_ORDER);
	if (DUBBED.test(release.name)) placement.dubOrder = tvdbOrderLookup(showId, sources, DUB_ORDER);
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
	const numbers = absoluteFolders(
		release.files.map((file) => ({
			folder: file.folder,
			numbers: fileNumbers(release.name, file.folder, file.path, release.files.length === 1),
		})),
		placement.seasons
	);
	const placed: (Placement | null)[] = [];
	for (const [at, file] of release.files.entries()) {
		placed.push(
			numbers[at]
				? await placeFile(placement, anime, release.name, file.path, numbers[at]!, imdb)
				: null
		);
	}
	const yielded = yieldToTitles(keepImdbOrder(numbers, placed));
	// once a release's titled files show its numbers are not TMDB's (most of them), a file whose title placed it
	// nowhere is not placed by its number either: the 2003 Berenstain Bears' `E53 (New Neighbors)`,
	// a title TMDB lacks, counted to S2E26 "Count Their Blessings"
	const titles = release.files.map((file, at) => {
		const own = numbers[at];
		return own ? titleOf(file.path.split('/').pop() ?? file.path, own) : null;
	});
	// most of them: QI's pack numbers as TMDB does, its one titled stray aside
	const moved =
		yielded.filter(
			(found, at) =>
				found?.titled &&
				(found.season !== (numbers[at]!.season ?? found.season) ||
					found.episode !== numbers[at]!.episode)
		).length *
			2 >
		titles.filter(Boolean).length;
	// scene notation is the list's own numbering; a count or a folder's season is not
	const counted = (at: number) =>
		numbers[at]!.season === null || Boolean(numbers[at]!.coded || numbers[at]!.borrowed);
	const kept = yielded.map((found, at) =>
		found && !found.titled && titles[at] && (moved || (byTitle && counted(at))) ? null : found
	);
	// every rule lands on an episode of TMDB's season lists, which carry its id; IMDb's list has none
	const episodeId = async (found: Placement) =>
		placement.tmdbId > 0
			? ((await placement.episodes(found.season))?.find(
					(row) => row.episode === found.episode
				)?.id ?? null)
			: null;
	const placedAnswer = answer(
		await Promise.all(
			kept.map(async (found, at) => {
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
						}
					: unplaced(path);
			})
		)
	);
	titledFiles.set(placedAnswer, kept.filter((found) => found?.titled).length);
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

const TVDB_ORDER = /\btvdb\b/i;
const DUB_ORDER = /\bdub\b/i;
// `[Rillant] Medabots S01-03 (English Dubbed)`: numbered in the dub's own seasons
const DUBBED = /(?:^|[\s._([-])(?:english[\s._-]+)?dub(?:bed)?(?=[\s._)\]-]|$)/i;

/**
 * TMDB's episode for another order's season and episode: the nth episode of that season in the
 * show's episode group of that order ("TVDB Order", "Dub Order"), read once per release and only
 * when a file needs it.
 */
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
	searchTv: (query) =>
		getTmdbAuth()
			? settle(() => getMetadataCache().searchTmdbTitles('tv', query))
			: Promise.resolve(null),
	// asks about at most 300 names it has not answered today: zurg asks again daily
	identifier: (names) =>
		settle(() => identifyFilenamesRemembered(names, 300)).then((r) => r?.answers ?? null),
};
