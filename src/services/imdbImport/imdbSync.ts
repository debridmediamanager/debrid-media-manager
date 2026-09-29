/**
 * Bring DMM's `imdb_*` tables up to date with IMDb's non-commercial dumps.
 *
 * Each dump is streamed in its own order (every file is sorted by its first
 * column) and compared a batch at a time with what the table already holds, so
 * only new and changed rows are written. The old importer upserted every row
 * every week: 59M `imdb_title_akas` upserts that took ~1.5 hours and spent an
 * auto-increment id each (2.32 billion of 4.29 billion used by 2026-09-29).
 *
 * Nothing is ever deleted. IMDb's dumps drop real titles — Knock at the Cabin
 * (tt15679400, 143k votes) was missing from the 2026-09-27 dump — so a row the
 * dump no longer carries is kept rather than trusted to be gone.
 *
 * A write that fails for a connection or lock reason is retried whole, and a
 * write MySQL rejects is split until the offending rows are found. Neither can
 * grow the next write. The old importer kept appending to a batch it could no
 * longer send: on 2026-09-27 its connection died and it spent 2.7 days
 * re-escaping an ever larger batch once per input row, counting each as an error.
 */

/** A dump line's fields. IMDb's TSV has no quoting; `\N` is null. */
export function parseImdbLine(line: string): (string | null)[] {
	return line.split('\t').map((field) => (field === '\\N' ? null : field));
}

type Kind = 'str' | 'int' | 'dec' | 'bool';
type Value = string | number | null;

interface Column {
	name: string;
	kind: Kind;
	/** Field index in the dump line. */
	from: number;
}

/** A link table filled from a comma-separated field of the parent dump. */
export interface LinkSpec {
	table: string;
	parentColumn: string;
	childColumn: string;
	from: number;
	/** The child is the id of a name in this table, created on first sight. */
	lookup?: string;
}

export interface TableSpec {
	file: string;
	table: string;
	/** The first key column is the one the dump is sorted by. */
	key: Column[];
	values: Column[];
	links?: LinkSpec[];
	/** A dump with fewer rows than this is a broken download. */
	minRows: number;
}

const str = (name: string, from: number): Column => ({ name, kind: 'str', from });
const int = (name: string, from: number): Column => ({ name, kind: 'int', from });

/** Row counts floor well under what each dump carried on 2026-09-27. */
export const IMDB_TABLES: TableSpec[] = [
	{
		file: 'title.ratings.tsv.gz',
		table: 'imdb_title_ratings',
		key: [str('tconst', 0)],
		values: [{ name: 'average_rating', kind: 'dec', from: 1 }, int('num_votes', 2)],
		minRows: 1_500_000, // 1,714,571
	},
	{
		file: 'title.basics.tsv.gz',
		table: 'imdb_title_basics',
		key: [str('tconst', 0)],
		values: [
			str('title_type', 1),
			str('primary_title', 2),
			str('original_title', 3),
			{ name: 'is_adult', kind: 'bool', from: 4 },
			int('start_year', 5),
			int('end_year', 6),
			int('runtime_minutes', 7),
		],
		links: [
			{
				table: 'imdb_title_genres',
				parentColumn: 'title_id',
				childColumn: 'genre_id',
				from: 8,
				lookup: 'imdb_genres',
			},
		],
		minRows: 11_000_000, // 12,819,789
	},
	{
		file: 'title.akas.tsv.gz',
		table: 'imdb_title_akas',
		key: [str('title_id', 0), int('ordering', 1)],
		values: [
			str('title', 2),
			str('region', 3),
			str('language', 4),
			str('types', 5),
			str('attributes', 6),
			{ name: 'is_original_title', kind: 'bool', from: 7 },
		],
		minRows: 50_000_000, // 59,3xx,xxx
	},
	{
		file: 'title.episode.tsv.gz',
		table: 'imdb_title_episode',
		key: [str('tconst', 0)],
		values: [str('parent_tconst', 1), int('season_number', 2), int('episode_number', 3)],
		minRows: 8_500_000, // 9,913,095
	},
	{
		file: 'name.basics.tsv.gz',
		table: 'imdb_name_basics',
		key: [str('nconst', 0)],
		values: [str('primary_name', 1), int('birth_year', 2), int('death_year', 3)],
		links: [
			{
				table: 'imdb_name_professions',
				parentColumn: 'name_id',
				childColumn: 'profession_id',
				from: 4,
				lookup: 'imdb_professions',
			},
			{
				table: 'imdb_name_known_titles',
				parentColumn: 'name_id',
				childColumn: 'title_id',
				from: 5,
			},
		],
		minRows: 13_000_000, // 14.9M
	},
];

/** A dump field as the column stores it. */
function fromDump(kind: Kind, field: string | null): Value {
	if (kind === 'bool') return field !== null && Number(field) ? 1 : 0;
	if (field === null) return null;
	if (kind === 'str') return field;
	const number = kind === 'int' ? Math.trunc(Number(field)) : Number(field);
	return Number.isFinite(number) ? number : null;
}

/** A value read back from MySQL, in the same shape `fromDump` produces. */
function fromDb(kind: Kind, value: unknown): Value {
	if (kind === 'bool') return value === true || Number(value) ? 1 : 0;
	if (value === null || value === undefined) return null;
	if (kind === 'str') return String(value);
	return Number(String(value));
}

/** The storage the sync reads from and writes to; `mysqlStore` is the real one. */
export interface ImdbStore {
	/** Rows of `table` whose `groupColumn` is one of `groups`, as raw values. */
	select(
		table: string,
		columns: string[],
		groupColumn: string,
		groups: string[]
	): Promise<unknown[][]>;
	/** Insert rows, overwriting `updateColumns` of rows whose key exists. */
	upsert(
		table: string,
		columns: string[],
		updateColumns: string[],
		rows: Value[][]
	): Promise<void>;
	/** Insert rows, skipping those whose key exists. */
	insertIgnore(table: string, columns: string[], rows: Value[][]): Promise<void>;
	/** Every row of a name lookup table. */
	names(table: string): Promise<Array<{ id: number; name: string }>>;
}

export class ImdbSyncFailure extends Error {}

export interface SyncOptions {
	/** Dump rows compared per database read; a batch always ends on a group boundary. */
	batchRows?: number;
	/** Rows per write. */
	writeRows?: number;
	/** More rows than this refused by MySQL fails the table. */
	maxRejected?: number;
	/** Attempts at a write that fails for a connection or lock reason. */
	attempts?: number;
	sleep?: (ms: number) => Promise<void>;
	log?: (message: string) => void;
	/** Count what would change without writing anything. */
	dryRun?: boolean;
}

export interface SyncResult {
	table: string;
	read: number;
	inserted: number;
	updated: number;
	unchanged: number;
	linksAdded: number;
	rejected: number;
}

const TRANSIENT =
	/server has closed the connection|connection lost|ECONNRESET|EPIPE|ETIMEDOUT|can't reach database|server has gone away|lock wait timeout|deadlock found|timed out fetching a new connection|\b(1205|1213|2006|2013)\b/i;
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

/** A failure that says nothing about the rows: the same write may succeed on a retry. */
export function isTransientDbError(error: unknown): boolean {
	const code = (error as { code?: unknown })?.code;
	if (typeof code === 'string' && TRANSIENT_PRISMA_CODES.has(code)) return true;
	return TRANSIENT.test(error instanceof Error ? error.message : String(error));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function syncTable(
	spec: TableSpec,
	lines: AsyncIterable<string> | Iterable<string>,
	store: ImdbStore,
	options: SyncOptions = {}
): Promise<SyncResult> {
	const batchRows = options.batchRows ?? 5000;
	const writeRows = options.writeRows ?? 1000;
	const maxRejected = options.maxRejected ?? 1000;
	const attempts = options.attempts ?? 6;
	const sleep = options.sleep ?? defaultSleep;
	const log = options.log ?? (() => {});
	const dryRun = options.dryRun ?? false;

	const result: SyncResult = {
		table: spec.table,
		read: 0,
		inserted: 0,
		updated: 0,
		unchanged: 0,
		linksAdded: 0,
		rejected: 0,
	};
	const keyNames = spec.key.map((c) => c.name);
	const valueNames = spec.values.map((c) => c.name);
	const allColumns = [...spec.key, ...spec.values];
	const lookups = new Map<string, Map<string, number>>();
	for (const link of spec.links ?? []) {
		if (link.lookup && !lookups.has(link.lookup)) {
			lookups.set(link.lookup, await loadNames(link.lookup));
		}
	}

	async function loadNames(table: string): Promise<Map<string, number>> {
		const rows = await retrying(`read ${table}`, () => store.names(table));
		return new Map(rows.map((r) => [r.name, Number(r.id)]));
	}

	async function retrying<T>(what: string, run: () => Promise<T>): Promise<T> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await run();
			} catch (error) {
				if (!isTransientDbError(error)) throw error;
				if (attempt >= attempts) {
					throw new ImdbSyncFailure(
						`${spec.table}: ${what} failed ${attempts} times: ${(error as Error).message}`
					);
				}
				const wait = 1000 * 2 ** (attempt - 1);
				log(
					`  ${spec.table}: ${what} failed (${(error as Error).message}); retry ${attempt} in ${wait}ms`
				);
				await sleep(wait);
			}
		}
	}

	/** Write rows, splitting a write MySQL refuses until the refused rows are isolated. */
	async function write(what: string, rows: Value[][], send: (rows: Value[][]) => Promise<void>) {
		if (dryRun || rows.length === 0) return;
		for (let at = 0; at < rows.length; at += writeRows) {
			await writeIsolating(what, rows.slice(at, at + writeRows), send);
		}
	}

	async function writeIsolating(
		what: string,
		rows: Value[][],
		send: (rows: Value[][]) => Promise<void>
	): Promise<void> {
		try {
			await retrying(what, () => send(rows));
		} catch (error) {
			if (error instanceof ImdbSyncFailure) throw error;
			if (rows.length === 1) {
				result.rejected++;
				log(
					`  ${spec.table}: refused ${JSON.stringify(rows[0].slice(0, 2))}: ${(error as Error).message}`
				);
				if (result.rejected > maxRejected) {
					throw new ImdbSyncFailure(
						`${spec.table}: MySQL refused more than ${maxRejected} rows`
					);
				}
				return;
			}
			const half = Math.ceil(rows.length / 2);
			await writeIsolating(what, rows.slice(0, half), send);
			await writeIsolating(what, rows.slice(half), send);
		}
	}

	async function childIds(
		link: LinkSpec,
		names: string[]
	): Promise<Map<string, number | string>> {
		if (!link.lookup) return new Map(names.map((n) => [n, n]));
		const ids = lookups.get(link.lookup)!;
		const missing = [...new Set(names.filter((n) => !ids.has(n)))];
		if (missing.length > 0 && !dryRun) {
			await write(
				`add to ${link.lookup}`,
				missing.map((n) => [n]),
				(rows) => store.insertIgnore(link.lookup!, ['name'], rows)
			);
			const reloaded = await loadNames(link.lookup);
			lookups.set(link.lookup, reloaded);
			return reloaded;
		}
		return ids;
	}

	async function syncLinks(link: LinkSpec, batch: (string | null)[][]) {
		const wanted: Array<[string, string]> = [];
		for (const fields of batch) {
			const list = fields[link.from];
			if (!list) continue;
			for (const child of list.split(',')) {
				const trimmed = child.trim();
				if (trimmed && trimmed !== '\\N') wanted.push([fields[0]!, trimmed]);
			}
		}
		if (wanted.length === 0) return;
		const ids = await childIds(
			link,
			wanted.map(([, child]) => child)
		);
		const parents = [...new Set(wanted.map(([parent]) => parent))];
		const existing = new Set(
			(
				await retrying(`read ${link.table}`, () =>
					store.select(
						link.table,
						[link.parentColumn, link.childColumn],
						link.parentColumn,
						parents
					)
				)
			).map(([parent, child]) => `${parent}\t${child}`)
		);
		const missing: Value[][] = [];
		const seen = new Set<string>();
		for (const [parent, child] of wanted) {
			const id = ids.get(child);
			if (id === undefined) continue; // dry run: a name the lookup table does not have yet
			const pair = `${parent}\t${id}`;
			if (existing.has(pair) || seen.has(pair)) continue;
			seen.add(pair);
			missing.push([parent, id]);
		}
		result.linksAdded += missing.length;
		await write(`add to ${link.table}`, missing, (rows) =>
			store.insertIgnore(link.table, [link.parentColumn, link.childColumn], rows)
		);
	}

	async function syncBatch(batch: (string | null)[][]) {
		const groups = [...new Set(batch.map((fields) => fields[0]!))];
		const current = new Map<string, Value[]>();
		const stored = await retrying(`read ${spec.table}`, () =>
			store.select(spec.table, [...keyNames, ...valueNames], keyNames[0], groups)
		);
		for (const row of stored) {
			const key = spec.key.map((c, i) => fromDb(c.kind, row[i])).join('\t');
			current.set(
				key,
				spec.values.map((c, i) => fromDb(c.kind, row[spec.key.length + i]))
			);
		}

		const changed: Value[][] = [];
		for (const fields of batch) {
			const row = allColumns.map((c) => fromDump(c.kind, fields[c.from] ?? null));
			const key = row.slice(0, spec.key.length).join('\t');
			const values = row.slice(spec.key.length);
			const before = current.get(key);
			if (!before) {
				result.inserted++;
				changed.push(row);
			} else if (before.some((v, i) => v !== values[i])) {
				result.updated++;
				changed.push(row);
			} else {
				result.unchanged++;
			}
		}
		await write(`write ${spec.table}`, changed, (rows) =>
			store.upsert(spec.table, [...keyNames, ...valueNames], valueNames, rows)
		);
		for (const link of spec.links ?? []) await syncLinks(link, batch);
	}

	let batch: (string | null)[][] = [];
	let header = true;
	let nextReport = 1_000_000;
	for await (const line of lines) {
		if (header) {
			header = false;
			continue;
		}
		if (!line) continue;
		const fields = parseImdbLine(line);
		if (batch.length >= batchRows && fields[0] !== batch[batch.length - 1][0]) {
			await syncBatch(batch);
			batch = [];
		}
		batch.push(fields);
		result.read++;
		if (result.read >= nextReport) {
			log(
				`  ${spec.table}: ${result.read.toLocaleString('en-US')} read, ${result.inserted} new, ${result.updated} changed`
			);
			nextReport += 1_000_000;
		}
	}
	if (batch.length > 0) await syncBatch(batch);

	if (result.read < spec.minRows) {
		throw new ImdbSyncFailure(
			`${spec.file} had ${result.read} rows, under the ${spec.minRows} a complete dump carries`
		);
	}
	return result;
}

/** `ImdbStore` over raw SQL, e.g. Prisma's `$queryRawUnsafe` and `$executeRawUnsafe`. */
export function mysqlStore(db: {
	query: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
	execute: (sql: string, params: unknown[]) => Promise<unknown>;
}): ImdbStore {
	const ident = (name: string) => {
		if (!/^[a-z_]+$/.test(name)) throw new Error(`bad identifier ${name}`);
		return `\`${name}\``;
	};
	const placeholders = (rows: Value[][]) =>
		rows.map((row) => `(${row.map(() => '?').join(', ')})`).join(', ');
	return {
		async select(table, columns, groupColumn, groups) {
			const rows = await db.query(
				`SELECT ${columns.map(ident).join(', ')} FROM ${ident(table)} WHERE ${ident(groupColumn)} IN (${groups.map(() => '?').join(', ')})`,
				groups
			);
			return rows.map((row) => columns.map((c) => row[c]));
		},
		async upsert(table, columns, updateColumns, rows) {
			await db.execute(
				`INSERT INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES ${placeholders(rows)} ` +
					`ON DUPLICATE KEY UPDATE ${updateColumns.map((c) => `${ident(c)} = VALUES(${ident(c)})`).join(', ')}`,
				rows.flat()
			);
		},
		async insertIgnore(table, columns, rows) {
			await db.execute(
				`INSERT IGNORE INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES ${placeholders(rows)}`,
				rows.flat()
			);
		},
		async names(table) {
			const rows = await db.query(`SELECT id, name FROM ${ident(table)}`, []);
			return rows.map((row) => ({ id: Number(row.id), name: String(row.name) }));
		},
	};
}
