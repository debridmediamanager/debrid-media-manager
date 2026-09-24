import { lookupJob } from '@/services/debridTransferReconcile';
import { isAllowedServer } from '@/services/debridUploaderServers';
import { repository as db } from '@/services/repository';

/**
 * Settling requests whose transfer has ended.
 *
 * A fulfil hands the uploader a job and leaves the request `claimed`, because
 * an accepted job is not a delivered one. This sweep asks the owning host how
 * each job ended: `completed` makes the request `fulfilled`; `failed`, or a
 * host that no longer knows the job, puts it back on the board with the
 * uploader's reason, where a fulfiller whose TorBox does have it can take it.
 *
 * Before this existed a request was marked done the moment its job was queued.
 * Measured 2026-09-24: of 369 requests shown as sent, 322 had failed on the
 * uploader and 43 had completed. Every one of the 322 left the board and the
 * asker was never told.
 */

/**
 * Rows examined per tick. It shares the five-minute cron with the transfer
 * reconciler, which spends up to 25 × 8s, so this stays small enough that the
 * two together fit inside the interval.
 */
export const REQUEST_RECONCILE_BATCH = 20;

/**
 * How long a claim may sit without a job before it is presumed abandoned. The
 * fulfil route attaches the job within one uploader round trip (30s timeout),
 * so a claim with no job after this long means the route died mid-way.
 */
export const ORPHANED_CLAIM_MS = 10 * 60 * 1000;

export interface RequestReconcileResult {
	checked: number;
	delivered: number;
	reopened: number;
	inFlight: number;
	unreachable: number;
}

export async function reconcileContentRequests(
	batch: number = REQUEST_RECONCILE_BATCH,
	now: number = Date.now()
): Promise<RequestReconcileResult> {
	const result: RequestReconcileResult = {
		checked: 0,
		delivered: 0,
		reopened: 0,
		inFlight: 0,
		unreachable: 0,
	};

	const claimed = await db.listClaimedContentRequests(batch);
	for (const row of claimed) {
		result.checked++;

		if (!row.jobId || !row.jobHost) {
			const age = now - new Date(row.updatedAt ?? row.createdAt).getTime();
			if (age > ORPHANED_CLAIM_MS) {
				if (await db.releaseContentRequest(row.id, 'the transfer never started')) {
					result.reopened++;
				}
			} else {
				result.inFlight++;
			}
			continue;
		}

		// The host comes from our own row, but it is still a URL we are about to
		// fetch, so it must be one of the configured uploaders. One that has been
		// taken out of the pool (debrid01, 2026-09-01) will never answer again, so
		// its claims go back to the board rather than waiting forever.
		if (!isAllowedServer(row.jobHost)) {
			if (
				await db.releaseContentRequest(row.id, 'the uploader host was retired', row.jobId)
			) {
				result.reopened++;
			}
			continue;
		}

		const { job, gone, unreachable } = await lookupJob(row.jobHost, row.jobId);
		if (unreachable) {
			result.unreachable++;
			await db.touchClaimedContentRequest(row.id);
			continue;
		}

		if (job?.status === 'completed') {
			if (await db.settleContentRequestDelivered(row.id, row.jobId)) result.delivered++;
			continue;
		}

		if (gone || job?.status === 'failed') {
			const reason = gone
				? 'the uploader lost the transfer'
				: typeof job?.error === 'string' && job.error
					? job.error
					: 'the transfer failed';
			if (await db.releaseContentRequest(row.id, reason, row.jobId)) result.reopened++;
			continue;
		}

		result.inFlight++;
		await db.touchClaimedContentRequest(row.id);
	}

	return result;
}
