/**
 * Links to AniDB entries, labelled for the pages that show them.
 *
 * Relations come from the Fribb dataset (`animeFranchise.ts`); titles, types
 * and posters come from the `Anime` table, which holds a row for 8,452 of the
 * 8,663 AniDB ids that have torrents. The newest seasons are the ones it
 * lacks (Frieren's second and third, Apothecary's third and fourth on
 * 2026-09-27), so those are labelled from Kitsu by the dataset's Kitsu id, and
 * failing that by their AniDB id and the dataset's type.
 */
import type { AnimeEntryRow } from '@/services/database/anime';
import { entriesForImdb, franchiseOf, type FranchiseIndex } from './animeFranchise';

export interface AnimeEntryLink {
	anidbId: number;
	title: string;
	/** TV, OVA, ONA, MOVIE, SPECIAL or UNKNOWN; null when neither source says. */
	type: string | null;
	poster: string;
}

export interface AnimeFranchise {
	anidbId: number;
	/** Whether either source has heard of this AniDB id at all. */
	known: boolean;
	/** The IMDb ids this entry is filed under, which are the IMDb show pages. */
	imdbIds: string[];
	/** The entry itself and every entry sharing one of its IMDb ids, in AniDB id order. */
	entries: AnimeEntryLink[];
}

export interface KitsuLabel {
	title: string;
	poster: string;
}

export interface AnimeEntrySources {
	index: FranchiseIndex | null;
	getRows: (ids: { anidbIds: number[]; imdbIds: string[] }) => Promise<AnimeEntryRow[]>;
	/** Labels an entry the table has no row for; null when Kitsu has none either. */
	getKitsuLabel?: (kitsuId: number) => Promise<KitsuLabel | null>;
}

export const MAX_IMDB_IDS_PER_LOOKUP = 100;
/** Kitsu lookups one request may make; the largest shared IMDb id covers 39 entries. */
const MAX_KITSU_LABELS_PER_REQUEST = 12;

async function kitsuLabels(
	anidbIds: number[],
	byAnidb: Map<number, AnimeEntryRow>,
	{ index, getKitsuLabel }: AnimeEntrySources
): Promise<Map<number, KitsuLabel>> {
	const labels = new Map<number, KitsuLabel>();
	if (!getKitsuLabel || !index) return labels;
	const wanted = anidbIds
		.filter((id) => !byAnidb.has(id))
		.map((id) => ({ id, kitsuId: index.byAnidb.get(id)?.kitsuId ?? null }))
		.filter((e): e is { id: number; kitsuId: number } => e.kitsuId !== null)
		.slice(0, MAX_KITSU_LABELS_PER_REQUEST);
	const answers = await Promise.allSettled(wanted.map((e) => getKitsuLabel(e.kitsuId)));
	answers.forEach((answer, i) => {
		if (answer.status === 'fulfilled' && answer.value?.title) {
			labels.set(wanted[i].id, answer.value);
		}
	});
	return labels;
}

function toLink(
	anidbId: number,
	row: AnimeEntryRow | undefined,
	index: FranchiseIndex | null,
	kitsu: KitsuLabel | undefined
): AnimeEntryLink {
	const entry = index?.byAnidb.get(anidbId);
	return {
		anidbId,
		title: row?.title || kitsu?.title || `AniDB ${anidbId}`,
		// The dataset's type first: it is refreshed daily, and the 38 keyed rows
		// that disagree with it are older imports (see /api/info/anime).
		type: entry?.type || row?.type || null,
		poster: row?.poster_url || kitsu?.poster || '',
	};
}

function rowsByAnidb(rows: AnimeEntryRow[]): Map<number, AnimeEntryRow> {
	const map = new Map<number, AnimeEntryRow>();
	for (const row of rows) if (row.anidb_id !== null) map.set(row.anidb_id, row);
	return map;
}

/**
 * The AniDB entries filed under each IMDb id, for the show, movie, browse and
 * search pages. IMDb ids with no entry are left out of the answer.
 */
export async function loadAnimeEntryLinks(
	imdbIds: readonly string[],
	sources: AnimeEntrySources
): Promise<Record<string, AnimeEntryLink[]>> {
	const { index, getRows } = sources;
	const wanted = [...new Set(imdbIds)];
	const fromIndex = new Map<string, number[]>();
	for (const imdbId of wanted) {
		const ids = index ? entriesForImdb(index, imdbId).map((e) => e.anidbId) : [];
		if (ids.length > 0) fromIndex.set(imdbId, ids);
	}

	const anidbIds = [...new Set([...fromIndex.values()].flat())];
	const rows = await getRows({ anidbIds, imdbIds: wanted });
	const byAnidb = rowsByAnidb(rows);

	const idsFor = new Map<string, number[]>();
	for (const imdbId of wanted) {
		const ids = new Set(fromIndex.get(imdbId) ?? []);
		// The table's own mapping, for the ids the dataset lacks or when it is down.
		for (const row of rows) {
			if (row.imdb_id === imdbId && row.anidb_id !== null) ids.add(row.anidb_id);
		}
		if (ids.size > 0)
			idsFor.set(
				imdbId,
				[...ids].sort((a, b) => a - b)
			);
	}
	const labels = await kitsuLabels([...new Set([...idsFor.values()].flat())], byAnidb, sources);

	const result: Record<string, AnimeEntryLink[]> = {};
	for (const [imdbId, ids] of idsFor) {
		result[imdbId] = ids.map((anidbId) =>
			toLink(anidbId, byAnidb.get(anidbId), index, labels.get(anidbId))
		);
	}
	return result;
}

/** One entry's franchise, for the anime page. */
export async function loadAnimeFranchise(
	anidbId: number,
	sources: AnimeEntrySources
): Promise<AnimeFranchise> {
	const { index, getRows } = sources;
	const entry = index?.byAnidb.get(anidbId) ?? null;
	const siblingIds = index ? franchiseOf(index, anidbId).map((e) => e.anidbId) : [];
	const rows = await getRows({
		anidbIds: [...new Set([anidbId, ...siblingIds])],
		imdbIds: [],
	});
	const byAnidb = rowsByAnidb(rows);
	const self = byAnidb.get(anidbId);

	const imdbIds = [
		...new Set([...(entry?.imdbIds ?? []), ...(self?.imdb_id ? [self.imdb_id] : [])]),
	];
	const known = Boolean(entry || self);
	const ids = siblingIds.length > 0 ? siblingIds : known ? [anidbId] : [];
	const labels = await kitsuLabels(ids, byAnidb, sources);

	return {
		anidbId,
		known,
		imdbIds,
		entries: ids.map((id) => toLink(id, byAnidb.get(id), index, labels.get(id))),
	};
}
