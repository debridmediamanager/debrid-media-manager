/**
 * One-off: strip the TorBox API keys out of `TorBoxCast.link`.
 *
 * TorBox mints a download URL as `.../dld/<uuid>?token=<API key>`, and cast rows
 * stored it verbatim - 114,689 of 114,689 rows on 2026-08-24 carried a second
 * plaintext copy of a user's key. `TorBoxCastService.saveCast` strips it now, so
 * this is only needed for rows written before that.
 *
 * Nothing reads the column back: playback re-mints from `torrentId`/`fileId` (or
 * from the hash), and the casted-links listing never selects it. The rest of the
 * URL is kept because the queries treat a non-null `link` as "castable".
 *
 *   npx tsx scripts/scrub-torbox-cast-tokens.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { stripTorBoxToken } from '../src/utils/torboxLinkSecret';

const BATCH = 500;

async function main() {
	const dryRun = process.argv.includes('--dry-run');
	const prisma = new PrismaClient();

	try {
		const total = await prisma.torBoxCast.count({ where: { link: { contains: 'token=' } } });
		console.log(`${total} row(s) still carry a token${dryRun ? ' (dry run)' : ''}`);

		let scrubbed = 0;
		// Re-query each round rather than paging: the rows drop out of the filter
		// as they are fixed, so an offset would skip over the ones behind it.
		for (;;) {
			const rows = await prisma.torBoxCast.findMany({
				where: { link: { contains: 'token=' } },
				select: { id: true, link: true },
				take: BATCH,
			});
			if (rows.length === 0) break;

			for (const row of rows) {
				const link = stripTorBoxToken(row.link ?? '');
				if (dryRun) {
					scrubbed += 1;
					continue;
				}
				await prisma.torBoxCast.update({ where: { id: row.id }, data: { link } });
				scrubbed += 1;
			}
			console.log(`  ${scrubbed}/${total}`);
			if (dryRun) break;
		}

		console.log(dryRun ? `would scrub ${scrubbed}` : `scrubbed ${scrubbed}`);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
