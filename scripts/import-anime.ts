/**
 * Keep the `Anime` table current: insert the AniDB entries it lacks, fill the
 * ids and the empty metadata of the rows it has. Runs daily from cron on the
 * `dmm` host, which holds the database, through `scripts/anime-import/run.sh`.
 *
 *   bun scripts/import-anime.ts --cache-dir DIR                                  # dry run
 *   bun scripts/import-anime.ts --cache-dir DIR --apply --backup-dir DIR         # write
 *
 * Options:
 *   --cache-dir DIR        where the AniDB dump is kept between runs (required)
 *   --apply                write; without it nothing is written
 *   --backup-dir DIR       where `--apply` records what it replaces (required with it)
 *   --max-inserts N        refuse a run planning more inserts than this (default 2000)
 *   --max-updates N        refuse a run planning more updates than this (default 25000)
 *   --kitsu-delay-ms N     pause between Kitsu requests (default 1000)
 *
 * Sources: AniDB's titles dump (downloaded at most once a day; AniDB bans
 * clients that fetch it more often, see `shouldDownloadAnidbDump`), the Fribb
 * id table, the Anime-Lists master list, and Kitsu for each new title's poster,
 * synopsis and rating. `src/services/anime/animeImport.ts` holds the rules.
 *
 * Every failure exits non-zero with a line starting `FAILED:`. Nothing is
 * written unless every source loaded, Kitsu answered and the plan is inside
 * its bounds.
 *
 * Undo a run from its backup file: for each `updates[]` entry set every column
 * in `before` back on row `id`, then
 *   DELETE FROM Anime WHERE id > <maxIdBefore> AND anidb_id IN (<insertedAnidbIds>);
 */
import { PrismaClient } from '@prisma/client';
import { closeSync, fsyncSync, openSync, writeSync } from 'fs';
import { mkdir, readFile, rename, stat, utimes, writeFile } from 'fs/promises';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import {
	ANIDB_TITLES_URL,
	parseAnidbTitles,
	shouldDownloadAnidbDump,
} from '../src/services/anime/anidbTitles';
import {
	backupFor,
	planAnimeImport,
	selectAnimeImportWork,
	type AnimeImportPlan,
	type AnimeImportRow,
} from '../src/services/anime/animeImport';
import { ANIME_LISTS_URL, parseAnimeLists } from '../src/services/anime/animeLists';
import { fetchAnimeIdMappings } from '../src/services/anime/animeMapping';
import { fetchKitsuAnimeBatch, KITSU_IMPORT_USER_AGENT } from '../src/services/anime/kitsu';

/** Floors well under what each source carried on 2026-09-27; a smaller answer is a broken download. */
const MIN_ANIDB_ENTRIES = 15000; // 17,007
const MIN_FRIBB_MAPPINGS = 30000; // 38,xxx matchable of 39,304
const MIN_ANIME_LISTS_ENTRIES = 15000; // 17,007
/** The cached dump may be this old before a run refuses it. */
const MAX_ANIDB_CACHE_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** More failed Kitsu batches than this share fails the run. */
const MAX_KITSU_FAILURE_SHARE = 0.1;
const WRITE_BATCH = 50;

class RunFailure extends Error {}

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

function argValue(flag: string): string | null {
	const at = process.argv.indexOf(flag);
	return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--')
		? process.argv[at + 1]
		: null;
}

function intArg(flag: string, fallback: number): number {
	const raw = argValue(flag);
	if (raw === null) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0) throw new RunFailure(`${flag} needs a number`);
	return value;
}

async function mtimeMs(path: string): Promise<number | null> {
	try {
		return (await stat(path)).mtimeMs;
	} catch {
		return null;
	}
}

/**
 * The dump, from the cache unless today's download is still owed.
 *
 * The attempt is stamped *before* the request, because AniDB counts requests:
 * a download that fails still spends the day, and the next run reads the cache.
 */
async function loadAnidbDump(cacheDir: string) {
	const dumpPath = join(cacheDir, 'anime-titles.dat.gz');
	const attemptPath = join(cacheDir, 'anidb-titles.attempted');
	const now = Date.now();

	if (shouldDownloadAnidbDump(await mtimeMs(attemptPath), now)) {
		await writeFile(attemptPath, `${new Date(now).toISOString()}\n`);
		await utimes(attemptPath, new Date(now), new Date(now));
		log(`AniDB: downloading ${ANIDB_TITLES_URL}`);
		try {
			const res = await fetch(ANIDB_TITLES_URL, {
				headers: { 'User-Agent': KITSU_IMPORT_USER_AGENT },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const gz = Buffer.from(await res.arrayBuffer());
			const parsed = parseAnidbTitles(gunzipSync(gz).toString('utf8'));
			if (parsed.size < MIN_ANIDB_ENTRIES) {
				throw new Error(`only ${parsed.size} entries`);
			}
			const tmp = `${dumpPath}.tmp`;
			await writeFile(tmp, gz);
			await rename(tmp, dumpPath);
			log(`AniDB: downloaded ${gz.length} bytes, ${parsed.size} entries`);
			return parsed;
		} catch (error) {
			// Loud, but not fatal on its own: yesterday's dump still names
			// everything but today's additions. The age check below decides.
			console.error(
				`${new Date().toISOString()} ERROR AniDB download failed, using the cache: ${
					error instanceof Error ? error.message : error
				}`
			);
		}
	}

	const cachedAt = await mtimeMs(dumpPath);
	if (cachedAt === null) throw new RunFailure(`no cached AniDB dump at ${dumpPath}`);
	const age = now - cachedAt;
	if (age > MAX_ANIDB_CACHE_AGE_MS) {
		throw new RunFailure(
			`the cached AniDB dump is ${(age / 3600000).toFixed(0)}h old; downloads are failing`
		);
	}
	const parsed = parseAnidbTitles(gunzipSync(await readFile(dumpPath)).toString('utf8'));
	if (parsed.size < MIN_ANIDB_ENTRIES) {
		throw new RunFailure(`the cached AniDB dump has only ${parsed.size} entries`);
	}
	log(
		`AniDB: cached dump from ${new Date(cachedAt).toISOString()} ` +
			`(${(age / 3600000).toFixed(1)}h old), ${parsed.size} entries`
	);
	return parsed;
}

async function loadAnimeLists() {
	const res = await fetch(ANIME_LISTS_URL);
	if (!res.ok) throw new RunFailure(`Anime-Lists fetch failed: HTTP ${res.status}`);
	const parsed = parseAnimeLists(await res.text());
	if (parsed.size < MIN_ANIME_LISTS_ENTRIES) {
		throw new RunFailure(`Anime-Lists returned only ${parsed.size} entries`);
	}
	log(`Anime-Lists: ${parsed.size} entries`);
	return parsed;
}

function printPlan(plan: AnimeImportPlan) {
	log('Plan:');
	for (const [key, value] of Object.entries(plan.counts)) {
		console.log(`  ${key.padEnd(20)} ${value}`);
	}
	console.log(`  collisions           ${JSON.stringify(plan.collisions)}`);
	const sample = [
		...plan.inserts.filter((i) => i.startDate?.startsWith(String(new Date().getUTCFullYear()))),
		...plan.inserts,
	].slice(0, 12);
	for (const insert of sample) {
		console.log(
			`  + anidb ${insert.anidb_id} kitsu ${insert.kitsu_id} ${insert.type} ` +
				`${insert.startDate ?? '?'} imdb ${insert.imdb_id ?? '-'} "${insert.title}"`
		);
	}
}

/** Fails if the file exists, so a re-run cannot overwrite an earlier backup. */
function writeBackup(path: string, content: unknown): void {
	const fd = openSync(path, 'wx', 0o600);
	try {
		writeSync(fd, JSON.stringify(content, null, '\t') + '\n');
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

async function inBatches<T>(
	items: T[],
	label: string,
	write: (item: T) => Promise<unknown>
): Promise<{ written: number; failed: number }> {
	let written = 0;
	let failed = 0;
	for (let i = 0; i < items.length; i += WRITE_BATCH) {
		// One row at a time inside the batch: a unique-constraint clash should
		// cost that row, not the other 49 beside it.
		const results = await Promise.allSettled(items.slice(i, i + WRITE_BATCH).map(write));
		for (const result of results) {
			if (result.status === 'fulfilled') written++;
			else {
				failed++;
				if (failed <= 5) console.error(`  ${label} failed: ${result.reason}`);
			}
		}
	}
	log(`${label}: ${written} written, ${failed} failed`);
	return { written, failed };
}

async function main(prisma: PrismaClient): Promise<void> {
	const cacheDir = argValue('--cache-dir');
	const apply = process.argv.includes('--apply');
	const backupDir = argValue('--backup-dir');
	const maxInserts = intArg('--max-inserts', 2000);
	const maxUpdates = intArg('--max-updates', 25000);
	const kitsuDelayMs = intArg('--kitsu-delay-ms', 1000);
	if (!cacheDir) throw new RunFailure('--cache-dir <dir> is required');
	if (apply && !backupDir) throw new RunFailure('--apply needs --backup-dir <dir>');
	await mkdir(cacheDir, { recursive: true });

	log(`anime import ${apply ? 'APPLY' : 'dry run'}`);
	const anidb = await loadAnidbDump(cacheDir);
	const animeLists = await loadAnimeLists();
	const mappings = await fetchAnimeIdMappings();
	if (mappings.length < MIN_FRIBB_MAPPINGS) {
		throw new RunFailure(`Fribb returned only ${mappings.length} matchable entries`);
	}
	log(`Fribb: ${mappings.length} matchable entries`);

	const rows = (await prisma.anime.findMany({
		select: {
			id: true,
			anidb_id: true,
			kitsu_id: true,
			mal_id: true,
			anime_planet_id: true,
			imdb_id: true,
			title: true,
			type: true,
			aliases: true,
			description: true,
			poster_url: true,
			background_url: true,
			rating: true,
		},
	})) as AnimeImportRow[];
	log(`Anime table: ${rows.length} rows`);

	const work = selectAnimeImportWork({ rows, anidb, animeLists, mappings });
	log(
		`Kitsu: ${work.kitsuIds.length} ids for ${work.candidates.length} candidates and ` +
			`${work.enrichTargets.length} rows missing a title or poster`
	);
	const kitsu = await fetchKitsuAnimeBatch(work.kitsuIds, { delayMs: kitsuDelayMs });
	log(
		`Kitsu: ${kitsu.metas.size} returned over ${kitsu.requests} requests, ` +
			`${kitsu.failedBatches}/${kitsu.batches} batches failed`
	);
	if (kitsu.batches > 0 && kitsu.failedBatches / kitsu.batches > MAX_KITSU_FAILURE_SHARE) {
		throw new RunFailure(`${kitsu.failedBatches} of ${kitsu.batches} Kitsu batches failed`);
	}

	const plan = planAnimeImport(work, { rows, anidb, mappings, kitsu: kitsu.metas });
	printPlan(plan);

	if (plan.inserts.length > maxInserts) {
		throw new RunFailure(`${plan.inserts.length} inserts exceeds --max-inserts ${maxInserts}`);
	}
	if (plan.updates.length > maxUpdates) {
		throw new RunFailure(`${plan.updates.length} updates exceeds --max-updates ${maxUpdates}`);
	}
	if (!apply) {
		log('Dry run: nothing written. Re-run with --apply --backup-dir <dir> to write.');
		return;
	}

	await mkdir(backupDir!, { recursive: true, mode: 0o700 });
	const takenAt = new Date();
	const backupPath = join(
		backupDir!,
		`anime-import-${takenAt.toISOString().replace(/[:.]/g, '-')}.json`
	);
	writeBackup(backupPath, backupFor(plan, rows, takenAt));
	log(`Backup: ${backupPath} (${plan.updates.length} rows, ${plan.inserts.length} inserts)`);

	const updated = await inBatches(plan.updates, 'updates', (update) =>
		prisma.anime.update({ where: { id: update.id }, data: update.fields })
	);
	const inserted = await inBatches(plan.inserts, 'inserts', ({ startDate: _, ...insert }) =>
		prisma.anime.create({ data: insert })
	);

	const after = await prisma.anime.count();
	log(`Rows: ${rows.length} before, ${after} after, ${inserted.written} inserted`);
	if (updated.failed > 0 || inserted.failed > 0) {
		throw new RunFailure(`${updated.failed} updates and ${inserted.failed} inserts failed`);
	}
	if (after !== rows.length + inserted.written) {
		// Not fatal to the data, but something else wrote the table meanwhile.
		console.error(
			`${new Date().toISOString()} ERROR row count moved by ${after - rows.length}, ` +
				`expected ${inserted.written}`
		);
		process.exitCode = 1;
	}
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
