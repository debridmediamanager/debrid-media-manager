import { resolveJobServer } from '@/services/debridUploaderServers';
import { repository as db } from '@/services/repository';
import { registerCompletedDebridJob } from '@/services/transferRegistration';

/**
 * Catching up on TB → RD transfers that finished while nobody was watching.
 *
 * A completed transfer is only useful to anyone other than its submitter once
 * DMM records the *rewritten* hash: the uploader de-infringes the filenames and
 * salts the torrent, so the content lands in Real-Debrid under an info hash that
 * appears in no search result and that the original magnet can never reach.
 * Recording it is what puts the release in `Available` and lets a second user's
 * submit dedup hand it straight to their account.
 *
 * That recording used to happen in one place only — `GET /api/debrid-uploader/
 * jobs/[id]`, i.e. a browser sitting on the page polling. Close the tab before
 * the job finishes and nothing ever wrote it, with no second chance anywhere.
 *
 * Measured on production 2026-09-03, against debrid02's own job table: of 1499
 * mappings still marked `pending`, **344 had actually completed**, and only 9 of
 * those 344 rewritten hashes had reached `Available`. So roughly 335 finished
 * transfers were invisible — the TorBox bandwidth and the uploader egress spent,
 * the content sitting in RD, reachable by nobody. The remaining pending rows
 * were 575 failed jobs and 452 belonging to the retired debrid01, both of which
 * pin the mapping open forever and make `isTransferStillValid` answer "still in
 * progress" to every later submitter of that hash.
 *
 * So the sweep does two things, and prunes as readily as it registers: a
 * mapping that can never complete is worse than no mapping at all, because it
 * blocks the resubmission that would fix it.
 */

/**
 * Mappings examined per tick, and how long each lookup may take.
 *
 * The two are one decision: the cron fires every 5 minutes and the sweep runs
 * sequentially, so `RECONCILE_BATCH × LOOKUP_TIMEOUT_MS` has to stay under that
 * interval or a stalled uploader piles ticks on top of each other. 25 × 8s =
 * 200s leaves headroom; the same batch at the 15s used elsewhere would not.
 * 8 seconds also matches what `resolveJobServer` already allows a job lookup.
 */
export const RECONCILE_BATCH = 25;
const LOOKUP_TIMEOUT_MS = 8000;

/**
 * Completed mappings re-examined per tick for a missing search entry.
 *
 * Smaller than the pending batch because the common answer is "already filed",
 * which costs one indexed lookup and no uploader call at all.
 */
export const REFILE_BATCH = 10;

export interface ReconcileResult {
	checked: number;
	/** Completed jobs whose mapping (and, where filable, search entry) was written. */
	registered: number;
	/** Mappings dropped because the job failed or the uploader no longer has it. */
	pruned: number;
	/** Jobs still in flight — left alone, re-checked next tick. */
	inFlight: number;
	/** Jobs whose owning server could not be reached this tick. */
	unreachable: number;
	/** Already-completed transfers that were missing from search and got filed. */
	refiled: number;
}

interface UploaderJobLookup {
	/** The job body, when the server answered with one. */
	job?: any;
	/** The server definitively does not have this job (404). */
	gone: boolean;
	/** Could not get an answer — transient, so nothing is concluded. */
	unreachable: boolean;
}

async function lookupJob(server: string, jobId: string): Promise<UploaderJobLookup> {
	try {
		const res = await fetch(`${server}/jobs/${jobId}`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
		});
		if (res.status === 404) return { gone: true, unreachable: false };
		if (!res.ok) return { gone: false, unreachable: true };
		return { job: await res.json(), gone: false, unreachable: false };
	} catch {
		return { gone: false, unreachable: true };
	}
}

/**
 * Reconcile a batch of `pending` TB → RD mappings against the uploader fleet.
 *
 * Every branch is deliberately conservative about pruning: only a definite
 * signal — the owning server answering 404, or the job itself reporting
 * `failed` — drops a mapping. An unreachable host concludes nothing, because an
 * uploader outage would otherwise wipe the mapping for every transfer at once
 * and send a fleet of redundant jobs at TorBox when it came back.
 */
export async function reconcileDebridTransfers(
	batch: number = RECONCILE_BATCH
): Promise<ReconcileResult> {
	const result: ReconcileResult = {
		checked: 0,
		registered: 0,
		pruned: 0,
		inFlight: 0,
		unreachable: 0,
		refiled: 0,
	};

	const pending = await db.listPendingDebridTransfers(batch);

	// A mapping this tick leaves alone goes to the back of the queue, so the next
	// tick looks at different rows. Without it the scan's oldest-first order
	// re-examines the same long-running jobs forever and the backlog behind them
	// is never reached — see `touchPending`.
	const leaveForNextTick = (record: (typeof pending)[number]) =>
		db.touchDebridTransfer(record).catch((e) => {
			console.error(`[reconcile] re-queueing ${record.originalHash} failed:`, e);
		});

	for (const record of pending) {
		result.checked++;

		const server = await resolveJobServer(record.jobId, (j) => db.getDebridJobServer(j));
		if (!server) {
			result.unreachable++;
			await leaveForNextTick(record);
			continue;
		}

		const { job, gone, unreachable } = await lookupJob(server, record.jobId);
		if (unreachable) {
			result.unreachable++;
			await leaveForNextTick(record);
			continue;
		}

		if (gone || job?.status === 'failed') {
			await db.removeDebridTransfer(record.originalHash).catch((e) => {
				console.error(`[reconcile] pruning ${record.originalHash} failed:`, e);
			});
			result.pruned++;
			continue;
		}

		if (job?.status !== 'completed') {
			result.inFlight++;
			await leaveForNextTick(record);
			continue;
		}

		try {
			// No page context to pass: `registerCompletedDebridJob` resolves it
			// from the stored returnPath or the IMDb title type. It writes the
			// completed mapping before it tries to file the search entry, so even
			// a title with nowhere to be filed stops blocking resubmission.
			await registerCompletedDebridJob(job, undefined, undefined, server);
			result.registered++;
		} catch (error) {
			console.error(`[reconcile] registering job ${record.jobId} failed:`, error);
		}
	}

	result.refiled = await refileUnsearchable(leaveForNextTick);
	return result;
}

/**
 * File a completed transfer that never made it into search.
 *
 * The mapping goes `completed` the moment the rewritten hash is known, before
 * the filing is attempted, and deliberately so: a mapping is what stops a
 * second user from running the whole pipeline again for content that is already
 * in RD. But that means a filing which fails — no page context to file under, a
 * file list with no RD links, a transient DB error — leaves the release
 * redeemable and invisible, and nothing ever looked at it again.
 *
 * `registerCompletedDebridJob` is idempotent and returns false for anything
 * already registered, so this is safe to re-run on every row forever; the
 * `Available` check just avoids paying an uploader round-trip to be told so.
 */
type TransferRecord = Awaited<ReturnType<typeof db.listCompletedDebridTransfers>>[number];

async function refileUnsearchable(
	leaveForNextTick: (record: TransferRecord) => Promise<void>
): Promise<number> {
	let refiled = 0;
	const completed = await db.listCompletedDebridTransfers(REFILE_BATCH);

	for (const record of completed) {
		await leaveForNextTick(record);
		if (!record.rewrittenHash) continue;

		try {
			const available = await db.checkAvailabilityByHashes([record.rewrittenHash]);
			if (available.length > 0) continue;

			const server = await resolveJobServer(record.jobId, (j) => db.getDebridJobServer(j));
			if (!server) continue;

			const { job } = await lookupJob(server, record.jobId);
			if (job?.status !== 'completed') continue;

			if (await registerCompletedDebridJob(job, undefined, undefined, server)) refiled++;
		} catch (error) {
			console.error(`[reconcile] re-filing job ${record.jobId} failed:`, error);
		}
	}

	return refiled;
}
