import { isTerminalDebridUploaderStatus, TrackedDebridUploaderJob } from './debridUploader';
import { getTrackedNzb2rdJobs, isTerminalNzb2rdStatus } from './nzb2rd';
import type { QueuePlace, TransferSource } from './transferPhase';

// Both transfer kinds land content in Real-Debrid and are followed the same way,
// so they share one list. They differ only in where the bytes come from (a
// TorBox/AllDebrid cache vs Usenet) and which service owns the job.
//
// The source enums are translated into one user-facing vocabulary in
// `transferPhase.ts`, which is where the two services' stage names are lined up.
export type { TransferSource };

// Where a transfer's bytes actually came from. A `debrid` job is not one origin
// but two — it takes whichever of TorBox and AllDebrid holds the release, and
// the caller supplies both keys — so labelling every such row "TB → RD" was
// wrong for every AllDebrid-served transfer. The service records the choice on
// the job row (`source`) once it registers the proxy session; until then the
// answer genuinely is not known yet.
export type TransferOrigin = 'torbox' | 'alldebrid' | 'qbit' | 'cache' | 'usenet';

export const ORIGIN_LABELS: Record<TransferOrigin, string> = {
	torbox: 'TorBox',
	alldebrid: 'AllDebrid',
	// The qBittorrent swarm route, off in production (`QBIT_ENABLED`).
	qbit: 'Torrent',
	/** A TB/AD job that has not yet settled on one. */
	cache: 'Cache',
	usenet: 'Usenet',
};

export const ORIGIN_STYLES: Record<TransferOrigin, string> = {
	torbox: 'border-indigo-500 bg-indigo-900/30 text-indigo-100',
	alldebrid: 'border-sky-500 bg-sky-900/30 text-sky-100',
	qbit: 'border-teal-500 bg-teal-900/30 text-teal-100',
	cache: 'border-slate-500 bg-slate-900/30 text-slate-100',
	usenet: 'border-amber-500 bg-amber-900/30 text-amber-100',
};

/**
 * Which provider a row should name. Usenet is settled by the service that owns
 * the job; a debrid job has to be asked, and answers null until it picks.
 */
export function originOf(source: TransferSource, jobSource?: string | null): TransferOrigin {
	if (source === 'nzb2rd') return 'usenet';
	if (jobSource === 'torbox' || jobSource === 'alldebrid' || jobSource === 'qbit') {
		return jobSource;
	}
	return 'cache';
}

/**
 * One row as `GET /api/transfers` returns it: a job's own state from whichever
 * service runs it, flattened together with the page context DMM stored when the
 * transfer was started.
 *
 * Flat rather than `{entry, job}` because the two halves used to come from two
 * places — a localStorage entry and a per-job poll — and nothing downstream ever
 * cared which was which. `describeTransfer` reads the progress fields straight
 * off this shape.
 *
 * Everything below `status` is optional because a transfer submitted outside DMM
 * — an *arr pushing into nzb2rd's SABnzbd API, or the Discord `rd-uploader` —
 * has no stored context, and still belongs on the page.
 */
export interface TransferRow {
	source: TransferSource;
	id: string;
	status: string;
	/** Epoch ms, parsed from the service's UTC `created_at`. */
	createdAt: number;

	name?: string | null;
	status_message?: string | null;
	error?: string | null;
	info_hash?: string | null;
	total_bytes?: number | null;
	done_bytes?: number | null;
	queue?: QueuePlace | null;
	/** `debrid` only: which cached provider served it — torbox, alldebrid, qbit. */
	jobSource?: string | null;

	/** From DMM's own record of where the transfer was started. */
	imdbId?: string;
	title?: string;
	returnPath?: string;
	/** nzb2rd only: the indexer release id, needed by a cancel. */
	releaseId?: string;
}

/** What `GET /api/transfers` answers with. */
export interface TransfersResponse {
	transfers: TransferRow[];
	/**
	 * Services that did not answer. Surfaced rather than swallowed: a dead host
	 * would otherwise just shorten the list, which reads as "that transfer is
	 * gone" — the single most alarming thing this page can say by accident.
	 */
	degraded: string[];
}

/** One row of the list, whichever service produced it. */
export interface TransferEntry {
	source: TransferSource;
	id: string;
	imdbId: string;
	title?: string;
	returnPath?: string;
	createdAt: number;
	/** Usenet only: the indexer release id, needed by polls and cancels. */
	releaseId?: string;
}

export function toEntries(
	debrid: TrackedDebridUploaderJob[],
	usenet: ReturnType<typeof getTrackedNzb2rdJobs>
): TransferEntry[] {
	return [
		...debrid.map((j) => ({
			source: 'debrid' as const,
			id: j.id,
			imdbId: j.imdbId,
			title: j.title,
			returnPath: j.returnPath,
			createdAt: j.createdAt,
		})),
		...usenet.map((j) => ({
			source: 'nzb2rd' as const,
			id: j.id,
			imdbId: j.imdbId,
			title: j.title,
			returnPath: j.returnPath,
			createdAt: j.createdAt,
			releaseId: j.releaseId,
		})),
	].sort((a, b) => b.createdAt - a.createdAt);
}

export function isTerminal(source: TransferSource, status: string): boolean {
	return source === 'nzb2rd'
		? isTerminalNzb2rdStatus(status as any)
		: isTerminalDebridUploaderStatus(status as any);
}
