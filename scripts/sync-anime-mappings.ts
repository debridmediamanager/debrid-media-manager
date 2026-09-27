/**
 * Fill in missing external ids on the `Anime` table from the Fribb anime-lists
 * dataset.
 *
 * Only 4.7% of Anime rows carry an imdb id, which is the id every other DMM
 * surface is keyed by. This reads the published id table, works out which null
 * columns it can fill without breaking a unique constraint, and writes them.
 *
 *   npx tsx scripts/sync-anime-mappings.ts                                # dry run, writes nothing
 *   npx tsx scripts/sync-anime-mappings.ts --apply --backup <file.json>   # back up, then write
 *
 * `--apply` refuses to run without `--backup`. The file lists every row the plan
 * writes with the current value of each column it writes, taken from the same
 * read as the plan, and is written before the first update. Keep it outside the
 * repository: it is an operational record, not source.
 */
import { PrismaClient } from '@prisma/client';
import { closeSync, fsyncSync, openSync, writeSync } from 'fs';
import { fetchAnimeIdMappings } from '../src/services/anime/animeMapping';
import {
	backupRowsFor,
	planAnimeMappingUpdates,
	summarizePlan,
	type AnimeRow,
} from '../src/services/anime/animeMappingSync';

const prisma = new PrismaClient();
const BATCH_SIZE = 200;

function argValue(flag: string): string | null {
	const at = process.argv.indexOf(flag);
	return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--')
		? process.argv[at + 1]
		: null;
}

/** Fails if the file already exists, so a second run cannot overwrite the first backup. */
function writeBackup(path: string, rows: AnimeRow[]): void {
	const fd = openSync(path, 'wx', 0o600);
	try {
		writeSync(
			fd,
			JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, '\t') + '\n'
		);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

async function main() {
	const apply = process.argv.includes('--apply');
	const backupPath = argValue('--backup');
	if (apply && !backupPath) {
		throw new Error('--apply needs --backup <file.json> to record what it replaces');
	}

	console.log('Fetching the Fribb anime-lists dataset...');
	const mappings = await fetchAnimeIdMappings();
	console.log(`  ${mappings.length} matchable entries`);

	console.log('Reading the Anime table...');
	const rows = (await prisma.anime.findMany({
		select: {
			id: true,
			anidb_id: true,
			kitsu_id: true,
			mal_id: true,
			anime_planet_id: true,
			imdb_id: true,
		},
	})) as AnimeRow[];
	console.log(`  ${rows.length} rows`);

	const plan = planAnimeMappingUpdates(rows, mappings);
	console.log('\nPlan:');
	for (const [key, value] of Object.entries(summarizePlan(plan))) {
		console.log(`  ${key.padEnd(16)} ${value}`);
	}
	console.log('  collisions      ' + JSON.stringify(plan.collisions));

	if (!apply) {
		console.log('\nDry run. Re-run with --apply to write these updates.');
		return;
	}

	const backup = backupRowsFor(plan, rows);
	writeBackup(backupPath!, backup);
	console.log(`\nBacked up ${backup.length} rows to ${backupPath}`);

	console.log(`\nApplying ${plan.updates.length} updates...`);
	let written = 0;
	let failed = 0;
	for (let i = 0; i < plan.updates.length; i += BATCH_SIZE) {
		const batch = plan.updates.slice(i, i + BATCH_SIZE);
		// One row at a time inside the batch: a single unique-constraint clash
		// should cost that row, not the other 199 alongside it.
		const results = await Promise.allSettled(
			batch.map((update) =>
				prisma.anime.update({ where: { id: update.id }, data: update.fields })
			)
		);
		for (const result of results) {
			if (result.status === 'fulfilled') written++;
			else {
				failed++;
				if (failed <= 5) console.error(`  update failed: ${result.reason}`);
			}
		}
		console.log(`  ${Math.min(i + BATCH_SIZE, plan.updates.length)}/${plan.updates.length}`);
	}
	console.log(`\nWrote ${written} rows, ${failed} failed.`);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
