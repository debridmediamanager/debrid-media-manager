import type { TransferMetaSource } from '@/services/database';
import { getDebridUploaderServers } from '@/services/debridUploaderServers';
import { getNzb2rdUrl, isValidImdbId } from '@/services/nzb2rd';
import { repository as db } from '@/services/repository';
import { parseServiceTime } from '@/services/transferList';
import {
	fileCompletedDebridJob,
	fileCompletedNzb2rdJob,
	type FilingResult,
} from '@/services/transferRegistration';

/**
 * Filing every finished transfer into search, whether or not anyone is looking.
 *
 * A completed Usenet → RD or TB → RD job is only useful to anyone but its
 * submitter once DMM files its torrent into `ScrapedTrue` + `Available`: the
 * torrent exists nowhere but Real-Debrid, under a hash no other search result
 * carries. Until this sweep, that filing ran only from a browser — a Transfers
 * page row (`/api/transfers`), a title page's Usenet section
 * (`/api/nzb2rd/registered`), or a per-job poll. The cron only reconciled TB →
 * RD jobs that still had a pending `tbrd:` mapping (`reconcileDebridTransfers`),
 * so a Usenet job was filed only if someone opened a page listing it, and a TB
 * → RD job with no mapping left pointing at it never was.
 *
 * Measured on production 2026-10-03 against nzb2rd's and debrid02's own job
 * lists: of 7656 completed nzb2rd jobs with an IMDb id, 2862 had never reached
 * `Available`, 423 of them from the previous seven days. 1138 of the 2862 were
 * DMM submissions whose `nzbrd:` marker still read `pending`; 1618 had no
 * stored page context, 1580 of those from before DMM began recording one on
 * 2026-08-20. debrid02 had 95 of 932.
 *
 * So the cron lists each service's jobs and files the completed ones that are
 * missing, by the same `fileCompleted…Job` the browser paths call. It is bounded
 * three ways: a window (`LOOKBACK_MS`) so it handles what completes from now on
 * and leaves the old backlog to `scripts/backfill-transfer-filings.ts`, a batch
 * per tick, and one `xfersweep:` record per job so a job is not asked about
 * again once it has an answer (see `TransferFilingService`).
 */

/**
 * How far back a completion is still the sweep's to file.
 *
 * Long enough to cover a DMM or uploader outage over a weekend, short enough
 * that deploying this does not quietly run the whole backfill: on 2026-10-03
 * the last 72 hours held 156 unfiled completions, the full history 2957.
 */
export const LOOKBACK_MS = 72 * 60 * 60 * 1000;

/**
 * When a refusal is worth asking about again.
 *
 * Most refusals are permanent (a lone sample file, a DVD image, a dated show
 * with no season), but one kind heals: a title newer than the last IMDb import
 * has no title type, so it has no page to file under until the next daily
 * import adds it. Twelve hours gives that several chances inside the window
 * without re-asking about the permanent ones every five minutes.
 */
export const REFUSED_RETRY_MS = 12 * 60 * 60 * 1000;

/**
 * Jobs filed per tick.
 *
 * The cron fires every 5 minutes and files sequentially, and a job can take a
 * detail lookup plus a 15s file-list fetch, so ten keeps a stalled uploader
 * from stretching a tick past the next one. Ten a tick is 2880 a day, against
 * ~150 completions a day across both services.
 */
export const FILE_BATCH = 10;

/**
 * Bounds the listing read. nzb2rd's `GET /jobs` is every job it holds, with no
 * paging: 15 MB for 14.6k jobs on 2026-10-03, read from dmm-01 in 0.5s.
 */
const LIST_TIMEOUT_MS = 30000;
const JOB_TIMEOUT_MS = 8000;

/** How long past the window a record is kept before the sweep prunes it. */
const PRUNE_GRACE_MS = 24 * 60 * 60 * 1000;

const INFO_HASH = /^[a-f0-9]{40}$/i;

/** A completed job as listed by the service that ran it. */
export interface CompletedJob {
	source: TransferMetaSource;
	/** The service URL that listed it: the only one that can serve its files. */
	server: string;
	job: any;
	hash: string;
	completedAt: number;
}

export const keyOfJob = (c: Pick<CompletedJob, 'source'> & { job: { id: string } }) =>
	`${c.source}:${c.job.id}`;

/** Every service a transfer can run on, one entry per listing to read. */
export function transferServices(): { source: TransferMetaSource; server: string }[] {
	return [
		{ source: 'nzb2rd', server: getNzb2rdUrl() },
		...getDebridUploaderServers().map((server) => ({ source: 'debrid' as const, server })),
	];
}

/**
 * The completed jobs in one service's listing that could be filed at all.
 *
 * A job with no IMDb id has no title to be filed under, so it is left out
 * rather than refused: nothing about it can change. 1766 of nzb2rd's 9422
 * completed jobs were like that on 2026-10-03. A TB →
 * RD job sent to another destination never reached Real-Debrid, so it does not
 * belong in RD's availability either.
 */
export function completedJobsIn(
	listing: unknown,
	source: TransferMetaSource,
	server: string,
	since?: number
): CompletedJob[] {
	if (!Array.isArray(listing)) return [];
	const completed: CompletedJob[] = [];
	for (const job of listing) {
		if (job?.status !== 'completed' || typeof job.id !== 'string') continue;
		if (typeof job.info_hash !== 'string' || !INFO_HASH.test(job.info_hash)) continue;
		if (!isValidImdbId(job.imdb_id)) continue;
		if (source === 'debrid' && job.destination && job.destination !== 'rd') continue;
		const completedAt = parseServiceTime(job.completed_at);
		if (!completedAt) continue;
		if (since !== undefined && completedAt < since) continue;
		completed.push({ source, server, job, hash: job.info_hash.toLowerCase(), completedAt });
	}
	return completed;
}

/** One service's completed jobs, or null when its listing could not be read. */
export async function listCompletedJobs(
	source: TransferMetaSource,
	server: string,
	since?: number
): Promise<CompletedJob[] | null> {
	try {
		const response = await fetch(`${server}/jobs`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
		});
		if (!response.ok) {
			console.error(`[filing] ${source} listing answered ${response.status}`);
			return null;
		}
		return completedJobsIn(await response.json(), source, server, since);
	} catch (error) {
		console.error(`[filing] ${source} listing failed:`, error);
		return null;
	}
}

/** The jobs whose torrent is not in `Available` yet. */
export async function withoutFiled(jobs: CompletedJob[]): Promise<CompletedJob[]> {
	const filed = new Set<string>();
	const hashes = [...new Set(jobs.map((j) => j.hash))];
	for (let i = 0; i < hashes.length; i += 500) {
		const names = await db.getCachedRdNames(hashes.slice(i, i + 500));
		for (const hash of names.keys()) filed.add(hash.toLowerCase());
	}
	return jobs.filter((j) => !filed.has(j.hash));
}

/**
 * nzb2rd's job with its file list, which the listing leaves out, or null when
 * the job is gone or no longer completed. Throws when nzb2rd gives no answer,
 * so the caller retries next tick instead of concluding anything.
 */
export async function nzb2rdJobWithFiles(server: string, jobId: string): Promise<any | null> {
	const response = await fetch(`${server}/jobs/${encodeURIComponent(jobId)}`, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`nzb2rd answered ${response.status} for job ${jobId}`);
	const job = await response.json();
	return job?.status === 'completed' ? job : null;
}

export interface FilingSweepResult {
	/** Completed, fileable jobs inside the window, across every service that answered. */
	completed: number;
	/** Of those, missing from search and not already answered. */
	due: number;
	filed: number;
	/** Filed by something else between the listing and the attempt. */
	already: number;
	refused: number;
	/** Due but past this tick's batch; the next tick takes them. */
	deferred: number;
	/** Could not be tried this tick; no record is written, so the next tick retries. */
	errors: number;
	/** Services whose listing could not be read this tick. */
	unreachable: number;
	/** Records past the window that were dropped. */
	pruned: number;
}

/**
 * File the completed transfers of the last `LOOKBACK_MS` that search is missing.
 *
 * Newest first, so a transfer that just finished is filed on the next tick
 * even while a backlog drains behind it.
 */
export async function fileCompletedTransfers(
	options: { now?: number; batch?: number } = {}
): Promise<FilingSweepResult> {
	const now = options.now ?? Date.now();
	const batch = options.batch ?? FILE_BATCH;
	const result: FilingSweepResult = {
		completed: 0,
		due: 0,
		filed: 0,
		already: 0,
		refused: 0,
		deferred: 0,
		errors: 0,
		unreachable: 0,
		pruned: 0,
	};

	const listings = await Promise.all(
		transferServices().map(({ source, server }) =>
			listCompletedJobs(source, server, now - LOOKBACK_MS)
		)
	);
	const completed: CompletedJob[] = [];
	for (const listing of listings) {
		if (listing) completed.push(...listing);
		else result.unreachable++;
	}
	result.completed = completed.length;

	const unfiled = await withoutFiled(completed);
	const records = await db.getTransferFilings(
		unfiled.map((c) => ({ source: c.source, jobId: c.job.id }))
	);
	const due = unfiled
		.filter((c) => {
			const record = records.get(keyOfJob(c));
			if (!record) return true;
			// Final: a filed release that is missing now was evicted on purpose.
			if (record.outcome === 'filed') return false;
			return now - record.at >= REFUSED_RETRY_MS;
		})
		.sort((a, b) => b.completedAt - a.completedAt);
	result.due = due.length;
	const take = due.slice(0, batch);
	result.deferred = due.length - take.length;

	// The release id is what lets the filing also flip the `nzbrd:` marker on
	// the title page and hand the release to anyone who queued behind it. Only
	// a DMM submission has one.
	const meta =
		take.some((c) => c.source === 'nzb2rd') &&
		(await db
			.getTransferMeta(
				take
					.filter((c) => c.source === 'nzb2rd')
					.map((c) => ({ source: 'nzb2rd' as const, jobId: c.job.id }))
			)
			.catch((error) => {
				console.error('[filing] reading transfer context failed:', error);
				return null;
			}));

	for (const c of take) {
		try {
			let filing: FilingResult;
			if (c.source === 'nzb2rd') {
				const job = await nzb2rdJobWithFiles(c.server, c.job.id);
				if (!job) continue;
				const releaseId = meta ? meta.get(keyOfJob(c))?.releaseId : undefined;
				filing = await fileCompletedNzb2rdJob(job, undefined, undefined, releaseId);
			} else {
				filing = await fileCompletedDebridJob(c.job, undefined, undefined, c.server);
			}

			if (filing.outcome === 'refused') result.refused++;
			else result[filing.outcome]++;
			await db.recordTransferFiling(
				filing.outcome === 'refused'
					? {
							source: c.source,
							jobId: c.job.id,
							outcome: 'refused',
							reason: filing.reason,
						}
					: { source: c.source, jobId: c.job.id, outcome: 'filed' },
				now
			);
		} catch (error) {
			result.errors++;
			console.error(`[filing] ${keyOfJob(c)} failed this tick:`, error);
		}
	}

	result.pruned = await db
		.pruneTransferFilings(new Date(now - LOOKBACK_MS - PRUNE_GRACE_MS))
		.catch((error) => {
			console.error('[filing] pruning old records failed:', error);
			return 0;
		});

	return result;
}
