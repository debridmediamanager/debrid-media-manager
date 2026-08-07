import { isTerminalDebridUploaderStatus, TrackedDebridUploaderJob } from './debridUploader';
import { getTrackedNzb2rdJobs, isTerminalNzb2rdStatus } from './nzb2rd';

// Both transfer kinds land content in Real-Debrid and are followed the same way,
// so they share one list. They differ only in where the bytes come from (a
// TorBox/AllDebrid cache vs Usenet) and which service owns the job.
export type TransferSource = 'debrid' | 'nzb2rd';

export const SOURCE_LABELS: Record<TransferSource, string> = {
	debrid: 'TB → RD',
	nzb2rd: 'Usenet',
};

export const SOURCE_STYLES: Record<TransferSource, string> = {
	debrid: 'border-indigo-500 bg-indigo-900/30 text-indigo-100',
	nzb2rd: 'border-amber-500 bg-amber-900/30 text-amber-100',
};

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
