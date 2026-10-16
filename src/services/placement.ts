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
	/** TMDB's show details (seasons with episode counts and air dates, names, external ids). */
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
	return typeof tmdbId === 'number' ? { kind, imdbId, tmdbId } : { kind, imdbId, tmdbId: null };
}

async function placeRelease(
	release: PlaceRequest,
	title: Title | null,
	sources: PlacementSources,
	anime: AnimeIndex | null
): Promise<PlacedRelease> {
	let imdbId = title?.imdbId ?? null;
	let kind: PlacedRelease['kind'] = title?.kind ?? null;
	let tmdbId: number | null = title?.tmdbId ?? null;
	// a fansub release TMDB could not name by its IMDb id: the anime index names its show
	const hit =
		tmdbId === null && anime && fansubShaped(release.name)
			? lookupAnime(anime, release.name, release.files[0]?.path ?? '')
			: null;
	if (hit) {
		kind = 'tv';
		tmdbId = hit.target.tmdb;
	}
	const answer = (files: PlacedFile[]): PlacedRelease => ({ kind, imdbId, tmdbId, files });
	if (kind !== 'tv' || tmdbId === null) {
		return answer(release.files.map((file) => unplaced(file.path)));
	}

	const showId = tmdbId;
	const details = await sources.show(showId);
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

/** DMM's own caches: TMDB through `metadataCache`, IMDb's episodes and anime titles from the database. */
export const cachedSources: PlacementSources = {
	find: (imdbId) =>
		getTmdbAuth()
			? settle(() => getMetadataCache().searchTmdbByImdb(imdbId))
			: Promise.resolve(null),
	show: (tmdbId) =>
		getTmdbAuth()
			? settle(() => getMetadataCache().getTmdbTvInfo(tmdbId, TMDB_TV_APPEND))
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
