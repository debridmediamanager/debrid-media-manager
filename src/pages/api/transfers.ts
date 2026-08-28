import { resolveJobServer } from '@/services/debridUploaderServers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository as db } from '@/services/repository';
import { keyOf, listTransfers, RD_KEY_HEADER, withMeta } from '@/services/transferList';
import {
	registerCompletedDebridJob,
	registerCompletedNzb2rdJob,
} from '@/services/transferRegistration';
import { transferContextFromPath } from '@/utils/transferContext';
import type { TransferRow, TransfersResponse } from '@/utils/transfers';
import type { NextApiRequest, NextApiResponse } from 'next';

// Every transfer on the caller's Real-Debrid account, in one request.
//
// This replaces a list read from `localStorage` plus one status request per
// tracked job per 5s tick. Keying on the RD account instead of the browser is
// what makes a transfer started on one device visible on another — and it also
// surfaces transfers DMM never submitted, which is deliberate: an *arr pushing
// into nzb2rd's SABnzbd API lands on the same account and is the same person's
// transfer.
//
// The RD key arrives as a header and is forwarded as one. It must never become
// a query param: nginx in front of DMM logs query strings, and this route is
// polled every 5 seconds, so a key in the URL is a key written to disk hundreds
// of times a day.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
	if (typeof raw !== 'string' || raw.trim() === '') return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Stop a failed Usenet job from blocking its release forever.
 *
 * The `nzbrd:<releaseId>` marker is what the Usenet section reads to decide
 * whether a release is already being fetched, and it only ever moved
 * `pending` → `completed`. Nothing wrote a failure, so a failed job left the
 * marker at `pending` — and because the marker is keyed on the indexer release
 * id it is shared, so one person's failure rendered a disabled "Running" button
 * for *everyone* looking at that title. Measured 2026-08-28: 2356 releases were
 * blocked this way.
 *
 * Removing it also drops the waiter list, which is right: those accounts queued
 * behind a job that will never deliver, and their stored credentials should not
 * outlive it.
 */
async function clearMarkerIfFailed(row: TransferRow): Promise<void> {
	if (row.source !== 'nzb2rd' || row.status !== 'failed' || !row.releaseId) return;
	await db.removeNzb2rdTransfer(row.releaseId);
}

/**
 * File a newly-completed transfer into DMM's search index.
 *
 * The registration needs the movie-vs-show context the transfer was started
 * from, which is exactly what `returnPath` encodes — so a row with no stored
 * context (an *arr job, or one submitted before DMM began recording it) is
 * skipped rather than filed under a guess. `imdb_id` alone cannot stand in for
 * it: nothing in it says whether the release is a film or one season of a show.
 *
 * Best-effort and idempotent. The registration functions short-circuit on an
 * already-available hash, so re-running on every poll of a completed row costs
 * one availability lookup.
 */
async function registerIfCompleted(row: TransferRow, job: any): Promise<void> {
	if (row.status !== 'completed' || !job) return;
	const context = transferContextFromPath(row.returnPath);

	if (row.source === 'nzb2rd') {
		// Deliberately not gated on `context`. Filing the release into the search
		// index needs to know film-vs-season, but the two things that happen
		// first — recording the `nzbrd:` marker as completed, and handing the
		// finished torrent to every account that queued behind this job — need no
		// context at all. Returning early on a missing `returnPath` skipped both,
		// which is why only 189 markers ever reached `completed` against 4210
		// completed jobs, and why the release then showed a disabled "Running"
		// instead of the instant "In RD" add it had earned.
		await registerCompletedNzb2rdJob(
			job,
			context?.mediaType,
			context?.seasonNum,
			row.releaseId
		);
		return;
	}
	if (!context) return;
	// Only the host that created a debrid job can serve the file list the
	// registration is built from.
	const server = await resolveJobServer(row.id, (j) => db.getDebridJobServer(j));
	if (!server) return;
	await registerCompletedDebridJob(job, context.mediaType, context.seasonNum, server);
}

async function handler(
	req: NextApiRequest,
	res: NextApiResponse<TransfersResponse | { error: string }>
) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const rdKey = req.headers[RD_KEY_HEADER];
	if (typeof rdKey !== 'string' || !rdKey) {
		return res.status(401).json({ error: `${RD_KEY_HEADER} required` });
	}

	const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
	const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

	try {
		const { transfers, raw, degraded } = await listTransfers(rdKey, limit, offset);

		// One query for the whole page, not one per row: this is polled every 5
		// seconds and a page holds up to 200 rows.
		const meta = await db
			.getTransferMeta(transfers.map((t) => ({ source: t.source, jobId: t.id })))
			.catch((error) => {
				console.error(
					'Reading transfer context failed (rows keep their raw names):',
					error
				);
				return new Map();
			});
		const enriched = transfers.map((row) => withMeta(row, meta.get(keyOf(row))));

		// Not awaited, and deliberately: filing a finished transfer into DMM's
		// index is for everyone else's benefit, so it must never delay — or fail —
		// the list this user is waiting on.
		for (const row of enriched) {
			registerIfCompleted(row, raw.get(keyOf(row))).catch((error) =>
				console.error(`Registering completed transfer ${row.id} failed:`, error)
			);
			clearMarkerIfFailed(row).catch((error) =>
				console.error(`Clearing the marker for failed transfer ${row.id} failed:`, error)
			);
		}

		return res.status(200).json({ transfers: enriched, degraded });
	} catch (error) {
		console.error('Listing transfers failed:', error);
		return res.status(502).json({ error: 'Could not reach the transfer services' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
