/**
 * Keep DMM's `imdb_*` tables current with IMDb's non-commercial dumps. Runs
 * daily from cron on the `dmm` host, which holds the database, through
 * `scripts/imdb-import/run.sh`. Replaces the untracked `~/imdb_import.py`.
 *
 *   bun scripts/import-imdb.ts --data-dir DIR                # dry run: count, write nothing
 *   bun scripts/import-imdb.ts --data-dir DIR --apply        # write
 *
 * Options:
 *   --data-dir DIR     where the dumps are downloaded (required)
 *   --apply            write; without it nothing is written
 *   --tables a,b       only these tables, e.g. imdb_title_ratings,imdb_title_basics
 *   --reuse-hours N    reuse a dump downloaded less than N hours ago (default 20)
 *   --partial-dump     accept a dump shorter than a complete one (tests on a slice)
 *
 * Only new and changed rows are written and nothing is deleted;
 * `src/services/imdbImport/imdbSync.ts` holds the rules and says why. Every
 * table is attempted even when an earlier one fails; any failure exits non-zero
 * with a line starting `FAILED:`.
 */
import { PrismaClient } from '@prisma/client';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, rename, stat } from 'fs/promises';
import { join } from 'path';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { createGunzip } from 'zlib';
import { IMDB_TABLES, mysqlStore, syncTable } from '../src/services/imdbImport/imdbSync';

const IMDB_DATASETS_URL = 'https://datasets.imdbws.com';

class RunFailure extends Error {}

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

function argValue(flag: string): string | null {
	const at = process.argv.indexOf(flag);
	return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--')
		? process.argv[at + 1]
		: null;
}

/** Download `file` unless a copy younger than `reuseMs` is already there. */
async function download(dataDir: string, file: string, reuseMs: number): Promise<string> {
	const path = join(dataDir, file);
	const existing = await stat(path).catch(() => null);
	if (existing && Date.now() - existing.mtimeMs < reuseMs) {
		log(`${file}: reusing the copy from ${existing.mtime.toISOString()}`);
		return path;
	}
	const response = await fetch(`${IMDB_DATASETS_URL}/${file}`);
	if (!response.ok || !response.body) {
		throw new RunFailure(`${file}: download answered ${response.status}`);
	}
	await pipeline(
		Readable.fromWeb(response.body as WebReadableStream),
		createWriteStream(`${path}.part`)
	);
	await rename(`${path}.part`, path);
	log(`${file}: downloaded ${((await stat(path)).size / 1e6).toFixed(0)} MB`);
	return path;
}

function lines(path: string): AsyncIterable<string> {
	return createInterface({
		input: createReadStream(path).pipe(createGunzip()),
		crlfDelay: Infinity,
	});
}

async function main(prisma: PrismaClient) {
	const dataDir = argValue('--data-dir');
	if (!dataDir) throw new RunFailure('--data-dir is required');
	const apply = process.argv.includes('--apply');
	const only = argValue('--tables')?.split(',');
	const reuseMs = Number(argValue('--reuse-hours') ?? 20) * 60 * 60 * 1000;
	const partial = process.argv.includes('--partial-dump');
	const tables = (only ? IMDB_TABLES.filter((t) => only.includes(t.table)) : IMDB_TABLES).map(
		(t) => (partial ? { ...t, minRows: 0 } : t)
	);
	if (only && tables.length !== only.length) throw new RunFailure(`unknown table in ${only}`);

	await mkdir(dataDir, { recursive: true });
	const store = mysqlStore({
		query: (sql, params) => prisma.$queryRawUnsafe(sql, ...params),
		execute: (sql, params) => prisma.$executeRawUnsafe(sql, ...params),
	});

	log(`IMDb import, ${apply ? 'applying' : 'dry run'}: ${tables.map((t) => t.table).join(', ')}`);
	const failed: string[] = [];
	for (const spec of tables) {
		const started = Date.now();
		try {
			const path = await download(dataDir, spec.file, reuseMs);
			const result = await syncTable(spec, lines(path), store, { log, dryRun: !apply });
			log(
				`${spec.table}: ${result.read} read, ${result.inserted} new, ${result.updated} changed, ` +
					`${result.linksAdded} links added, ${result.rejected} refused ` +
					`in ${Math.round((Date.now() - started) / 1000)}s`
			);
		} catch (error) {
			failed.push(spec.table);
			console.error(
				`${new Date().toISOString()} ${spec.table} failed: ${error instanceof Error ? error.message : error}`
			);
		}
	}
	if (failed.length > 0) throw new RunFailure(`${failed.join(', ')} did not import`);
}

const prisma = new PrismaClient();
main(prisma)
	.catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${new Date().toISOString()} FAILED: ${message}`);
		if (!(error instanceof RunFailure) && error instanceof Error && error.stack) {
			console.error(error.stack);
		}
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
