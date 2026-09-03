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
	};

	const pending = await db.listPendingDebridTransfers(batch);

	for (const record of pending) {
		result.checked++;

		const server = await resolveJobServer(record.jobId, (j) => db.getDebridJobServer(j));
		if (!server) {
			result.unreachable++;
			continue;
		}

		const { job, gone, unreachable } = await lookupJob(server, record.jobId);
		if (unreachable) {
			result.unreachable++;
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

	return result;
}
