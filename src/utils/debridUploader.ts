import { toast } from 'react-hot-toast';

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
	// At least one source key. TorBox-held content uses tbKey; AllDebrid-held
	// uses adKey. The debrid service picks the source it finds the hash cached on.
	tbKey?: string;
	adKey?: string;
	sizeBytes?: number;
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
	adKey?: string;
	sizeBytes?: number;
	title?: string;
	returnPath?: string;
}): Promise<TransferOutcome> {
	const { hash, imdbId, rdKey, tbKey, adKey, sizeBytes, title, returnPath } = params;

	// One job per hash: skip if this browser already has a live/completed one.
	const previous = getTrackedDebridUploaderJobs().find((j) => j.hash === hash);
	if (previous) {
		let previousStatus: string | undefined;
		try {
			previousStatus = (await getDebridUploaderJob(previous.id)).status;
		} catch {
			// job unknown to the service — allow a resubmit
		}
		if (previousStatus && previousStatus !== 'failed') {
			toast(
				previousStatus === 'completed'
					? 'Send to RD: already transferred — check your RD library.'
					: 'Send to RD: transfer already in progress — see the Transfers page.'
			);
			return 'duplicate';
		}
	}

	const toastId = toast.loading('Send to RD: submitting transfer...');
	try {
		const job = await createDebridUploaderJob({ hash, imdbId, rdKey, tbKey, adKey, sizeBytes });

		if (isDuplicateResponse(job)) {
			toast(
				job.duplicate === 'completed'
					? 'Send to RD: already in RD — use the Instant RD result for this title.'
					: 'Send to RD: a transfer for this is already in progress.',
				{ id: toastId }
			);
			return 'duplicate';
		}

		trackDebridUploaderJob({
			id: job.id,
			hash,
			imdbId,
			title,
			returnPath,
			createdAt: Date.now(),
		});
		toast.loading('Send to RD: transfer started — track it on the Transfers page.', {
			id: toastId,
		});

		const POLL_MS = 5000;
		const MAX_POLLS = 360; // 30 min for the source half; RD's pull isn't waited on
		for (let i = 0; i < MAX_POLLS; i++) {
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));

			let polled;
			try {
				polled = await getDebridUploaderJob(job.id);
			} catch {
				continue; // transient poll failure; the job keeps running server-side
			}

			if (polled.status === 'completed') {
				toast.success('Send to RD: done! It is in your Real-Debrid library.', {
					id: toastId,
				});
				return 'completed';
			}
			if (polled.status === 'failed') {
				toast.error(`Send to RD failed: ${polled.error || 'unknown error'}`, {
					id: toastId,
				});
				return 'failed';
			}
			if (polled.status === 'uploading') {
				toast.success(
					'Send to RD: Real-Debrid download underway — follow it on the Transfers page.',
					{ id: toastId }
				);
				return 'started';
			}

			toast.loading(`Send to RD: ${polled.status_message || polled.status}`, {
				id: toastId,
			});
		}

		toast.error('Send to RD: still not handed to RD after 30 min — check the Transfers page.', {
			id: toastId,
		});
		return 'timeout';
	} catch (error) {
		toast.error(`Send to RD: ${error instanceof Error ? error.message : 'failed to submit'}`, {
			id: toastId,
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

// Movie-vs-show context for a transfer, derived from the page it started on.
// Sent along with status polls so the server knows where to file the completed
// torrent (movie:<imdb> vs tv:<imdb>:<season>) when it registers it in DMM.
export interface TransferContext {
	mediaType: 'movie' | 'tv';
	seasonNum?: number;
}

export function transferContextFromPath(path: string | undefined): TransferContext | undefined {
	if (!path) return undefined;
	const show = path.match(/^\/show\/tt\d+\/(\d+)/);
	if (show) return { mediaType: 'tv', seasonNum: parseInt(show[1], 10) };
	if (/^\/movie\/tt\d+/.test(path)) return { mediaType: 'movie' };
	return undefined;
}

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

export function untrackDebridUploaderJob(jobId: string): void {
	if (typeof window === 'undefined') return;
	const jobs = getTrackedDebridUploaderJobs().filter((j) => j.id !== jobId);
	window.localStorage.setItem(TRACKED_JOBS_KEY, JSON.stringify(jobs));
}

export function isTerminalDebridUploaderStatus(status: DebridUploaderJobStatus): boolean {
	return status === 'completed' || status === 'failed';
}
