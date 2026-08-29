/**
 * One-off: file the completed Usenet releases that were never filed.
 *
 * A finished nzb2rd job leaves two things behind: an `nzbrd:<releaseId>` marker,
 * which is what the Usenet row on a title page reads, and a `ScrapedTrue` +
 * `Available` pair, which is what the search results read. Until 2026-08-29 the
 * second pair was written only when the caller happened to know whether the
 * release was a film or one season of a show — and the two paths that promote a
 * marker with no browser attached (`/api/nzb2rd/registered`, and the marker
 * sweep of 2026-08-28) knew nothing. So they wrote the marker alone.
 *
 * The result is a row that says a disabled **"In RD"**, promising the content is
 * "available as a cached result for this title", pointing at a result that was
 * never written. Measured on 2026-08-29: 991 of 1128 completed markers, 88%.
 *
 * `registerCompletedNzb2rdJob` resolves the context itself now, so this script
 * is deliberately thin — it finds the stale markers and calls exactly the
 * function the live paths call. Nothing here reimplements the filing, so the
 * backfill cannot drift from what production does with the next release.
 *
 * Idempotent: the registration short-circuits on a hash that is already
 * available, so re-running only costs one lookup per marker.
 *
 *   npx tsx scripts/backfill-nzb2rd-registrations.ts [--dry-run] [--limit N]
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
// Next loads `.env.local` over `.env` on its own; a plain tsx run does not, and
// `.env` carries placeholder database credentials, so without this the script
// fails authenticating as the literal user `username`.
config({ path: '.env.local', override: true });

import { getNzb2rdUrl } from '../src/services/nzb2rd';
import { repository as db } from '../src/services/repository';
import { registerCompletedNzb2rdJob } from '../src/services/transferRegistration';

const prisma = new PrismaClient();

/** nzb2rd holds thousands of jobs; fetch them one at a time and stay polite. */
const CONCURRENCY = 4;
const JOB_TIMEOUT_MS = 15000;

type Marker = { releaseId: string; jobId: string; infoHash: string; imdbId: string };

/**
 * Completed markers whose info hash has no `Available` row — the exact
 * population that shows "In RD" and appears in no search result.
 *
 * Done as raw SQL rather than a findMany plus a filter because the marker set is
 * a JSON column in the generic `Cache` table: pulling every `nzbrd:` row into
 * the process to inspect one field is the mistake `MdblistCache` already taught
 * (45 MB and 20s to read a handful of fields).
 */
async function staleMarkers(limit: number): Promise<Marker[]> {
	return prisma.$queryRaw<Marker[]>`
		SELECT
			JSON_UNQUOTE(JSON_EXTRACT(c.value, '$.releaseId')) AS releaseId,
			JSON_UNQUOTE(JSON_EXTRACT(c.value, '$.jobId'))     AS jobId,
			LOWER(JSON_UNQUOTE(JSON_EXTRACT(c.value, '$.infoHash'))) AS infoHash,
			JSON_UNQUOTE(JSON_EXTRACT(c.value, '$.imdbId'))    AS imdbId
		FROM Cache c
		LEFT JOIN Available a
			ON a.hash = LOWER(JSON_UNQUOTE(JSON_EXTRACT(c.value, '$.infoHash')))
		WHERE c.\`key\` LIKE 'nzbrd:%'
			AND JSON_UNQUOTE(JSON_EXTRACT(c.value, '$.status')) = 'completed'
			AND JSON_EXTRACT(c.value, '$.infoHash') IS NOT NULL
			AND a.hash IS NULL
		ORDER BY JSON_EXTRACT(c.value, '$.updatedAt') DESC
		LIMIT ${limit}`;
}

async function fetchJob(jobId: string): Promise<any | null> {
	try {
		const response = await fetch(`${getNzb2rdUrl()}/jobs/${encodeURIComponent(jobId)}`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	}
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');
	const limitArg = process.argv.indexOf('--limit');
	const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 5000;

	const markers = await staleMarkers(limit);
	console.log(
		`${markers.length} completed marker(s) with no searchable row${dryRun ? ' (dry run)' : ''}`
	);

	const tally = { filed: 0, noJob: 0, notCompleted: 0, skipped: 0 };
	let done = 0;

	const worker = async () => {
		for (;;) {
			const marker = markers[done++];
			if (!marker) return;

			const job = await fetchJob(marker.jobId);
			if (!job) {
				tally.noJob++;
				continue;
			}
			// A job nzb2rd has since failed or restarted cannot be filed off a
			// marker that says otherwise; leave it for the live reconcile to clear.
			if (job.status !== 'completed') {
				tally.notCompleted++;
				continue;
			}

			if (dryRun) {
				console.log(`would file ${marker.infoHash} (${marker.imdbId}) — ${job.name}`);
				tally.filed++;
				continue;
			}

			// Deliberately passes no context: resolving it is the function's job,
			// and routing the backfill through the same resolution is what stops
			// this script and production from disagreeing.
			const filed = await registerCompletedNzb2rdJob(
				job,
				undefined,
				undefined,
				marker.releaseId
			).catch((e) => {
				console.error(`  ${marker.releaseId}: ${e}`);
				return false;
			});
			if (filed) tally.filed++;
			else tally.skipped++;
		}
	};

	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	console.log(
		`filed ${tally.filed}, skipped ${tally.skipped} (no page to file under, or already available), ` +
			`${tally.noJob} job(s) nzb2rd no longer has, ${tally.notCompleted} not completed`
	);
}

main()
	.catch((e) => {
		console.error(e);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
		await db.disconnect();
	});
