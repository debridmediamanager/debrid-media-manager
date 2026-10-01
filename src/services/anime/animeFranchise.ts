/**
 * Which AniDB entries belong together, read from the Fribb anime-lists dataset.
 *
 * One AniDB entry is one season, cour, OVA or film. IMDb files a whole series
 * under one title, so an IMDb id names a franchise rather than an entry: in the
 * dataset on 2026-09-27, 1,116 IMDb ids covered 3,367 AniDB entries, and only
 * 51% of AniDB entries had an IMDb id at all.
 *
 * The `Anime` table cannot answer either question. Its `imdb_id` is unique, so
 * a shared id went to one row (the first TV season) and every other season of
 * the show has none, and it holds no relations. This reads the dataset the
 * mapping sync reads, keeps only what links entries, and holds it in memory.
 *
 * Two entries are related when they name the same IMDb id. That is the only
 * relation the dataset carries; a film with its own IMDb title is not linked
 * to the series it belongs to.
 */
import { FRIBB_ANIME_LIST_URL, type FribbAnimeEntry } from './animeMapping';

export interface FranchiseEntry {
	anidbId: number;
	/** The dataset's type: TV, OVA, ONA, MOVIE, SPECIAL or UNKNOWN. */
	type: string | null;
	imdbIds: string[];
	kitsuId: number | null;
	malId: number | null;
}

export interface FranchiseIndex {
	byAnidb: Map<number, FranchiseEntry>;
	/** Every entry naming an IMDb id, ascending by AniDB id. */
	byImdb: Map<string, number[]>;
}

const IMDB_ID = /^tt\d+$/;

const positiveInt = (value: unknown): number | null =>
	typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

/**
 * Builds the index from the dataset exactly as published. Entries without an
 * AniDB id are dropped (the anime page is keyed by one), and so are IMDb ids
 * that are not ids: 37 entries in the 2026-09-27 dataset name `""`, which would
 * otherwise make 37 unrelated titles one franchise.
 */
export function buildFranchiseIndex(raw: readonly FribbAnimeEntry[]): FranchiseIndex {
	const byAnidb = new Map<number, FranchiseEntry>();
	const byImdb = new Map<string, number[]>();

	for (const item of raw) {
		const anidbId = positiveInt(item?.anidb_id);
		if (anidbId === null || byAnidb.has(anidbId)) continue;

		const imdbIds = Array.isArray(item.imdb_id)
			? [
					...new Set(
						item.imdb_id
							.filter((id): id is string => typeof id === 'string')
							.map((id) => id.trim())
							.filter((id) => IMDB_ID.test(id))
					),
				]
			: [];
		const type = typeof item.type === 'string' && item.type.trim() ? item.type.trim() : null;

		byAnidb.set(anidbId, {
			anidbId,
			type,
			imdbIds,
			kitsuId: positiveInt(item.kitsu_id),
			malId: positiveInt(item.mal_id),
		});
		for (const imdbId of imdbIds) {
			const bucket = byImdb.get(imdbId);
			if (bucket) bucket.push(anidbId);
			else byImdb.set(imdbId, [anidbId]);
		}
	}

	for (const bucket of byImdb.values()) bucket.sort((a, b) => a - b);
	return { byAnidb, byImdb };
}

/**
 * The entries naming this IMDb id, in AniDB id order.
 *
 * AniDB assigns ids as entries are created, so a sequel's id follows its
 * prequel's: Bookworm runs 14727, 15293, 15300 (the OVA), 15634, 18302, and
 * Frieren 17617, 18886, 19977. That order is what the page calls earlier and
 * later; the dataset has no air dates to do better with.
 */
export function entriesForImdb(index: FranchiseIndex, imdbId: string): FranchiseEntry[] {
	return (index.byImdb.get(imdbId) ?? [])
		.map((anidbId) => index.byAnidb.get(anidbId))
		.filter((entry): entry is FranchiseEntry => entry !== undefined);
}

/**
 * The entry and every entry that shares one of its IMDb ids, in AniDB id
 * order. An entry with no IMDb id is a franchise of one.
 */
export function franchiseOf(index: FranchiseIndex, anidbId: number): FranchiseEntry[] {
	const self = index.byAnidb.get(anidbId);
	if (!self) return [];
	const ids = new Set<number>([anidbId]);
	for (const imdbId of self.imdbIds) {
		for (const sibling of index.byImdb.get(imdbId) ?? []) ids.add(sibling);
	}
	return [...ids]
		.sort((a, b) => a - b)
		.map((id) => index.byAnidb.get(id))
		.filter((entry): entry is FranchiseEntry => entry !== undefined);
}

export type Fetcher = typeof fetch;

/** The dataset is regenerated about daily; a day-old copy is fine. */
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
/** After a failed download, how long to answer from what we have before retrying. */
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30 * 1000;

let cached: { index: FranchiseIndex; loadedAt: number } | null = null;
let lastFailureAt = 0;
let inFlight: Promise<FranchiseIndex | null> | null = null;

async function download(fetcher: Fetcher): Promise<FranchiseIndex | null> {
	try {
		const res = await fetcher(FRIBB_ANIME_LIST_URL, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = await res.json();
		if (!Array.isArray(raw)) throw new Error('not an array');
		const index = buildFranchiseIndex(raw as FribbAnimeEntry[]);
		cached = { index, loadedAt: Date.now() };
		return index;
	} catch (error) {
		lastFailureAt = Date.now();
		console.error(
			'Could not load the Fribb anime-lists dataset:',
			error instanceof Error ? error.message : 'unknown error'
		);
		return cached?.index ?? null;
	}
}

/**
 * The index, downloading it on first use and once a day after that.
 *
 * Callers must treat null as "unknown", not "no relations": the download can
 * fail, and the `Anime` table still answers for the entry itself.
 */
export async function getFranchiseIndex(fetcher: Fetcher = fetch): Promise<FranchiseIndex | null> {
	const now = Date.now();
	if (cached && now - cached.loadedAt < INDEX_TTL_MS) return cached.index;
	if (now - lastFailureAt < RETRY_AFTER_FAILURE_MS) return cached?.index ?? null;
	if (!inFlight) {
		inFlight = download(fetcher).finally(() => {
			inFlight = null;
		});
	}
	return inFlight;
}

/** Test hook: forget the downloaded index. */
export function resetFranchiseIndexForTests(): void {
	cached = null;
	lastFailureAt = 0;
	inFlight = null;
}
