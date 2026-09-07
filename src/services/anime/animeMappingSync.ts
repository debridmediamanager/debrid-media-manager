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
 * Match a row to exactly one mapping.
 *
 * Ids are tried most- to least-specific. A row is left alone when its id
 * appears on several dataset entries: two seasons of one show share a mal id,
 * and merging their ids into one row would attribute the wrong season's imdb
 * id to it.
 */
function findMapping(
	row: AnimeRow,
	indexes: Record<
		'anidb' | 'kitsu' | 'mal' | 'animePlanet',
		Map<string | number, AnimeIdMapping[]>
	>
): { mapping: AnimeIdMapping | null; ambiguous: boolean } {
	const candidates: (AnimeIdMapping[] | undefined)[] = [
		row.anidb_id !== null ? indexes.anidb.get(row.anidb_id) : undefined,
		row.kitsu_id !== null ? indexes.kitsu.get(row.kitsu_id) : undefined,
		row.mal_id !== null ? indexes.mal.get(row.mal_id) : undefined,
		row.anime_planet_id !== null ? indexes.animePlanet.get(row.anime_planet_id) : undefined,
	];

	for (const bucket of candidates) {
		if (!bucket || bucket.length === 0) continue;
		if (bucket.length > 1) return { mapping: null, ambiguous: true };
		return { mapping: bucket[0], ambiguous: false };
	}
	return { mapping: null, ambiguous: false };
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
	let matchedRows = 0;

	for (const row of rows) {
		const { mapping, ambiguous } = findMapping(row, indexes);
		if (ambiguous) {
			ambiguousRows++;
			continue;
		}
		if (!mapping) continue;
		matchedRows++;

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

	return { updates, collisions, ambiguousRows, matchedRows };
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
		...filled,
	};
}
