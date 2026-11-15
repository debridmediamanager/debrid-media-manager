import type { PutioTransferStatus } from '@/services/putio';
import { UserTorrentStatus } from '@/torrent/userTorrent';

/**
 * put.io library rows.
 *
 * A row is one transfer, `pt:<transferId>`, because only transfers carry an info
 * hash. The prefix is three characters like `rd:` and `oc:`: several places slice
 * row ids with `substring(0, 3)`.
 *
 * ponytail: files with no transfer (uploaded, or whose transfer was cleared on
 * put.io) are not listed at all. Listing them means joining `/files/list` into
 * the library the way Premiumize's rows do; do that once real captures exist.
 */
export const PT_ID_PREFIX = 'pt:';

export const toPutioRowId = (transferId: number): string => `${PT_ID_PREFIX}${transferId}`;

/** The transfer id inside a row id, or null: a destructive call never gets a guess. */
export const parsePutioRowId = (rowId: string): number | null => {
	if (!rowId.startsWith(PT_ID_PREFIX)) return null;
	const rest = rowId.slice(PT_ID_PREFIX.length);
	return /^[1-9]\d*$/.test(rest) ? Number(rest) : null;
};

/**
 * Every status in the SDK's `TransferStatusSchema`, as a library status and a
 * label. Read from the SDK's names, not from captures: no real transfer has been
 * seen yet. STOPPING is taken as stopping a finished transfer's seeding, so it
 * counts as finished like SEEDING and PREPARING_SEED.
 */
const PT_STATUS: Record<PutioTransferStatus, [UserTorrentStatus, string]> = {
	WAITING: [UserTorrentStatus.waiting, 'Waiting'],
	PREPARING_DOWNLOAD: [UserTorrentStatus.waiting, 'Preparing'],
	IN_QUEUE: [UserTorrentStatus.waiting, 'Queued'],
	WAITING_FOR_DOWNLOADER: [UserTorrentStatus.waiting, 'Waiting for a downloader'],
	DOWNLOADING: [UserTorrentStatus.downloading, 'Downloading'],
	WAITING_FOR_COMPLETE_QUEUE: [UserTorrentStatus.downloading, 'Finishing'],
	COMPLETING: [UserTorrentStatus.downloading, 'Completing'],
	STOPPING: [UserTorrentStatus.finished, 'Stopping'],
	SEEDING: [UserTorrentStatus.finished, 'Seeding'],
	PREPARING_SEED: [UserTorrentStatus.finished, 'Preparing to seed'],
	COMPLETED: [UserTorrentStatus.finished, 'Finished'],
	ERROR: [UserTorrentStatus.error, 'Error'],
};

const lookup = (status: string | null | undefined) =>
	Object.hasOwn(PT_STATUS, status ?? '') ? PT_STATUS[status as PutioTransferStatus] : null;

/** A status put.io adds later shows as itself and counts as an error until mapped. */
export const getPutioStatusText = (status: string | null | undefined): string =>
	lookup(status)?.[1] ?? (status || 'Unknown');

export const getPutioUserTorrentStatus = (
	status: string | null | undefined,
	percentDone: number | null | undefined
): [UserTorrentStatus, number] => {
	const mapped = lookup(status)?.[0] ?? UserTorrentStatus.error;
	if (mapped === UserTorrentStatus.finished) return [mapped, 100];
	const progress = typeof percentDone === 'number' ? Math.max(0, Math.min(100, percentDone)) : 0;
	return [mapped, progress];
};

/**
 * put.io writes times without a zone (`2026-11-09T11:00:00`, recorded on the root
 * folder), which `new Date` would read as local time. They are taken as UTC.
 */
export const parsePutioDate = (value: string | null | undefined): Date | null => {
	if (!value) return null;
	const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
	return Number.isNaN(date.getTime()) ? null : date;
};
