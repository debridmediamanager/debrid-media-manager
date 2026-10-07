import type { Nzb2rdTransferRecord } from '@/services/database/nzb2rdMap';
import { getNzb2rdUrl, nzb2rdJobOutcome } from '@/services/nzb2rd';
import { repository as db } from '@/services/repository';
import { deliverNzb2rdWaiters, registerCompletedNzb2rdJob } from '@/services/transferRegistration';

/**
 * Settling `nzbrd:` markers, and the waiter lists behind them, against what
 * nzb2rd says actually became of each job.
 *
 * A marker reads `pending` from the submit until something asks nzb2rd about
 * its job and writes the answer. Until this sweep only a browser asked: the
 * submitter's Transfers page, a title page's Usenet section, or a per-job poll.
 * A release nobody looks at again kept its marker `pending` for good, and with
 * it the waiter list of every account that queued behind the job, each entry
 * holding that account's Real-Debrid credentials until delivery.
 *
 * Measured 2026-10-07 against nzb2rd's own records: of 942 `pending` markers,
 * 469 belonged to failed jobs, 14 to completed ones and 9 to jobs nzb2rd had
 * deleted. All three waiter lists then stored sat behind markers pending since
 * 2026-09-17..22; two of those jobs had been deleted on 2026-09-22.
 */

/**
 * Longest a waiting account's credentials are kept, however its job is doing.
 *
 * nzb2rd has no total job timeout: `config.ts` drops it on purpose, because a
 * slow release is not a stuck one, and its queue wait is unbounded. So no
 * timeout exists to add a margin to, and this is measured instead. Of 14,749
 * jobs on 2026-10-07, submit to completion or failure took p99 15 days and at
 * most 24.3, with the queue then 23 days deep. Thirty days is that maximum with
 * a margin. Every list is settled against its job each tick, so this only
 * decides for a job nzb2rd never gives a definite answer about.
 */
export const WAITER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Waiter lists examined per tick. A handful exist at any time. */
export const WAITER_LIST_BATCH = 25;

/**
 * `pending` markers checked per tick, drawn at random. With 450 live ones in
 * the pool, a marker whose job has just ended is drawn after about 23 ticks on
 * average, two hours. A waiter list's marker is checked every tick regardless.
 */
export const PENDING_MARKER_BATCH = 20;

/** Per job. The cron shares its five minutes with the other sweeps. */
const SETTLE_TIMEOUT_MS = 4000;
const SETTLE_CONCURRENCY = 4;

export type MarkerSettlement =
	/** nzb2rd no longer has the job, or deleted it before it finished. */
	| { outcome: 'removed' }
	| { outcome: 'failed'; error?: string }
	| { outcome: 'completed'; job: any }
	/** Still in line or in progress: the marker is left as it was. */
	| { outcome: 'live'; job: any }
	/** No definite answer from nzb2rd: the marker is left as it was. */
	| { outcome: 'unknown' };

/**
 * Ask nzb2rd what became of a marker's job and record the answer.
 *
 * Read-only towards nzb2rd. **Fails open**: anything short of a definite answer
 * leaves the marker exactly as it was, because dropping one for a job that is
 * still running lets a second Usenet fetch of the same release start, which is
 * the cost the marker exists to avoid.
 */
export async function settleNzb2rdMarker(
	record: Nzb2rdTransferRecord,
	timeoutMs: number = SETTLE_TIMEOUT_MS
): Promise<MarkerSettlement> {
	let job: any;
	try {
		const response = await fetch(`${getNzb2rdUrl()}/jobs/${encodeURIComponent(record.jobId)}`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(timeoutMs),
		});
		// A job nzb2rd no longer has cannot be fetching anything.
		if (response.status === 404) {
			await db.removeNzb2rdTransfer(record.releaseId);
			return { outcome: 'removed' };
		}
		if (!response.ok) return { outcome: 'unknown' };
		job = await response.json();
	} catch {
		return { outcome: 'unknown' };
	}

	switch (nzb2rdJobOutcome(job)) {
		case 'gone':
			// Deleted while still in line or mid-stage: it will never move again.
			await db.removeNzb2rdTransfer(record.releaseId);
			return { outcome: 'removed' };
		case 'failed': {
			const error = typeof job.error === 'string' ? job.error : undefined;
			// Kept, not dropped: the row shows an enabled Retry carrying the reason,
			// and a `failed` marker vetoes nothing, because the dedup check re-reads
			// the job. Recording it also drops the waiter list.
			await db.recordNzb2rdTransferFailed(
				record.releaseId,
				record.jobId,
				record.imdbId,
				error,
				record.title
			);
			return { outcome: 'failed', error };
		}
		case 'completed':
			// Records the marker completed, hands the torrent to the waiter list,
			// and files the release, resolving film-vs-season itself because no
			// page is attached here.
			await registerCompletedNzb2rdJob(job, undefined, undefined, record.releaseId);
			return { outcome: 'completed', job };
		default:
			return { outcome: 'live', job };
	}
}

export interface MarkerReconcileResult {
	/** Waiter lists examined. */
	waiterLists: number;
	/** Waiting accounts dropped for outliving `WAITER_MAX_AGE_MS`. */
	expiredWaiters: number;
	/** Lists dropped because their marker is gone or already failed. */
	orphanedLists: number;
	/** Accounts handed a torrent whose marker was already completed. */
	delivered: number;
	/** Markers checked against nzb2rd, and what each turned out to be. */
	checked: number;
	removed: number;
	failed: number;
	completed: number;
	live: number;
	unknown: number;
}

/**
 * The cron's pass: settle every waiter list and a sample of `pending` markers.
 *
 * A waiter list goes when its job ends, within one tick of nzb2rd saying so:
 * delivered for a completed job, dropped for a failed, deleted or forgotten
 * one. Entries older than `WAITER_MAX_AGE_MS` go regardless.
 */
export async function reconcileNzb2rdMarkers(
	options: { now?: number; markerBatch?: number } = {}
): Promise<MarkerReconcileResult> {
	const now = options.now ?? Date.now();
	const result: MarkerReconcileResult = {
		waiterLists: 0,
		expiredWaiters: 0,
		orphanedLists: 0,
		delivered: 0,
		checked: 0,
		removed: 0,
		failed: 0,
		completed: 0,
		live: 0,
		unknown: 0,
	};
	const toSettle = new Map<string, Nzb2rdTransferRecord>();

	for (const list of await db.listNzb2rdWaiterLists(WAITER_LIST_BATCH)) {
		result.waiterLists++;
		const fresh = list.waiters.filter(
			(w) => typeof w?.queuedAt === 'number' && now - w.queuedAt < WAITER_MAX_AGE_MS
		);
		if (fresh.length < list.waiters.length || list.waiters.length === 0) {
			// Someone joined since the read: next tick sees the list they wrote.
			if (!(await db.pruneNzb2rdWaiters(list.releaseId, fresh, list.updatedAt))) continue;
			result.expiredWaiters += list.waiters.length - fresh.length;
			if (fresh.length === 0) continue;
		}

		const marker = await db.getNzb2rdTransfer(list.releaseId);
		if (!marker || marker.status === 'failed') {
			// Nothing will ever deliver to these. A waiter is only added behind a
			// live job, so a list left here was missed when that job ended.
			await db.clearNzb2rdWaiters(list.releaseId);
			result.orphanedLists++;
			continue;
		}
		if (marker.status === 'completed') {
			if (marker.infoHash) {
				result.delivered += await deliverNzb2rdWaiters(
					list.releaseId,
					marker.infoHash,
					marker.jobId
				);
			} else {
				await db.clearNzb2rdWaiters(list.releaseId);
				result.orphanedLists++;
			}
			continue;
		}
		toSettle.set(marker.releaseId, marker);
	}

	const sample = await db.sampleNzb2rdPendingMarkers(options.markerBatch ?? PENDING_MARKER_BATCH);
	for (const marker of sample) {
		if (!toSettle.has(marker.releaseId)) toSettle.set(marker.releaseId, marker);
	}

	const queue = [...toSettle.values()];
	const worker = async () => {
		for (let record = queue.shift(); record; record = queue.shift()) {
			result.checked++;
			try {
				result[(await settleNzb2rdMarker(record)).outcome]++;
			} catch (error) {
				result.unknown++;
				console.error(`[nzb2rd] settling the marker of job ${record.jobId} failed:`, error);
			}
		}
	};
	await Promise.all(Array.from({ length: SETTLE_CONCURRENCY }, worker));

	return result;
}
