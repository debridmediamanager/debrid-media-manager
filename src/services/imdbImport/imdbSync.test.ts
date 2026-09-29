import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
	IMDB_TABLES,
	ImdbSyncFailure,
	isTransientDbError,
	mysqlStore,
	parseImdbLine,
	syncTable,
	type ImdbStore,
	type TableSpec,
} from './imdbSync';

// Real lines from IMDb's 2026-09-27 dumps. The akas sample starts at tt5483304,
// the batch the old importer was stuck re-sending when its connection died.
const fixture = (name: string) =>
	readFileSync(join(__dirname, '__fixtures__', name), 'utf8').split('\n');
const AKAS = fixture('title.akas.sample.tsv');
const BASICS = fixture('title.basics.sample.tsv');

const spec = (table: string): TableSpec => ({
	...IMDB_TABLES.find((t) => t.table === table)!,
	minRows: 0,
});
const noSleep = async () => {};

type Row = unknown[];

/** An in-memory `ImdbStore` that records every call. */
function memoryStore() {
	const tables = new Map<
		string,
		{ columns: string[]; keyCount: number; rows: Map<string, Row> }
	>();
	const writes: Array<{ table: string; rows: number }> = [];
	const selects: Array<{ table: string; groups: string[] }> = [];
	const table = (name: string, columns: string[], keyCount: number) => {
		if (!tables.has(name)) tables.set(name, { columns, keyCount, rows: new Map() });
		return tables.get(name)!;
	};
	const store: ImdbStore = {
		async select(name, columns, groupColumn, groups) {
			selects.push({ table: name, groups });
			const t = tables.get(name);
			if (!t) return [];
			const at = t.columns.indexOf(groupColumn);
			return [...t.rows.values()]
				.filter((row) => groups.includes(String(row[at])))
				.map((row) => columns.map((c) => row[t.columns.indexOf(c)]));
		},
		async upsert(name, columns, updateColumns, rows) {
			writes.push({ table: name, rows: rows.length });
			const t = table(name, columns, columns.length - updateColumns.length);
			for (const row of rows) t.rows.set(row.slice(0, t.keyCount).join('\t'), row);
		},
		async insertIgnore(name, columns, rows) {
			writes.push({ table: name, rows: rows.length });
			if (name === 'imdb_genres' || name === 'imdb_professions') {
				const t = table(name, ['id', 'name'], 1);
				for (const [n] of rows) {
					if (![...t.rows.values()].some((r) => r[1] === n)) {
						t.rows.set(String(t.rows.size + 1), [t.rows.size + 1, n]);
					}
				}
				return;
			}
			const t = table(name, columns, columns.length);
			for (const row of rows) {
				const key = row.join('\t');
				if (!t.rows.has(key)) t.rows.set(key, row);
			}
		},
		async names(name) {
			const t = tables.get(name);
			return t
				? [...t.rows.values()].map(([id, n]) => ({ id: Number(id), name: String(n) }))
				: [];
		},
	};
	return { store, tables, writes, selects };
}

const connectionClosed = () =>
	Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' });

describe('parseImdbLine', () => {
	it('reads a title with an unmatched leading quote as written', () => {
		// csv.reader treated the quote as opening a quoted field and swallowed the
		// next tab into the title; the row landed with its columns shifted.
		const line = BASICS.find((l) => l.startsWith('tt10233364\t'))!;
		const fields = parseImdbLine(line);

		expect(fields).toHaveLength(9);
		expect(fields[2]).toBe('"Rolling in the Deep Dish');
		expect(fields[3]).toBe('"Rolling in the Deep Dish');
		expect(fields[5]).toBe('2019');
		expect(fields[6]).toBeNull();
	});
});

describe('syncTable', () => {
	it('writes a fresh table, then writes nothing when the dump has not changed', async () => {
		const { store, tables, writes } = memoryStore();

		const first = await syncTable(spec('imdb_title_akas'), AKAS, store, { batchRows: 50 });
		expect(first).toMatchObject({ read: 600, inserted: 600, updated: 0, rejected: 0 });
		expect(tables.get('imdb_title_akas')!.rows.get('tt5483304\t2')).toEqual([
			'tt5483304',
			2,
			'Episódio #1.55',
			'PT',
			'pt',
			null,
			null,
			0,
		]);

		writes.length = 0;
		const second = await syncTable(spec('imdb_title_akas'), AKAS, store, { batchRows: 50 });
		expect(second).toMatchObject({ read: 600, inserted: 0, updated: 0, unchanged: 600 });
		// An unchanged row costs no write, so it spends no auto-increment id.
		expect(writes).toEqual([]);
	});

	it('writes only the rows whose values changed', async () => {
		const { store, tables, writes } = memoryStore();
		await syncTable(spec('imdb_title_akas'), AKAS, store, { batchRows: 50 });
		tables.get('imdb_title_akas')!.rows.get('tt5483304\t2')![2] = 'stale title';
		writes.length = 0;

		const result = await syncTable(spec('imdb_title_akas'), AKAS, store, { batchRows: 50 });

		expect(result).toMatchObject({ updated: 1, inserted: 0, unchanged: 599 });
		expect(writes).toEqual([{ table: 'imdb_title_akas', rows: 1 }]);
		expect(tables.get('imdb_title_akas')!.rows.get('tt5483304\t2')![2]).toBe('Episódio #1.55');
	});

	it('never splits a title across batches', async () => {
		const { store, selects } = memoryStore();
		await syncTable(spec('imdb_title_akas'), AKAS, store, { batchRows: 7 });

		const requested = selects.flatMap((s) => s.groups);
		expect(new Set(requested).size).toBe(requested.length);
	});

	it('recovers when the connection drops mid-import and loses no row', async () => {
		const { store, tables } = memoryStore();
		let calls = 0;
		const sent: number[] = [];
		const flaky: ImdbStore = {
			...store,
			async upsert(...args) {
				calls++;
				sent.push(args[3].length);
				if (calls === 3 || calls === 4) throw connectionClosed();
				return store.upsert(...args);
			},
		};

		const result = await syncTable(spec('imdb_title_akas'), AKAS, flaky, {
			batchRows: 50,
			writeRows: 25,
			sleep: noSleep,
		});

		expect(result).toMatchObject({ read: 600, inserted: 600, rejected: 0 });
		expect(tables.get('imdb_title_akas')!.rows.size).toBe(600);
		// The old importer kept growing the batch it could not send; a retry
		// must send the same rows, never more.
		expect(Math.max(...sent)).toBeLessThanOrEqual(25);
	});

	it('fails the run, after a bounded number of attempts, when the database stays down', async () => {
		const { store } = memoryStore();
		let calls = 0;
		const down: ImdbStore = {
			...store,
			async upsert() {
				calls++;
				throw connectionClosed();
			},
		};

		await expect(
			syncTable(spec('imdb_title_akas'), AKAS, down, {
				batchRows: 50,
				attempts: 4,
				sleep: noSleep,
			})
		).rejects.toBeInstanceOf(ImdbSyncFailure);
		// Not one attempt per remaining input row, which is how the old importer
		// spent 2.7 days: it failed fast and counted every row as an error.
		expect(calls).toBe(4);
	});

	it('skips only the rows MySQL refuses', async () => {
		const { store, tables } = memoryStore();
		const picky: ImdbStore = {
			...store,
			async upsert(table, columns, update, rows) {
				if (rows.some((r) => r[0] === 'tt5483304' && r[1] === 2)) {
					throw new Error("Data too long for column 'title' at row 1");
				}
				return store.upsert(table, columns, update, rows);
			},
		};

		const result = await syncTable(spec('imdb_title_akas'), AKAS, picky, { batchRows: 50 });

		expect(result).toMatchObject({ rejected: 1 });
		expect(tables.get('imdb_title_akas')!.rows.size).toBe(599);
	});

	it('fails the table once MySQL refuses more rows than allowed', async () => {
		const { store } = memoryStore();
		const refusing: ImdbStore = {
			...store,
			async upsert() {
				throw new Error("Data too long for column 'title' at row 1");
			},
		};

		await expect(
			syncTable(spec('imdb_title_akas'), AKAS, refusing, { batchRows: 50, maxRejected: 3 })
		).rejects.toThrow('refused more than 3 rows');
	});

	it('fills genres and title links, and adds none on a rerun', async () => {
		const { store, tables } = memoryStore();

		const first = await syncTable(spec('imdb_title_basics'), BASICS, store);
		const genres = new Map(
			[...tables.get('imdb_genres')!.rows.values()].map(([id, name]) => [name, id])
		);
		const links = [...tables.get('imdb_title_genres')!.rows.values()];

		expect(first.inserted).toBe(8);
		expect(links).toContainEqual(['tt0471711', genres.get('Animation')]);
		expect(links).toContainEqual(['tt10233364', genres.get('Reality-TV')]);

		const second = await syncTable(spec('imdb_title_basics'), BASICS, store);
		expect(second).toMatchObject({ inserted: 0, updated: 0, linksAdded: 0 });
	});

	it('refuses a dump shorter than a complete one', async () => {
		const { store } = memoryStore();
		await expect(
			syncTable({ ...spec('imdb_title_akas'), minRows: 1000 }, AKAS, store)
		).rejects.toThrow('under the 1000 a complete dump carries');
	});

	it('writes nothing on a dry run', async () => {
		const { store, writes } = memoryStore();
		const result = await syncTable(spec('imdb_title_basics'), BASICS, store, { dryRun: true });

		expect(result.inserted).toBe(8);
		expect(writes).toEqual([]);
	});
});

describe('isTransientDbError', () => {
	it.each([
		connectionClosed(),
		new Error('Lock wait timeout exceeded; try restarting transaction'),
		new Error('Deadlock found when trying to get lock'),
		new Error('Raw query failed. Code: `2013`. Message: `Lost connection to MySQL server`'),
	])('retries %s', (error) => {
		expect(isTransientDbError(error)).toBe(true);
	});

	it('does not retry a refused row', () => {
		expect(isTransientDbError(new Error("Data too long for column 'title' at row 1"))).toBe(
			false
		);
	});
});

describe('mysqlStore', () => {
	it('upserts only the value columns and selects by group', async () => {
		const sql: Array<[string, unknown[]]> = [];
		const store = mysqlStore({
			query: async (s, p) => {
				sql.push([s, p]);
				return [{ title_id: 'tt1', ordering: 1, title: 'x' }];
			},
			execute: async (s, p) => {
				sql.push([s, p]);
			},
		});

		expect(
			await store.select('imdb_title_akas', ['title_id', 'ordering', 'title'], 'title_id', [
				'tt1',
				'tt2',
			])
		).toEqual([['tt1', 1, 'x']]);
		await store.upsert(
			'imdb_title_akas',
			['title_id', 'ordering', 'title'],
			['title'],
			[
				['tt1', 1, 'x'],
				['tt1', 2, 'y'],
			]
		);

		expect(sql[0]).toEqual([
			'SELECT `title_id`, `ordering`, `title` FROM `imdb_title_akas` WHERE `title_id` IN (?, ?)',
			['tt1', 'tt2'],
		]);
		expect(sql[1]).toEqual([
			'INSERT INTO `imdb_title_akas` (`title_id`, `ordering`, `title`) VALUES (?, ?, ?), (?, ?, ?) ON DUPLICATE KEY UPDATE `title` = VALUES(`title`)',
			['tt1', 1, 'x', 'tt1', 2, 'y'],
		]);
	});
});
