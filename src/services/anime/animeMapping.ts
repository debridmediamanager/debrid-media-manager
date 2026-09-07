/**
 * Anime id mappings from the Fribb anime-lists dataset.
 *
 * The `Anime` table is keyed by several external ids at once (anidb, kitsu,
 * mal, anime-planet, imdb) but only 4.7% of its rows carry an imdb id, which is
 * the id every other DMM surface — search, Stremio, torznab — is keyed by. This
 * dataset is the same id table the *arr ecosystem uses, published as a static
 * JSON file, so filling those gaps costs one download rather than a per-title
 * call to a third party at request time.
 */

export const FRIBB_ANIME_LIST_URL =
	'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';

/** One entry exactly as the dataset publishes it. */
export interface FribbAnimeEntry {
	type?: string;
	anidb_id?: number;
	anilist_id?: number;
	'anime-planet_id'?: string;
	animecountdown_id?: number;
	animenewsnetwork_id?: number;
	anisearch_id?: number;
	/** Always an array. Two entries means the release maps to two IMDb titles. */
	imdb_id?: string[];
	kitsu_id?: number;
	livechart_id?: number;
	mal_id?: number;
	simkl_id?: number;
	/** Either `{ tv: 123 }` or `{ movie: [123] }`. */
	themoviedb_id?: { tv?: number; movie?: number[] };
	tvdb_id?: number;
	season?: { tvdb?: number; tmdb?: number };
	episode_offset?: { tvdb?: number; tmdb?: number };
}

export interface AnimeIdMapping {
	anidbId: number | null;
	kitsuId: number | null;
	malId: number | null;
	animePlanetId: string | null;
	/** Null when the entry maps to more than one IMDb title — see below. */
	imdbId: string | null;
	tmdbId: number | null;
	tmdbType: 'tv' | 'movie' | null;
	tvdbId: number | null;
	simklId: number | null;
	type: string | null;
}

const asPositiveInt = (value: unknown): number | null =>
	typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

const asNonEmptyString = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * `imdb_id` is an array because a single anime entry can map to two IMDb
 * titles (a film released in two cuts, say). `Anime.imdb_id` is `@unique`, so
 * an ambiguous entry has no correct single value and is dropped rather than
 * guessed — picking the first would silently claim an id the other title owns.
 */
function pickSingleImdbId(raw: FribbAnimeEntry): string | null {
	const ids = raw.imdb_id;
	if (!Array.isArray(ids) || ids.length !== 1) return null;
	const id = asNonEmptyString(ids[0]);
	return id && /^tt\d+$/.test(id) ? id : null;
}

function pickTmdb(raw: FribbAnimeEntry): { id: number | null; type: 'tv' | 'movie' | null } {
	const tmdb = raw.themoviedb_id;
	if (!tmdb || typeof tmdb !== 'object') return { id: null, type: null };

	const tv = asPositiveInt(tmdb.tv);
	if (tv) return { id: tv, type: 'tv' };

	// The movie form is a list for the same reason imdb_id is; one entry only.
	if (Array.isArray(tmdb.movie) && tmdb.movie.length === 1) {
		const movie = asPositiveInt(tmdb.movie[0]);
		if (movie) return { id: movie, type: 'movie' };
	}
	return { id: null, type: null };
}

export function normalizeFribbEntry(raw: FribbAnimeEntry): AnimeIdMapping {
	const tmdb = pickTmdb(raw);
	return {
		anidbId: asPositiveInt(raw.anidb_id),
		kitsuId: asPositiveInt(raw.kitsu_id),
		malId: asPositiveInt(raw.mal_id),
		animePlanetId: asNonEmptyString(raw['anime-planet_id']),
		imdbId: pickSingleImdbId(raw),
		tmdbId: tmdb.id,
		tmdbType: tmdb.type,
		tvdbId: asPositiveInt(raw.tvdb_id),
		simklId: asPositiveInt(raw.simkl_id),
		type: asNonEmptyString(raw.type),
	};
}

/** True when the mapping carries at least one id we can match a row on. */
export function hasMatchableId(mapping: AnimeIdMapping): boolean {
	return Boolean(mapping.anidbId || mapping.kitsuId || mapping.malId || mapping.animePlanetId);
}

export type Fetcher = typeof fetch;

export async function fetchAnimeIdMappings(fetcher: Fetcher = fetch): Promise<AnimeIdMapping[]> {
	const res = await fetcher(FRIBB_ANIME_LIST_URL);
	if (!res.ok) {
		throw new Error(`Fribb anime-lists fetch failed: ${res.status}`);
	}
	const raw = await res.json();
	if (!Array.isArray(raw)) {
		throw new Error('Fribb anime-lists did not return an array');
	}
	return raw.map(normalizeFribbEntry).filter(hasMatchableId);
}

/**
 * Index by a numeric id, skipping entries without one. Ids repeat across the
 * dataset (two seasons of one show share a tvdb id), so the caller gets every
 * mapping for a key rather than a silently-last-wins single value.
 */
export function indexMappingsBy(
	mappings: AnimeIdMapping[],
	key: 'anidbId' | 'kitsuId' | 'malId'
): Map<number, AnimeIdMapping[]> {
	const index = new Map<number, AnimeIdMapping[]>();
	for (const mapping of mappings) {
		const id = mapping[key];
		if (id === null) continue;
		const bucket = index.get(id);
		if (bucket) bucket.push(mapping);
		else index.set(id, [mapping]);
	}
	return index;
}
