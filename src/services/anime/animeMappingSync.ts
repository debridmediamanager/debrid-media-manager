import type { AnimeIdMapping } from './animeMapping';

/** The subset of an `Anime` row this sync reads and writes. */
export interface AnimeRow {
	id: number;
	anidb_id: number | null;
	kitsu_id: number | null;
	mal_id: number | null;
	anime_planet_id: string | null;
	imdb_id: string | null;
}

export type SyncableColumn = 'anidb_id' | 'kitsu_id' | 'mal_id' | 'anime_planet_id' | 'imdb_id';

/** Column types match the schema so the object is a valid Prisma update. */
export interface AnimeMappingFields {
	anidb_id?: number;
	kitsu_id?: number;
	mal_id?: number;
	anime_planet_id?: string;
	imdb_id?: string;
}

export interface AnimeRowUpdate {
	id: number;
	fields: AnimeMappingFields;
}

export interface SyncPlan {
	updates: AnimeRowUpdate[];
	/** Values dropped because another row already owns them. */
	collisions: Record<SyncableColumn, number>;
	/** Rows whose match id appears more than once in the dataset. */
	ambiguousRows: number;
	/** Rows matched to an entry that another of their own ids contradicts. */
	conflictingRows: number;
	matchedRows: number;
}

const COLUMNS: { column: SyncableColumn; from: keyof AnimeIdMapping }[] = [
	{ column: 'anidb_id', from: 'anidbId' },
	{ column: 'kitsu_id', from: 'kitsuId' },
	{ column: 'mal_id', from: 'malId' },
	{ column: 'anime_planet_id', from: 'animePlanetId' },
	{ column: 'imdb_id', from: 'imdbId' },
];

/**
 * The ids that identify a title. A row and an entry that both carry one of
 * these and disagree on it describe two different titles.
 *
 * The anime-planet slug is left out on purpose: anime-planet renames its slugs
 * (`ameku-takao-no-suiri-karte` became `ameku-md-doctor-detective`), so a row
 * scraped years ago disagrees with the dataset on the slug alone while every
 * numeric id still matches.
 */
const IDENTITY: {
	column: 'anidb_id' | 'kitsu_id' | 'mal_id' | 'imdb_id';
	from: keyof AnimeIdMapping;
}[] = [
	{ column: 'anidb_id', from: 'anidbId' },
	{ column: 'kitsu_id', from: 'kitsuId' },
	{ column: 'mal_id', from: 'malId' },
	{ column: 'imdb_id', from: 'imdbId' },
];

function contradicts(row: AnimeRow, mapping: AnimeIdMapping): boolean {
	return IDENTITY.some(({ column, from }) => {
		const ours = row[column];
		const theirs = mapping[from];
		return ours !== null && theirs !== null && ours !== theirs;
	});
}

/**
 * Match a row to exactly one mapping.
 *
 * Ids are tried most- to least-specific. A row is left alone when its id
 * appears on several dataset entries: two seasons of one show share a mal id,
 * and merging their ids into one row would attribute the wrong season's imdb
 * id to it.
 *
 * It is also left alone when the entry its first id finds is contradicted by
 * another of its ids. Such a row already mixes two titles' ids, and filling it
 * from either entry only adds a third wrong one: production's "Geu Yeoreum" row
 * matched on its kitsu id to anidb 19021 while its own mal id and slug both
 * belong to anidb 17512.
 */
function findMapping(
	row: AnimeRow,
	indexes: Record<
		'anidb' | 'kitsu' | 'mal' | 'animePlanet',
		Map<string | number, AnimeIdMapping[]>
	>
): { mapping: AnimeIdMapping | null; ambiguous: boolean; conflicting: boolean } {
	const candidates: (AnimeIdMapping[] | undefined)[] = [
		row.anidb_id !== null ? indexes.anidb.get(row.anidb_id) : undefined,
		row.kitsu_id !== null ? indexes.kitsu.get(row.kitsu_id) : undefined,
		row.mal_id !== null ? indexes.mal.get(row.mal_id) : undefined,
		row.anime_planet_id !== null ? indexes.animePlanet.get(row.anime_planet_id) : undefined,
	];

	for (const bucket of candidates) {
		if (!bucket || bucket.length === 0) continue;
		if (bucket.length > 1) return { mapping: null, ambiguous: true, conflicting: false };
		if (contradicts(row, bucket[0]))
			return { mapping: null, ambiguous: false, conflicting: true };
		return { mapping: bucket[0], ambiguous: false, conflicting: false };
	}
	return { mapping: null, ambiguous: false, conflicting: false };
}

/**
 * The order rows claim values in; lower goes first.
 *
 * Several entries can name one IMDb title (a show's later seasons, its OVAs and
 * recaps all carry the show's id), and the unique column lets only one row
 * have it. Handing it to whichever row sorted first gave `.hack//Sign`'s id to
 * the `.hack//G.U. Returner` OVA and A3!'s to its second season. The first
 * season's TV entry is the one a viewer means by the title.
 */
function claimRank(mapping: AnimeIdMapping): number[] {
	const season = mapping.tvdbSeason === 1 ? 0 : mapping.tvdbSeason === null ? 1 : 2;
	const type = mapping.type === 'TV' ? 0 : 1;
	return [season, type, mapping.tvdbEpisodeOffset ?? 0];
}

function compareClaims(
	a: { row: AnimeRow; mapping: AnimeIdMapping },
	b: { row: AnimeRow; mapping: AnimeIdMapping }
): number {
	const rankA = claimRank(a.mapping);
	const rankB = claimRank(b.mapping);
	for (let i = 0; i < rankA.length; i++) {
		if (rankA[i] !== rankB[i]) return rankA[i] - rankB[i];
	}
	return a.row.id - b.row.id;
}

function buildIndex<T extends string | number>(
	mappings: AnimeIdMapping[],
	key: keyof AnimeIdMapping
): Map<T, AnimeIdMapping[]> {
	const index = new Map<T, AnimeIdMapping[]>();
	for (const mapping of mappings) {
		const value = mapping[key] as T | null;
		if (value === null || value === undefined) continue;
		const bucket = index.get(value);
		if (bucket) bucket.push(mapping);
		else index.set(value, [mapping]);
	}
	return index;
}

/**
 * Work out which columns can be filled in, without writing anything.
 *
 * Every syncable column is `@unique` in the schema, so a value already held by
 * another row is dropped rather than written — a collision would abort the
 * whole batch, and the row that already owns the id is the better claim.
 */
export function planAnimeMappingUpdates(rows: AnimeRow[], mappings: AnimeIdMapping[]): SyncPlan {
	const indexes = {
		anidb: buildIndex<number>(mappings, 'anidbId'),
		kitsu: buildIndex<number>(mappings, 'kitsuId'),
		mal: buildIndex<number>(mappings, 'malId'),
		animePlanet: buildIndex<string>(mappings, 'animePlanetId'),
	} as Record<'anidb' | 'kitsu' | 'mal' | 'animePlanet', Map<string | number, AnimeIdMapping[]>>;

	// Values already spoken for, by an existing row or by an earlier update in
	// this same run.
	const taken: Record<SyncableColumn, Set<string | number>> = {
		anidb_id: new Set(),
		kitsu_id: new Set(),
		mal_id: new Set(),
		anime_planet_id: new Set(),
		imdb_id: new Set(),
	};
	for (const row of rows) {
		for (const { column } of COLUMNS) {
			const value = row[column];
			if (value !== null) taken[column].add(value);
		}
	}

	const collisions: Record<SyncableColumn, number> = {
		anidb_id: 0,
		kitsu_id: 0,
		mal_id: 0,
		anime_planet_id: 0,
		imdb_id: 0,
	};
	const updates: AnimeRowUpdate[] = [];
	let ambiguousRows = 0;
	let conflictingRows = 0;
	let matchedRows = 0;

	const matched: { row: AnimeRow; mapping: AnimeIdMapping }[] = [];
	for (const row of rows) {
		const { mapping, ambiguous, conflicting } = findMapping(row, indexes);
		if (ambiguous) {
			ambiguousRows++;
			continue;
		}
		if (conflicting) {
			conflictingRows++;
			continue;
		}
		if (!mapping) continue;
		matchedRows++;
		matched.push({ row, mapping });
	}
	matched.sort(compareClaims);

	for (const { row, mapping } of matched) {
		const fields: AnimeMappingFields = {};
		for (const { column, from } of COLUMNS) {
			if (row[column] !== null) continue;
			const value = mapping[from];
			if (value === null) continue;
			if (taken[column].has(value)) {
				collisions[column]++;
				continue;
			}
			if (column === 'anime_planet_id' || column === 'imdb_id') {
				if (typeof value !== 'string') continue;
				fields[column] = value;
			} else {
				if (typeof value !== 'number') continue;
				fields[column] = value;
			}
			taken[column].add(value);
		}

		if (Object.keys(fields).length > 0) updates.push({ id: row.id, fields });
	}

	return { updates, collisions, ambiguousRows, conflictingRows, matchedRows };
}

export function summarizePlan(plan: SyncPlan): Record<string, number> {
	const filled: Record<string, number> = {};
	for (const { column } of COLUMNS) {
		filled[column] = plan.updates.filter((u) => u.fields[column] !== undefined).length;
	}
	return {
		rowsToUpdate: plan.updates.length,
		matchedRows: plan.matchedRows,
		ambiguousRows: plan.ambiguousRows,
		conflictingRows: plan.conflictingRows,
		...filled,
	};
}
