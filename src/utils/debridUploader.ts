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

// Submits a TorBox-cached hash to the debrid uploader service, which rebuilds it
// as a webseed torrent (de-infringed filenames) and adds it to the user's RD account.
// Returns a duplicate marker instead when a transfer for this content already exists.
// sizeBytes (when known) lets the server keep big torrents off underpowered hosts.
export async function createDebridUploaderJob(
	hash: string,
	imdbId: string,
	rdKey: string,
	tbKey: string,
	sizeBytes?: number
): Promise<DebridUploaderJob | DebridUploaderDuplicate> {
	const response = await fetch('/api/debrid-uploader/jobs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ hash, imdbId, rdKey, tbKey, sizeBytes }),
	});
	return parseJsonResponse(response);
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
