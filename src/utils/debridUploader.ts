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

// Submits a TorBox-cached hash to the debrid uploader service, which rebuilds it
// as a webseed torrent (de-infringed filenames) and adds it to the user's RD account.
export async function createDebridUploaderJob(
	hash: string,
	imdbId: string,
	rdKey: string,
	tbKey: string
): Promise<DebridUploaderJob> {
	const response = await fetch('/api/debrid-uploader/jobs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ hash, imdbId, rdKey, tbKey }),
	});
	return parseJsonResponse(response);
}

export async function getDebridUploaderJob(jobId: string): Promise<DebridUploaderJob> {
	const response = await fetch(`/api/debrid-uploader/jobs/${encodeURIComponent(jobId)}`);
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
