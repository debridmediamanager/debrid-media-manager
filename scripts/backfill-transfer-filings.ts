/**
 * One-off: file the completed transfers that never reached search.
 *
 * Until the cron's completion sweep (`fileCompletedTransfers`), a finished
 * Usenet → RD job was filed into `ScrapedTrue` + `Available` only when a browser
 * happened to list it: a Transfers page row, a title page's Usenet section, or
 * a per-job poll. A job nobody looked at afterwards stayed in Real-Debrid and in
 * no DMM search result. A TB → RD job was filed by the cron only while a
 * pending `tbrd:` mapping pointed at it. Measured 2026-10-03: 2862 of 7656
 * completed nzb2rd jobs with an IMDb id, and 95 of 932 on debrid02.
 *
 * The sweep only looks back `LOOKBACK_MS`, deliberately, so deploying it does
 * not run this. This is the rest, and it is thin on purpose: it lists the jobs
 * with the sweep's own `listCompletedJobs`, skips what `Available` already has,
 * and hands each job to the same `fileCompleted…Job` the sweep and the browser
 * paths call. `--dry-run` calls only the `plan…Filing` half of those, so the
 * preview counts come from the rules a real run applies, not a copy of them.
 *
 * Two things a real run does besides filing, both counted by the dry run:
 * a DMM-submitted Usenet job's `nzbrd:` marker moves to `completed` (the title
 * page's Usenet row then reads "In RD" instead of "Queued"), and anyone parked
 * behind that job in `nzbwait:` gets the release added to their RD account.
 *
 * A release that was filed and has since left `Available` is skipped: the only
 * thing that removes a row there is a user's false-positive report
 * (`/api/availability/remove`), and refiling would undo it. Its `ScrapedTrue`
 * entry outlives the eviction, which is how it is recognised.
 *
 * `--dry-run` refuses every database write in-process, so the preview cannot
 * write even through a code path this comment has missed, and it ends with a
 * count of the writes it refused, which has to be zero.
 *
 *   npx tsx scripts/backfill-transfer-filings.ts --dry-run
 *   npx tsx scripts/backfill-transfer-filings.ts [--source nzb2rd|debrid]
 *       [--limit N] [--before 2026-10-01T00:00:00Z] [--concurrency 4] [--verbose]
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import type { CompletedJob } from '../src/services/transferFilingSweep';
// Next loads `.env.local` over `.env` on its own; a plain tsx run does not, and
// `.env` carries placeholder database credentials.
config({ path: '.env.local', override: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const dryRun = flag('--dry-run');
const verbose = flag('--verbose');
const sourceArg = option('--source');
const limit = option('--limit') ? parseInt(option('--limit')!, 10) : Infinity;
const before = option('--before') ? Date.parse(option('--before')!) : undefined;
const concurrency = option('--concurrency') ? parseInt(option('--concurrency')!, 10) : 4;
const LIST_TIMEOUT_MS = 5 * 60 * 1000;

if (sourceArg && sourceArg !== 'nzb2rd' && sourceArg !== 'debrid') {
	throw new Error('--source must be nzb2rd or debrid');
}
if (before !== undefined && !Number.isFinite(before)) throw new Error('--before is not a date');

/** Prisma operations that only read. Anything else is refused in a dry run. */
const READ_OPERATIONS = new Set([
	'findUnique',
	'findUniqueOrThrow',
	'findFirst',
	'findFirstOrThrow',
	'findMany',
	'count',
	'aggregate',
	'groupBy',
]);

/**
 * A client that refuses to write, for the dry run.
 *
 * Refused in-process rather than left to a read-only MySQL session: Prisma
 * replaces a pooled connection after 300 seconds and the replacement does not
 * carry the session setting (measured 2026-10-03, connection id 61596 -> 61748
 * at 300s, `transaction_read_only` back to 0), and a backfill preview runs for
 * longer than that. Installed as the global client before the repository is
 * imported, so every service the repository builds goes through it.
 */
function readOnlyClient(refused: string[]): PrismaClient {
	const client = new PrismaClient().$extends({
		query: {
			$allOperations({ model, operation, args, query }) {
				const raw =
					operation === '$queryRaw'
						? (args as { strings?: string[] }).strings?.join('?')
						: operation === '$queryRawUnsafe'
							? (args as unknown[])[0]
							: undefined;
				const reads = model
					? READ_OPERATIONS.has(operation)
					: typeof raw === 'string' && /^\s*select\b/i.test(raw);
				if (!reads) {
					refused.push(`${model ?? 'raw'}.${operation}`);
					throw new Error(`dry run refused a write: ${model ?? 'raw'}.${operation}`);
				}
				return query(args);
			},
		},
	}) as unknown as PrismaClient;
	(globalThis as unknown as { prisma: PrismaClient }).prisma = client;
	return client;
}

type Outcome = 'file' | 'filed' | 'already' | 'evicted' | 'gone' | 'error' | `refused:${string}`;

let client: PrismaClient | undefined;
const refusedWrites: string[] = [];

async function main() {
	client = dryRun ? readOnlyClient(refusedWrites) : new PrismaClient();
	const sql = client;

	// Imported only now, so the repository picks up the read-only client above.
	const { repository: db } = await import('../src/services/repository');
	const sweep = await import('../src/services/transferFilingSweep');
	const registration = await import('../src/services/transferRegistration');

	/** Filed once and since evicted from `Available` by a false-positive report. */
	const wasEvicted = async (scrapedKey: string, hash: string) => {
		const rows = await sql.$queryRaw<{ hit: bigint }[]>`
			SELECT COUNT(*) AS hit FROM ScrapedTrue
			WHERE \`key\` = ${scrapedKey} AND LOCATE(${hash}, CAST(value AS CHAR)) > 0`;
		return Number(rows[0]?.hit ?? 0) > 0;
	};

	const services = sweep
		.transferServices()
		.filter(({ source }) => !sourceArg || source === sourceArg);
	const completed: CompletedJob[] = [];
	for (const { source, server } of services) {
		// Read here rather than with the sweep's `listCompletedJobs`, whose 30s
		// bound is sized for dmm-01, where nzb2rd's 15 MB listing takes 0.5s.
		// Over a relayed Tailscale path the same read took 15s to over 30s on
		// 2026-10-03, and this runs once, so it can afford to wait.
		const response = await fetch(`${server}/jobs`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`${source} at ${server} answered ${response.status}`);
		const jobs = sweep.completedJobsIn(await response.json(), source, server);
		completed.push(...jobs.filter((j) => before === undefined || j.completedAt < before));
	}

	const unfiled = await sweep.withoutFiled(completed);
	// A `filed` record means the sweep filed it and it was evicted since.
	const records = await db.getTransferFilings(
		unfiled.map((c) => ({ source: c.source, jobId: c.job.id }))
	);
	const todo = unfiled
		.filter((c) => records.get(sweep.keyOfJob(c))?.outcome !== 'filed')
		.sort((a, b) => b.completedAt - a.completedAt)
		.slice(0, limit);
	const meta = await db.getTransferMeta(
		todo
			.filter((c) => c.source === 'nzb2rd')
			.map((c) => ({ source: 'nzb2rd' as const, jobId: c.job.id }))
	);

	console.log(
		`${completed.length} completed job(s) with a hash and an IMDb id, ` +
			`${unfiled.length} not in Available, ${todo.length} to examine` +
			(dryRun ? ' (dry run, read-only)' : '')
	);

	const tally = new Map<string, number>();
	const count = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);
	let markersToFlip = 0;
	let waitersToServe = 0;

	const examine = async (c: CompletedJob): Promise<Outcome> => {
		const releaseId =
			c.source === 'nzb2rd' ? meta.get(sweep.keyOfJob(c))?.releaseId : undefined;
		const job =
			c.source === 'nzb2rd' ? await sweep.nzb2rdJobWithFiles(c.server, c.job.id) : c.job;
		if (!job) return 'gone';

		const plan =
			c.source === 'nzb2rd'
				? await registration.planNzb2rdFiling(job, undefined, undefined)
				: await registration.planDebridFiling(job, undefined, undefined, c.server);
		if (plan.outcome === 'refused') return `refused:${plan.reason}`;
		if (plan.outcome === 'already') return 'already';
		if (await wasEvicted(plan.registration.scrapedKey, c.hash)) return 'evicted';

		if (releaseId) {
			const marker = (await db.getNzb2rdTransfers([releaseId]))[0];
			if (marker && marker.status !== 'completed') markersToFlip++;
			waitersToServe += (await db.getNzb2rdWaiters(releaseId)).length;
		}
		if (dryRun) return 'file';

		const filing =
			c.source === 'nzb2rd'
				? await registration.fileCompletedNzb2rdJob(job, undefined, undefined, releaseId)
				: await registration.fileCompletedDebridJob(job, undefined, undefined, c.server);
		await db.recordTransferFiling(
			filing.outcome === 'refused'
				? { source: c.source, jobId: c.job.id, outcome: 'refused', reason: filing.reason }
				: { source: c.source, jobId: c.job.id, outcome: 'filed' }
		);
		return filing.outcome === 'refused' ? `refused:${filing.reason}` : filing.outcome;
	};

	// Filing appends to a title's `ScrapedTrue` blob by reading it, merging and
	// writing it back, so two workers filing episodes of one season at once would
	// each write a blob missing the other's entry. The release would then sit in
	// `Available`, where every later run counts it as filed, and in no listing.
	// Jobs for one title therefore run one at a time; different titles overlap.
	const titleQueues = new Map<string, Promise<unknown>>();
	const oneTitleAtATime = <T>(imdbId: string, task: () => Promise<T>): Promise<T> => {
		const run = (titleQueues.get(imdbId) ?? Promise.resolve()).then(task, task);
		titleQueues.set(
			imdbId,
			run.catch(() => undefined)
		);
		return run;
	};

	let next = 0;
	const worker = async () => {
		for (;;) {
			const c = todo[next++];
			if (!c) return;
			const outcome = await oneTitleAtATime(c.job.imdb_id, () => examine(c)).catch(
				(error) => {
					console.error(`  ${sweep.keyOfJob(c)}: ${error}`);
					return 'error' as const;
				}
			);
			count(`${c.source} ${outcome}`);
			if (verbose) {
				const month = new Date(c.completedAt).toISOString().slice(0, 7);
				console.log(`${outcome}\t${c.source}\t${month}\t${c.job.imdb_id}\t${c.job.name}`);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

	for (const [key, n] of [...tally.entries()].sort()) console.log(`${key}: ${n}`);
	console.log(
		`${dryRun ? 'would move' : 'moved'} ${markersToFlip} nzbrd marker(s) to completed, ` +
			`${dryRun ? 'would deliver' : 'delivered'} to ${waitersToServe} waiting account(s)`
	);
	if (dryRun) {
		console.log(`refused ${refusedWrites.length} write(s)`, refusedWrites.slice(0, 10));
		if (refusedWrites.length > 0) process.exitCode = 1;
	}
}

main()
	.catch((e) => {
		console.error(e);
		process.exitCode = 1;
	})
	.finally(async () => {
		const { repository } = await import('../src/services/repository');
		await repository.disconnect();
		await client?.$disconnect();
	});
