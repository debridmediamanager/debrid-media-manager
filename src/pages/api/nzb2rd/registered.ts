import type { Nzb2rdTransferRecord } from '@/services/database/nzb2rdMap';
import { getNzb2rdUrl } from '@/services/nzb2rd';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { registerCompletedNzb2rdJob } from '@/services/transferRegistration';
import type { ProgressFields } from '@/utils/transferPhase';
import type { NextApiRequest, NextApiResponse } from 'next';

type TransferSummary = {
	releaseId: string;
	status: 'pending' | 'completed' | 'failed';
	infoHash: string | null;
	jobId: string;
	/** Why a `failed` job failed, so the row's Retry can say what went wrong. */
	error?: string | null;
	/**
	 * Where the job actually is, when this request re-checked it.
	 *
	 * The marker itself only ever says `pending` or `completed`, and `pending`
	 * covers two states a user cares about telling apart: waiting in line, and
	 * being fetched. Measured against the live queue on 2026-08-29, 670 of the
	 * 683 unfinished jobs had **not started** — no `started_at`, not one progress
	 * byte — against 13 actually working, with the oldest having waited 8 days.
	 * So the row's old "Running" was wrong for 98% of the releases wearing it.
	 *
	 * Reconciling already fetched the job to heal the marker; these are the
	 * fields it was throwing away. Absent when the job was not re-checked (past
	 * `MAX_RECONCILE`, or nzb2rd unreachable), and the row stays vague rather
	 * than guessing.
	 */
	progress?: ProgressFields;
};

const summaryOf = (r: Nzb2rdTransferRecord): TransferSummary => ({
	releaseId: r.releaseId,
	status: r.status,
	infoHash: r.infoHash ?? null,
	jobId: r.jobId,
	error: r.error ?? null,
});

/** Only the fields `describeTransfer` reads — never the whole job record, which
 * carries the submitter's RD account id and the internal webseed URL. */
const progressOf = (job: any): ProgressFields => ({
	status: typeof job?.status === 'string' ? job.status : undefined,
	status_message: typeof job?.status_message === 'string' ? job.status_message : null,
	total_bytes: typeof job?.total_bytes === 'number' ? job.total_bytes : null,
	done_bytes: typeof job?.done_bytes === 'number' ? job.done_bytes : null,
	queue:
		job?.queue &&
		typeof job.queue.position === 'number' &&
		typeof job.queue.waiting === 'number'
			? { position: job.queue.position, waiting: job.queue.waiting }
			: null,
});

/**
 * How many `pending` markers one request re-checks against nzb2rd.
 *
 * Bounded because this runs on a page load. In practice almost nothing needs
 * re-checking — 3977 markers existed across the entire catalogue when this was
 * written, against tens of results per page — so the cap only ever bites the
 * pathological case, and whatever it skips is re-checked on the next view.
 */
const MAX_RECONCILE = 8;
const RECONCILE_TIMEOUT_MS = 4000;

/**
 * Ask nzb2rd what actually became of a job whose marker still says `pending`.
 *
 * The marker only ever moved `pending` → `completed`, and only when a browser
 * happened to be polling that job *with its release id*. Jobs take days and the
 * client stops polling after 30 minutes, so the flip usually never happened and
 * nothing at all wrote a failure. Measured 2026-08-28: of 3977 `pending`
 * markers, 2356 belonged to failed jobs and 905 to completed ones — 84% stale,
 * every one of them rendering a disabled "Running" button for every user.
 *
 * Both stale cases are worth fixing here rather than only at the source, and
 * the completed one is worth more than the failed one: it turns a release that
 * cannot be sent into one that is added to the caller's account instantly from
 * RD's cache.
 *
 * **Fails open.** Anything short of nzb2rd giving a definite answer leaves the
 * marker exactly as it was — a blocked release is bad, but dropping a marker
 * for a job that is genuinely running would let a second Usenet fetch start,
 * which is the cost this whole mechanism exists to avoid.
 */
async function reconcile(record: Nzb2rdTransferRecord): Promise<TransferSummary | null> {
	let job: any;
	try {
		const response = await fetch(`${getNzb2rdUrl()}/jobs/${encodeURIComponent(record.jobId)}`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(RECONCILE_TIMEOUT_MS),
		});
		// A job nzb2rd no longer has cannot be fetching anything.
		if (response.status === 404) {
			await db.removeNzb2rdTransfer(record.releaseId);
			return null;
		}
		if (!response.ok) return summaryOf(record);
		job = await response.json();
	} catch {
		return summaryOf(record);
	}

	if (job?.status === 'failed') {
		const error = typeof job.error === 'string' ? job.error : undefined;
		await db.recordNzb2rdTransferFailed(
			record.releaseId,
			record.jobId,
			record.imdbId,
			error,
			record.title
		);
		// Kept, not dropped: the row shows an enabled Retry carrying the reason
		// rather than a bare Send, and a `failed` marker vetoes nothing — the
		// dedup check re-reads the job and lets a resubmit through.
		return { ...summaryOf(record), status: 'failed', error: error ?? null };
	}
	if (job?.status === 'completed') {
		// Nothing to pass: this runs on a page load with no transfer context of
		// its own. `registerCompletedNzb2rdJob` resolves film-vs-season itself
		// from the stored `returnPath` and the IMDb title type, which is what
		// makes the release show up in search results rather than only flipping
		// the marker to a disabled "In RD" pointing at nothing.
		await registerCompletedNzb2rdJob(job, undefined, undefined, record.releaseId);
		const infoHash = typeof job.info_hash === 'string' ? job.info_hash.toLowerCase() : null;
		return { ...summaryOf(record), status: 'completed', infoHash };
	}
	// Still running: hand back where it actually is, so the row can say "Queued,
	// 479th of 670 in line" instead of a flat "Running".
	return { ...summaryOf(record), progress: progressOf(job) };
}

// Given the release ids shown in the Usenet section of a movie/show page, report
// which already have a transfer — completed (the content is in RD under the
// returned info hash) or still running. Lets the section show "In RD" / "Sending"
// instead of a Send button that would only be rejected as a duplicate, and makes
// one user's fetch visible to everyone else looking at the same title.
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { ids } = req.body ?? {};
	if (!Array.isArray(ids) || ids.length === 0) {
		return res.status(400).json({ error: 'ids must be a non-empty array' });
	}
	if (ids.length > 200) {
		return res.status(400).json({ error: 'too many ids (max 200)' });
	}

	const valid = ids.filter(
		(id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id)
	);
	if (valid.length === 0) {
		return res.status(200).json({ transfers: [] });
	}

	try {
		const records = await db.getNzb2rdTransfers(valid);
		const stale = records.filter((r) => r.status === 'pending').slice(0, MAX_RECONCILE);
		const staleIds = new Set(stale.map((r) => r.releaseId));
		const settled = await Promise.all(
			stale.map((r) =>
				reconcile(r).catch((error) => {
					console.error('Reconciling an nzb2rd transfer marker failed:', error);
					return summaryOf(r);
				})
			)
		);
		const transfers: TransferSummary[] = [
			...records.filter((r) => !staleIds.has(r.releaseId)).map(summaryOf),
			...settled.filter((s): s is TransferSummary => s !== null),
		];
		return res.status(200).json({ transfers });
	} catch (error) {
		console.error('nzb2rd transfer lookup failed:', error);
		return res.status(500).json({ error: 'lookup failed' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
