import { addHashAsMagnet, selectFiles } from '@/services/realDebrid';
import { toast } from 'react-hot-toast';
import { type TransferContext, transferContextFromPath } from './transferContext';
import {
	phaseLabelOf,
	QueuePlace,
	toastRdUnderway,
	TRANSFER_LABELS,
	TRANSFER_STEP_TOAST_MS,
	TRANSFER_TOAST_MS,
} from './transferPhase';

export type DebridUploaderJobStatus =
	| 'pending'
	| 'downloading'
	| 'preparing'
	| 'uploading'
	| 'completed'
	| 'failed';

export interface DebridUploaderJob {
	id: string;
	status: DebridUploaderJobStatus;
	status_message?: string | null;
	error?: string | null;
	rd_torrent_id?: string | null;
	info_hash?: string | null;
	name?: string | null;
	/** Place in line, sent only while the job is still waiting to start. */
	queue?: QueuePlace | null;
	/**
	 * Which cached provider served this job — `torbox`, `alldebrid` or `qbit`.
	 * Null until the service commits to one, since it tries them in turn.
	 */
	source?: string | null;
}

async function parseJsonResponse(response: Response): Promise<any> {
	const data = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(data?.error || `Request failed with status ${response.status}`);
	}
	return data;
}

// A transfer for this content already exists (any user), so no job was created.
export interface DebridUploaderDuplicate {
	duplicate: 'completed' | 'in_progress';
	rewrittenHash: string | null;
	jobId: string;
	addedToRd?: boolean;
}

export function isDuplicateResponse(
	r: DebridUploaderJob | DebridUploaderDuplicate
): r is DebridUploaderDuplicate {
	return 'duplicate' in r;
}

export interface CreateDebridJobParams {
	hash: string;
	imdbId: string;
	rdKey: string;
	// TorBox is the only cache source; see api/debrid-uploader/jobs.ts for why
	// AllDebrid was withdrawn.
	tbKey?: string;
	sizeBytes?: number;
	/**
	 * The DMM title and the page this was started from. Stored server-side against
	 * the job id, because the Transfers page is server-driven now and neither
	 * uploader service records either — so without these a row shows a raw release
	 * name and links nowhere, on every device including this one.
	 */
	title?: string;
	returnPath?: string;
}

// Submits a cached hash to the debrid uploader service, which rebuilds it as a
// webseed torrent (de-infringed filenames) and adds it to the user's RD account,
// sourcing the bytes from TorBox or AllDebrid. Returns a duplicate marker instead
// when a transfer for this content already exists. sizeBytes (when known) lets
// the server keep big torrents off underpowered hosts.
export async function createDebridUploaderJob(
	params: CreateDebridJobParams
): Promise<DebridUploaderJob | DebridUploaderDuplicate> {
	const response = await fetch('/api/debrid-uploader/jobs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params),
	});
	return parseJsonResponse(response);
}

export type TransferOutcome =
	| 'started'
	| 'completed'
	| 'duplicate'
	| 'failed'
	| 'timeout'
	| 'error';

// A finished transfer lands in the RD account of whoever's key created the job,
// so joining somebody else's transfer only puts the content in *this* user's RD
// once the client adds the rewritten hash itself.
//
// `rdAdded` is the repeat-click guard; `adopted === false` marks a job this
// browser created, which the service already handed to this user's RD. An entry
// from before these flags existed can't be attributed, so it is handed over —
// delivering the content the user just asked for beats sparing them the
// duplicate RD entry that a second addMagnet creates.
export function needsRdHandoff(tracked: TrackedDebridUploaderJob | undefined): boolean {
	if (!tracked || tracked.rdAdded) return false;
	return tracked.adopted !== false;
}

// Adds a finished transfer's rewritten torrent to this user's RD account and
// records that it landed, so a later click (or the Transfers page) doesn't add
// a second copy.
export async function addTransferToRd(
	rdKey: string,
	infoHash: string,
	jobId?: string
): Promise<boolean> {
	try {
		const torrentId = await addHashAsMagnet(rdKey, infoHash, true);
		await selectFiles(rdKey, torrentId, ['all'], true);
		if (jobId) updateTrackedDebridUploaderJob(jobId, { rdAdded: true });
		return true;
	} catch (error) {
		console.error('Failed to add completed transfer to RD:', error);
		return false;
	}
}

/**
 * The transfer this browser already tracks for `hash`, when it is still worth
 * joining. Dedup is on the magnet alone — TB → RD and AD → RD on the same hash
 * produce the same content whichever provider ends up sourcing the bytes — so
 * which button was clicked never enters into it.
 *
 * Null means there is nothing to join (no entry, or the job failed or vanished
 * server-side), which lets a fresh submission through.
 */
export async function findJoinableTransfer(
	hash: string,
	context?: TransferContext
): Promise<{ tracked: TrackedDebridUploaderJob; job: DebridUploaderJob } | null> {
	const tracked = getTrackedDebridUploaderJobs().find(
		(j) => j.hash.toLowerCase() === hash.toLowerCase()
	);
	if (!tracked) return null;
	try {
		const job = await getDebridUploaderJob(tracked.id, context);
		return job.status === 'failed' ? null : { tracked, job };
	} catch {
		return null; // unknown to the service (e.g. wiped server-side) — allow a resubmit
	}
}

/**
 * Ends a transfer that has reached `completed`: hands the rewritten torrent to
 * this user's RD when that is still owed, and reports it on the caller's toast.
 * Shared by every send flow so a finished transfer settles the same way
 * wherever it was started.
 */
export async function settleCompletedTransfer(params: {
	rdKey: string;
	jobId: string;
	infoHash?: string | null;
	needsHandoff: boolean;
	label: string;
	toastId?: string;
}): Promise<TransferOutcome> {
	const { rdKey, jobId, infoHash, needsHandoff, label, toastId } = params;
	const options = { id: toastId, duration: TRANSFER_TOAST_MS };

	if (!needsHandoff) {
		toast.success(`${label}: done! It is in your Real-Debrid library.`, options);
		return 'completed';
	}
	if (!infoHash) {
		toast.error(
			`${label}: transfer finished but its torrent hash is missing — try again.`,
			options
		);
		return 'duplicate';
	}
	if (await addTransferToRd(rdKey, infoHash, jobId)) {
		toast.success(`${label}: added to your Real-Debrid library!`, options);
		return 'completed';
	}
	toast.error(`${label}: transfer finished but Real-Debrid rejected it — try again.`, options);
	return 'duplicate';
}

const POLL_MS = 5000;
const MAX_POLLS = 360; // 30 min for the source half; RD's pull isn't waited on

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FollowTransferParams {
	jobId: string;
	rdKey: string;
	/** Toast prefix naming the flow: `TB → RD`, `AD → RD`, `Send to RD`. */
	label: string;
	toastId?: string;
	/** Whether the finished torrent still has to be put into this user's RD. */
	rdHandoff: boolean;
	context?: TransferContext;
}

/**
 * Follows a running transfer to the point where it stops being the browser's
 * business, and reports it on the caller's toast. Shared by every send flow so
 * they cannot drift apart on either the wording or the point they let go.
 *
 * That point is `uploading` — RD pulling the bytes out of the webseed — which
 * is the last thing this browser can tell the user anything new about. Waiting
 * out RD's pull instead means a spinner held for minutes and, on a big release,
 * a "still not handed to RD after 30 min" error for a transfer that was handed
 * over fine.
 *
 * A joined transfer is the one case with unfinished business: it lands in the
 * RD account that created the job, and only the *completed* job carries the
 * rewritten hash needed to put it in this user's RD as well. That waits itself
 * out in the background, detached from both the toast and the caller — so the
 * row's button settles now and the content still arrives.
 */
export async function followTransferToRd(params: FollowTransferParams): Promise<TransferOutcome> {
	const { jobId, rdKey, label, toastId, rdHandoff, context } = params;

	for (let poll = 0; poll < MAX_POLLS; poll++) {
		await wait(POLL_MS);

		let polled;
		try {
			polled = await getDebridUploaderJob(jobId, context);
		} catch {
			continue; // transient poll failure; the job keeps running server-side
		}

		if (polled.status === 'completed') {
			return await settleCompletedTransfer({
				rdKey,
				jobId,
				infoHash: polled.info_hash,
				needsHandoff: rdHandoff,
				label,
				toastId,
			});
		}
		if (polled.status === 'failed') {
			toast.error(`${label} failed: ${polled.error || 'unknown error'}`, {
				id: toastId,
				duration: TRANSFER_TOAST_MS,
			});
			return 'failed';
		}
		if (polled.status === 'uploading') {
			toastRdUnderway(label, toastId);
			if (rdHandoff) void handOffWhenComplete(params, poll + 1);
			return 'started';
		}

		toast.loading(
			`${label}: ${polled.status_message || phaseLabelOf('debrid', polled.status)}`,
			{ id: toastId, duration: TRANSFER_STEP_TOAST_MS }
		);
	}

	toast.error(`${label}: still not handed to RD after 30 min — check the Transfers page.`, {
		id: toastId,
		duration: TRANSFER_TOAST_MS,
	});
	return 'timeout';
}

/**
 * The tail of a joined transfer, after its toast has already settled: poll on
 * in silence and put the rewritten torrent in this user's RD once the job
 * finishes. The Transfers page runs the same handoff for anyone who navigated
 * away; `rdAdded` is what stops the two from both adding it.
 */
async function handOffWhenComplete(params: FollowTransferParams, from: number): Promise<void> {
	const { jobId, rdKey, label, context } = params;

	for (let poll = from; poll < MAX_POLLS; poll++) {
		await wait(POLL_MS);

		let polled;
		try {
			polled = await getDebridUploaderJob(jobId, context);
		} catch {
			continue;
		}
		if (polled.status === 'failed') return;
		if (polled.status !== 'completed') continue;

		const tracked = getTrackedDebridUploaderJobs().find((j) => j.id === jobId);
		if (!needsRdHandoff(tracked)) return; // the Transfers page got there first
		// No toast id: the transfer's own toast said its piece at `uploading`, so
		// this arrives as its own note that the content has landed.
		await settleCompletedTransfer({
			rdKey,
			jobId,
			infoHash: polled.info_hash,
			needsHandoff: true,
			label,
		});
		return;
	}
}

// Self-contained "send this to RD" flow (submit → dedup → track → poll → toast),
// for callers without the search page's per-row state — currently the library
// page. It polls with no movie/tv context, so a manually-picked imdb never drives
// the global search-result registration; the content still lands in the user's RD
// and the transfer is tracked and deduped. Toasts are labelled "Send to RD".
export async function runDebridTransferToRd(params: {
	hash: string;
	imdbId: string;
	rdKey: string;
	tbKey?: string;
	sizeBytes?: number;
	title?: string;
	returnPath?: string;
}): Promise<TransferOutcome> {
	const { hash, imdbId, rdKey, tbKey, sizeBytes, title, returnPath } = params;
	const label = TRANSFER_LABELS.send;

	const toastId = toast.loading(`${label}: submitting transfer...`, {
		duration: TRANSFER_STEP_TOAST_MS,
	});
	try {
		let jobId: string;
		// Whether the finished torrent still has to be put into this user's RD.
		let rdHandoff: boolean;

		// One transfer per magnet: a second job for content a previous one already
		// delivered (or is still delivering) burns a source slot and a full
		// pipeline run for nothing. So an existing transfer is joined, never
		// resubmitted — and joining it still ends with the content in this user's
		// RD, which a bare "already transferred" toast never did.
		const joinable = await findJoinableTransfer(hash);
		if (joinable) {
			jobId = joinable.tracked.id;
			rdHandoff = needsRdHandoff(joinable.tracked);

			if (joinable.job.status === 'completed') {
				return await settleCompletedTransfer({
					rdKey,
					jobId,
					infoHash: joinable.job.info_hash,
					needsHandoff: rdHandoff,
					label,
					toastId,
				});
			}
			toast.loading(`${label}: transfer already in progress — waiting for completion...`, {
				id: toastId,
				duration: TRANSFER_STEP_TOAST_MS,
			});
		} else {
			const job = await createDebridUploaderJob({
				hash,
				imdbId,
				rdKey,
				tbKey,
				sizeBytes,
				title,
				returnPath,
			});

			if (isDuplicateResponse(job)) {
				jobId = job.jobId;
				rdHandoff = true;

				trackDebridUploaderJob({
					id: job.jobId,
					hash,
					imdbId,
					title,
					returnPath,
					createdAt: Date.now(),
					adopted: true,
				});

				if (job.duplicate === 'completed') {
					// The server adds a finished duplicate to the caller's RD itself;
					// retry from here when that leg failed.
					if (job.addedToRd) {
						updateTrackedDebridUploaderJob(job.jobId, { rdAdded: true });
					}
					return await settleCompletedTransfer({
						rdKey,
						jobId,
						infoHash: job.rewrittenHash,
						needsHandoff: !job.addedToRd,
						label,
						toastId,
					});
				}

				// in_progress: fall through to poll and add to RD on completion
				toast.loading(`${label}: transfer in progress — waiting for completion...`, {
					id: toastId,
					duration: TRANSFER_STEP_TOAST_MS,
				});
			} else {
				jobId = job.id;
				// Created with this user's RD key, so the service does the handoff.
				rdHandoff = false;

				trackDebridUploaderJob({
					id: job.id,
					hash,
					imdbId,
					title,
					returnPath,
					createdAt: Date.now(),
					adopted: false,
				});
				toast.loading(`${label}: transfer started — track it on the Transfers page.`, {
					id: toastId,
					duration: TRANSFER_STEP_TOAST_MS,
				});
			}
		}

		return await followTransferToRd({ jobId, rdKey, label, toastId, rdHandoff });
	} catch (error) {
		toast.error(`${label}: ${error instanceof Error ? error.message : 'failed to submit'}`, {
			id: toastId,
			duration: TRANSFER_TOAST_MS,
		});
		return 'error';
	}
}

// Marks any search-result rows whose original hash already has a completed
// transfer with `tbTransferred: true`, so the redundant "TB → RD" button hides.
export async function markTransferredHashes(
	hashes: string[],
	setSearchResults: (updater: (prev: any[]) => any[]) => void
): Promise<void> {
	if (hashes.length === 0) return;
	try {
		const response = await fetch('/api/debrid-uploader/registered', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ hashes }),
		});
		if (!response.ok) return;
		const data = await response.json();
		const transferred: Array<{ originalHash: string }> = data?.transferred ?? [];
		if (transferred.length === 0) return;
		const transferredSet = new Set(transferred.map((t) => t.originalHash.toLowerCase()));
		setSearchResults((prev) =>
			prev.map((r) =>
				transferredSet.has(r.hash.toLowerCase()) ? { ...r, tbTransferred: true } : r
			)
		);
	} catch {
		// best-effort — a missed suppression only shows a button that no-ops server-side
	}
}

// Re-exported from `./transferContext`, which owns them now: the server needs
// the same parser, and this module pulls in `react-hot-toast` at the top level.
export { transferContextFromPath, type TransferContext };

export async function getDebridUploaderJob(
	jobId: string,
	context?: TransferContext
): Promise<DebridUploaderJob> {
	const params = new URLSearchParams();
	if (context) {
		params.set('mediaType', context.mediaType);
		if (context.seasonNum !== undefined) params.set('seasonNum', `${context.seasonNum}`);
	}
	const query = params.size > 0 ? `?${params.toString()}` : '';
	const response = await fetch(`/api/debrid-uploader/jobs/${encodeURIComponent(jobId)}${query}`);
	return parseJsonResponse(response);
}

export async function deleteDebridUploaderJob(jobId: string): Promise<void> {
	const response = await fetch(`/api/debrid-uploader/jobs/${encodeURIComponent(jobId)}`, {
		method: 'DELETE',
	});
	await parseJsonResponse(response);
}

// The uploader service has no notion of users — its job list is global — so each
// browser remembers the jobs it created and the Transfers page polls only those.
export interface TrackedDebridUploaderJob {
	id: string;
	hash: string;
	imdbId: string;
	title?: string;
	// content page the transfer was started from, e.g. /movie/tt123 or /show/tt123/1
	returnPath?: string;
	createdAt: number;
	/**
	 * False when this browser created the job — the service was handed this
	 * user's RD key and delivers the result itself. True when it joined a
	 * transfer somebody else had already started, which the client has to add to
	 * this user's RD once it completes. Absent on entries tracked before the
	 * distinction existed; see `needsRdHandoff`.
	 */
	adopted?: boolean;
	/** Set once the finished torrent has been added to this user's RD account. */
	rdAdded?: boolean;
}

const TRACKED_JOBS_KEY = 'debridUploader:jobs';
const MAX_TRACKED_JOBS = 100;

export function getTrackedDebridUploaderJobs(): TrackedDebridUploaderJob[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(TRACKED_JOBS_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function trackDebridUploaderJob(job: TrackedDebridUploaderJob): void {
	if (typeof window === 'undefined') return;
	const jobs = [job, ...getTrackedDebridUploaderJobs().filter((j) => j.id !== job.id)].slice(
		0,
		MAX_TRACKED_JOBS
	);
	window.localStorage.setItem(TRACKED_JOBS_KEY, JSON.stringify(jobs));
}

// Patches a tracked entry in place, keeping its position in the Transfers list
// (unlike trackDebridUploaderJob, which moves the entry to the front).
export function updateTrackedDebridUploaderJob(
	jobId: string,
	patch: Partial<TrackedDebridUploaderJob>
): void {
	if (typeof window === 'undefined') return;
	const jobs = getTrackedDebridUploaderJobs();
	const index = jobs.findIndex((j) => j.id === jobId);
	if (index === -1) return;
	jobs[index] = { ...jobs[index], ...patch };
	window.localStorage.setItem(TRACKED_JOBS_KEY, JSON.stringify(jobs));
}

export function untrackDebridUploaderJob(jobId: string): void {
	if (typeof window === 'undefined') return;
	const jobs = getTrackedDebridUploaderJobs().filter((j) => j.id !== jobId);
	window.localStorage.setItem(TRACKED_JOBS_KEY, JSON.stringify(jobs));
}

export function isTerminalDebridUploaderStatus(status: DebridUploaderJobStatus): boolean {
	return status === 'completed' || status === 'failed';
}
