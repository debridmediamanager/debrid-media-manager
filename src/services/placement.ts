/**
 * What each release of a sponsor's library is and where its files go on TMDB, for
 * `/api/sponsor/place`: the release's movie or show (an IMDb id the caller knows, else
 * content-identifier's answer for its name), then each file's TMDB season and episode by the
 * rules in `@/utils/episodePlacement`. Every provider answer comes from DMM's caches.
 */
import { getFranchiseIndex, type FranchiseIndex } from '@/services/anime/animeFranchise';
import { getAnimeSynonyms } from '@/services/anime/animeSynonyms';
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
	placeFile,
	yieldToTitles,
	type AnimeIndex,
	type ImdbLookup,
	type Placement,
	type PlacementRule,
} from '@/utils/episodePlacement';
import { getTmdbAuth } from '@/utils/tmdbAuth';

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
	/** IMDb's episode ids of one season of a show, by episode number. */
	seasonEpisodes(showImdbId: string, season: number): Promise<Map<number, string>>;
	anime(): Promise<AnimeIndex | null>;
}

/** Releases placed at once; each one's files go one after another, sharing its lookups. */
const CONCURRENCY = 4;

const unplaced = (path: string): PlacedFile => ({
	path,
	season: null,
	episode: null,
	episodeEnd: null,
	how: null,
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
	const ask = releases.flatMap((_, at) =>
		titles[at] !== undefined && titles[at]?.tmdbId == null ? [at] : []
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
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	return { releases: out, complete: out.every((release) => !release.skipped) };
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
	if (typeof tmdbId !== 'number') return { kind, imdbId, tmdbId: null };
	// DMM's cached find for tt14986406 names show 335660, which TMDB has since deleted: one TMDB
	// cannot use, so the release's name names it
	if (kind === 'tv' && deleted(await sources.show(tmdbId))) return { kind, imdbId, tmdbId: null };
	return { kind, imdbId, tmdbId };
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
	if (indexed) return placeOnShow(release, indexed, true, sources, anime);
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
		Promise<{ episode: number; name: string; airDate: string | null }[] | null>
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
								}))
								.sort((a, b) => a.episode - b.episode)
						: null
				)
			);
		}
		return lists.get(season)!;
	};
	const placement = {
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
	const imdb = imdbId ? imdbLookup(imdbId, tmdbId, sources) : null;
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
	return answer(
		yieldToTitles(keepImdbOrder(numbers, placed)).map((found, at) => {
			const path = release.files[at].path;
			return found
				? {
						path,
						season: found.season,
						episode: found.episode,
						episodeEnd: found.episodeEnd,
						how: found.how,
					}
				: unplaced(path);
		})
	);
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
	episodeShow: (imdbId) => repository.getImdbEpisodeShow(imdbId),
	seasonEpisodes: (show, season) => repository.getImdbSeasonEpisodeIds(show, season),
	anime: () => settle(currentAnimeIndex),
};
