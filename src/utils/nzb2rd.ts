import { TransferContext } from './debridUploader';

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

export async function createNzb2rdJob(params: {
	id: string;
	title: string;
	imdbId: string;
	rdKey: string;
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

export async function deleteNzb2rdJob(jobId: string, releaseId?: string): Promise<void> {
	const response = await fetch(
		`/api/nzb2rd/jobs/${encodeURIComponent(jobId)}${jobQuery(undefined, releaseId)}`,
		{ method: 'DELETE' }
	);
	await parseJsonResponse(response);
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
