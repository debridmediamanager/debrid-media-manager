import type { Nzb2rdTransferRecord } from '@/services/database/nzb2rdMap';
import { getNzb2rdUrl } from '@/services/nzb2rd';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { registerCompletedNzb2rdJob } from '@/services/transferRegistration';
import type { NextApiRequest, NextApiResponse } from 'next';

type TransferSummary = {
	releaseId: string;
	status: 'pending' | 'completed';
	infoHash: string | null;
	jobId: string;
};

const summaryOf = (r: Nzb2rdTransferRecord): TransferSummary => ({
	releaseId: r.releaseId,
	status: r.status,
	infoHash: r.infoHash ?? null,
	jobId: r.jobId,
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
		await db.removeNzb2rdTransfer(record.releaseId);
		return null;
	}
	if (job?.status === 'completed') {
		// No page context to pass: the marker and the waiting accounts are what
		// matter here, and `registerCompletedNzb2rdJob` handles both before it
		// needs to know film-vs-season.
		await registerCompletedNzb2rdJob(job, undefined, undefined, record.releaseId);
		const infoHash = typeof job.info_hash === 'string' ? job.info_hash.toLowerCase() : null;
		return { ...summaryOf(record), status: 'completed', infoHash };
	}
	return summaryOf(record);
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
