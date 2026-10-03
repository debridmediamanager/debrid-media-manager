/** The `error` a cancelled job carries, matching what the uploader now reports. */
export const CANCELLED_JOB_ERROR = 'cancelled';

/**
 * An uploader job as DMM should read it: a cancel counts as the outcome it is.
 *
 * Cancelling a job (`DELETE /jobs/:id`, the Transfers page's Cancel) only sets
 * `deleted` on the uploader's row. Until the uploader started reporting such a
 * job as `failed` itself, it kept answering with the stage it was cancelled in
 * (`uploading`, `pending`, `downloading`) for good, and everything here took
 * that for a transfer in progress. The send button joined it and waited 30
 * minutes, the dedup refused every later send of the release for every user, and
 * both sweeps kept it in flight forever. On 2026-10-03 that was 222 of the 224
 * pending `tbrd:` mappings and all four open request-board claims (card 109).
 *
 * Applied wherever DMM reads a job, so an uploader host still running a build
 * from before that change is read correctly too. A job that finished before its
 * cancel keeps its real outcome: a completed transfer is in RD regardless.
 *
 * Pure and dependency-free on purpose: API routes, cron sweeps and anything the
 * browser bundle pulls in can all import it.
 */
export function settleCancelledDebridJob<T>(job: T): T {
	if (!job || typeof job !== 'object') return job;
	const { deleted, status } = job as { deleted?: unknown; status?: unknown };
	if (!deleted || status === 'completed' || status === 'failed') return job;
	return { ...job, status: 'failed', error: CANCELLED_JOB_ERROR };
}
