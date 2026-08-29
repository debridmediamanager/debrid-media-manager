import { toast } from 'react-hot-toast';
import { TransferContext } from './debridUploader';
import {
	phaseLabelOf,
	ProgressFields,
	QueuePlace,
	toastRdUnderway,
	TRANSFER_LABELS,
	TRANSFER_STEP_TOAST_MS,
	TRANSFER_TOAST_MS,
} from './transferPhase';

// Client side of the Usenet → RD flow. Mirrors utils/debridUploader so both
// transfer kinds behave the same on the Transfers page: the service has no
// notion of users — its job list is global — so each browser remembers the jobs
// it created and the page polls only those.

export type Nzb2rdJobStatus =
	| 'pending'
	| 'probing'
	| 'hashing'
	| 'fetching'
	| 'unpacking'
	| 'preparing'
	| 'uploading'
	| 'completed'
	| 'failed';

export interface Nzb2rdJob {
	id: string;
	status: Nzb2rdJobStatus;
	status_message?: string | null;
	error?: string | null;
	name?: string | null;
	nzb_name?: string | null;
	rd_torrent_id?: string | null;
	info_hash?: string | null;
	// Byte counters the service keeps for its SABnzbd surface, passed straight
	// through by the status route. `done_bytes` walks 0 → total twice: once
	// while the release comes off Usenet, then again as RD pulls it — so it is
	// only a progress fraction *within* the current stage, never overall.
	total_bytes?: number | null;
	done_bytes?: number | null;
	/** Place in line, sent only while the job is still waiting to start. */
	queue?: QueuePlace | null;
	/** Set by the status route when it files the finished torrent in DMM's DB. */
	dmm_registered?: boolean;
}

/** A transfer for this release already exists, so no new job was created. */
export interface Nzb2rdDuplicate {
	duplicate: 'completed' | 'in_progress';
	infoHash: string | null;
	jobId: string;
	/** completed: whether the cached torrent was added to this caller's account. */
	added?: boolean;
	/** in_progress: this caller is queued to receive it when the job lands. */
	queued?: boolean;
}

export function isNzb2rdDuplicate(r: Nzb2rdJob | Nzb2rdDuplicate): r is Nzb2rdDuplicate {
	return 'duplicate' in r;
}

async function parseJsonResponse(response: Response): Promise<any> {
	const data = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(data?.error || `Request failed with status ${response.status}`);
	}
	return data;
}

/**
 * Send the release, and the credentials nzb2rd needs to still be able to reach
 * Real-Debrid when it eventually runs.
 *
 * `rdKey` alone is not enough and this was a live bug: it is an OAuth *access
 * token*, which RD expires 24 hours after it is minted, while nzb2rd's queue is
 * routinely days deep. Measured 2026-08-17, 1298 of its 1952 failures were
 * `401 bad_token` at the hand-off, none of them under an hour of queue wait —
 * the token was alive at submit and dead by the time the job reached the front.
 *
 * The OAuth triple does not expire, so nzb2rd mints its own token at the moment
 * it calls RD. It is optional: without it the service falls back to the token,
 * which is exactly the old behaviour.
 */
export async function createNzb2rdJob(params: {
	id: string;
	title: string;
	imdbId: string;
	rdKey: string;
	oauth?: { clientId: string; clientSecret: string; refreshToken: string } | null;
	/**
	 * The page this was started from, stored server-side against the job id. The
	 * Transfers page is server-driven now and nzb2rd records no such thing, so
	 * without it a row links nowhere — on every device, not just a new one.
	 */
	returnPath?: string;
}): Promise<Nzb2rdJob | Nzb2rdDuplicate> {
	const response = await fetch('/api/nzb2rd/jobs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params),
	});
	return parseJsonResponse(response);
}

function jobQuery(context?: TransferContext, releaseId?: string): string {
	const params = new URLSearchParams();
	if (context) {
		params.set('mediaType', context.mediaType);
		if (context.seasonNum !== undefined) params.set('seasonNum', `${context.seasonNum}`);
	}
	if (releaseId) params.set('releaseId', releaseId);
	return params.size > 0 ? `?${params}` : '';
}

export async function getNzb2rdJob(
	jobId: string,
	context?: TransferContext,
	releaseId?: string
): Promise<Nzb2rdJob> {
	const response = await fetch(
		`/api/nzb2rd/jobs/${encodeURIComponent(jobId)}${jobQuery(context, releaseId)}`
	);
	return parseJsonResponse(response);
}

/**
 * Cancel a transfer.
 *
 * `rdKey` is proof of ownership, not a convenience: nzb2rd's `DELETE /jobs/:id`
 * used to delete on a job id alone, so anyone who learned an id could cancel a
 * stranger's transfer. It now requires a key that resolves to the job's owner,
 * and a caller that sends none is refused. Passed as a **header** rather than a
 * query param so it stays out of nginx's and Caddy's request logs.
 */
export async function deleteNzb2rdJob(
	jobId: string,
	releaseId?: string,
	rdKey?: string
): Promise<void> {
	const response = await fetch(
		`/api/nzb2rd/jobs/${encodeURIComponent(jobId)}${jobQuery(undefined, releaseId)}`,
		{ method: 'DELETE', headers: rdKey ? { 'x-rd-api-key': rdKey } : undefined }
	);
	await parseJsonResponse(response);
}

const POLL_MS = 5000;
const MAX_POLLS = 360; // 30 min of Usenet work; RD's own pull isn't waited on

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Follows a Usenet transfer to the same place a TorBox or AllDebrid one stops:
 * `uploading`, where RD is pulling the bytes out of the webseed. Until then the
 * toast walks the phases — the Usenet pass is minutes of real work, and a lone
 * "sent" said at submit time leaves it looking like nothing is happening.
 *
 * Nothing is owed to this user's RD afterwards: nzb2rd queues every caller's key
 * against the job and delivers to all of them itself, which is why a joined
 * Usenet transfer needs no client-side handoff the way a joined TB/AD one does.
 *
 * Runs detached from the click that started it — the row says "Sent" as soon as
 * the job exists, and a Usenet fetch is far too long to hold a button on.
 */
export async function followNzb2rdTransfer(params: {
	jobId: string;
	toastId?: string;
	context?: TransferContext;
	releaseId?: string;
}): Promise<void> {
	const { jobId, toastId, context, releaseId } = params;
	const label = TRANSFER_LABELS.usenet;

	for (let poll = 0; poll < MAX_POLLS; poll++) {
		await wait(POLL_MS);

		let job;
		try {
			job = await getNzb2rdJob(jobId, context, releaseId);
		} catch {
			continue; // transient poll failure; the job keeps running server-side
		}

		if (job.status === 'completed') {
			toast.success(`${label}: done! It is in your Real-Debrid library.`, {
				id: toastId,
				duration: TRANSFER_TOAST_MS,
			});
			return;
		}
		if (job.status === 'failed') {
			toast.error(`${label} failed: ${job.error || 'unknown error'}`, {
				id: toastId,
				duration: TRANSFER_TOAST_MS,
			});
			return;
		}
		if (job.status === 'uploading') {
			toastRdUnderway(label, toastId);
			return;
		}

		toast.loading(`${label}: ${job.status_message || phaseLabelOf('nzb2rd', job.status)}`, {
			id: toastId,
			duration: TRANSFER_STEP_TOAST_MS,
		});
	}

	// Not a failure the way it would be for a cached transfer: a big release can
	// genuinely spend this long coming off Usenet before RD is handed anything.
	toast(`${label}: still fetching after 30 min — follow it on the Transfers page.`, {
		id: toastId,
		duration: TRANSFER_TOAST_MS,
	});
}

export interface TrackedNzb2rdJob {
	id: string;
	/** Indexer release id — the dedup key, and what a poll files results under. */
	releaseId: string;
	imdbId: string;
	title?: string;
	/** Content page the transfer started from, e.g. /movie/tt123 or /show/tt123/1 */
	returnPath?: string;
	createdAt: number;
}

const TRACKED_JOBS_KEY = 'nzb2rd:jobs';
const MAX_TRACKED_JOBS = 100;

export function getTrackedNzb2rdJobs(): TrackedNzb2rdJob[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(TRACKED_JOBS_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function trackNzb2rdJob(job: TrackedNzb2rdJob): void {
	if (typeof window === 'undefined') return;
	const jobs = [job, ...getTrackedNzb2rdJobs().filter((j) => j.id !== job.id)].slice(
		0,
		MAX_TRACKED_JOBS
	);
	window.localStorage.setItem(TRACKED_JOBS_KEY, JSON.stringify(jobs));
}

export function untrackNzb2rdJob(jobId: string): void {
	if (typeof window === 'undefined') return;
	const jobs = getTrackedNzb2rdJobs().filter((j) => j.id !== jobId);
	window.localStorage.setItem(TRACKED_JOBS_KEY, JSON.stringify(jobs));
}

export function isTerminalNzb2rdStatus(status: Nzb2rdJobStatus): boolean {
	return status === 'completed' || status === 'failed';
}

export interface Nzb2rdTransferSummary {
	releaseId: string;
	status: 'pending' | 'completed';
	infoHash: string | null;
	jobId: string;
	/**
	 * Where the job stands, when the server re-checked it on this request.
	 *
	 * The marker's `pending` conflates waiting in line with being fetched, and
	 * the queue runs days deep, so the two need telling apart on the row.
	 * Undefined when the job was not re-checked — the row then says only that
	 * something is in progress.
	 */
	progress?: ProgressFields;
}

/**
 * Which of these releases already have a transfer, so the section can show
 * "In RD" (someone already fetched it) rather than a Send button that the
 * server would only answer with a duplicate.
 */
export async function fetchNzb2rdTransfers(ids: string[]): Promise<Nzb2rdTransferSummary[]> {
	if (ids.length === 0) return [];
	try {
		const response = await fetch('/api/nzb2rd/registered', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids: ids.slice(0, 200) }),
		});
		if (!response.ok) return [];
		const data = await response.json();
		return Array.isArray(data?.transfers) ? data.transfers : [];
	} catch {
		return []; // best-effort — a missed marker only shows a button that dedups server-side
	}
}
