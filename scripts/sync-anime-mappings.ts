/**
 * Fill in missing external ids on the `Anime` table from the Fribb anime-lists
 * dataset.
 *
 * Only 4.7% of Anime rows carry an imdb id, which is the id every other DMM
 * surface is keyed by. This reads the published id table, works out which null
 * columns it can fill without breaking a unique constraint, and writes them.
 *
 *   npx tsx scripts/sync-anime-mappings.ts            # dry run, writes nothing
 *   npx tsx scripts/sync-anime-mappings.ts --apply    # write the plan
 */
import { PrismaClient } from '@prisma/client';
import { fetchAnimeIdMappings } from '../src/services/anime/animeMapping';
import {
	planAnimeMappingUpdates,
	summarizePlan,
	type AnimeRow,
} from '../src/services/anime/animeMappingSync';

const prisma = new PrismaClient();
const BATCH_SIZE = 200;

async function main() {
	const apply = process.argv.includes('--apply');

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
