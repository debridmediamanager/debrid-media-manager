import type { TransferMetaRecord } from '@/services/database';
import { getDebridUploaderServers } from '@/services/debridUploaderServers';
import { getNzb2rdUrl } from '@/services/nzb2rd';
import type { TransferRow } from '@/utils/transfers';

/**
 * Gathering every transfer on one Real-Debrid account into a single list.
 *
 * The Transfers page used to build its list from `localStorage` and then poll
 * one endpoint per tracked job — so transfers were invisible on any other
 * device, lost with the browser's site data, and cost N requests per 5s tick.
 * Both uploader services already record the RD account on every job (for their
 * per-user limits), so the identity to key on existed; what was missing was an
 * owner-scoped listing and something to merge them.
 *
 * The browser makes one request. This fans out server-side to every configured
 * debrid uploader host plus nzb2rd, in parallel, and merges what comes back.
 */

/** How the caller's key reaches the services, and why it is never a query param. */
export const RD_KEY_HEADER = 'x-rd-api-key';

/**
 * Per-source ceiling on how much is asked for.
 *
 * Both services cap a page at 500 of their own accord, so this is the same
 * number restated rather than an independent limit — asking for more just gets
 * silently clamped there.
 */
export const MAX_SOURCE_ROWS = 500;

const FETCH_TIMEOUT_MS = 15000;

/**
 * A service's `created_at` as epoch ms.
 *
 * Both services store SQLite `datetime('now')`, which is UTC with no zone
 * marker — so it must be parsed with an explicit `Z`. Without one, Node reads it
 * as *local* time and every timestamp shifts by the host's offset, which on a
 * UTC+2 server dates a transfer two hours in the future. The services' own
 * `withDuration` appends the same `Z` for the same reason.
 */
export function parseServiceTime(raw: unknown): number {
	if (typeof raw !== 'string' || !raw) return 0;
	const parsed = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.trim()}Z`);
	return Number.isFinite(parsed) ? parsed : 0;
}

/** How a row is addressed across both services, whose ids are generated independently. */
export function keyOf(row: Pick<TransferRow, 'source' | 'id'>): string {
	return `${row.source}:${row.id}`;
}

/** A `debrid` job row as that service serves it, flattened into the shared shape. */
export function debridRowOf(job: any): TransferRow {
	return {
		source: 'debrid',
		id: job.id,
		status: job.status,
		createdAt: parseServiceTime(job.created_at),
		name: job.name ?? null,
		status_message: job.status_message ?? null,
		error: job.error ?? null,
		info_hash: job.info_hash ?? null,
		queue: job.queue ?? null,
		// Renamed on the way through: the service calls it `source`, which on this
		// shape already means "which service ran the job". Two different questions
		// sharing one field name is how a TorBox transfer ends up labelled Usenet.
		jobSource: job.source ?? null,
		imdbId: typeof job.imdb_id === 'string' ? job.imdb_id : undefined,
	};
}

/** An `nzb2rd` job row, likewise. */
export function nzb2rdRowOf(job: any): TransferRow {
	return {
		source: 'nzb2rd',
		id: job.id,
		status: job.status,
		createdAt: parseServiceTime(job.created_at),
		name: job.name ?? job.nzb_name ?? null,
		status_message: job.status_message ?? null,
		error: job.error ?? null,
		info_hash: job.info_hash ?? null,
		total_bytes: job.total_bytes ?? null,
		done_bytes: job.done_bytes ?? null,
		queue: job.queue ?? null,
		imdbId: typeof job.imdb_id === 'string' ? job.imdb_id : undefined,
	};
}

/** Overlay DMM's stored page context onto a row, where there is any. */
export function withMeta(row: TransferRow, meta: TransferMetaRecord | undefined): TransferRow {
	if (!meta) return row;
	return {
		...row,
		// The DMM title reads better than a release name, but a row with no stored
		// title must keep the service's name rather than losing its label.
		title: meta.title ?? row.title,
		returnPath: meta.returnPath ?? row.returnPath,
		releaseId: meta.releaseId ?? row.releaseId,
		imdbId: row.imdbId ?? meta.imdbId,
	};
}

/**
 * Merge every source's rows into one page, newest first.
 *
 * Each source is asked for `offset + limit` and the slice happens here, because
 * a global ordering cannot be paged per-source: taking rows 20-40 from each
 * service and concatenating them is not rows 20-40 of the merged list.
 */
export function mergeRows(rows: TransferRow[], limit: number, offset: number): TransferRow[] {
	return [...rows].sort((a, b) => b.createdAt - a.createdAt).slice(offset, offset + limit);
}

type SourceResult = { rows: TransferRow[]; raw: [string, any][]; degraded?: string };

async function fetchSource(
	url: string,
	rdKey: string,
	take: number,
	map: (job: any) => TransferRow,
	label: string
): Promise<SourceResult> {
	try {
		const response = await fetch(`${url}/jobs/mine?limit=${take}`, {
			headers: { Accept: 'application/json', [RD_KEY_HEADER]: rdKey },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) {
			console.error(`Transfer listing from ${label} answered ${response.status}`);
			return { rows: [], raw: [], degraded: label };
		}
		const data = await response.json();
		if (!Array.isArray(data)) return { rows: [], raw: [], degraded: label };
		const usable = data.filter((job) => job?.id && job?.status);
		const rows = usable.map(map);
		return { rows, raw: rows.map((row, i) => [keyOf(row), usable[i]] as [string, any]) };
	} catch (error) {
		console.error(`Transfer listing from ${label} failed:`, error);
		return { rows: [], raw: [], degraded: label };
	}
}

/**
 * Every transfer on the account behind `rdKey`, from every configured service.
 *
 * The key is forwarded, never interpreted: each service resolves it to an RD
 * account id itself and filters on that. DMM deliberately does not resolve it —
 * an account id passed as a parameter would be an enumeration oracle, since RD
 * ids are small integers and nzb2rd's REST surface is publicly reachable.
 *
 * A source that fails is named in `degraded` rather than dropped silently. The
 * per-job page it replaces showed "Status unavailable" on the affected row, and
 * losing that signal would make an unreachable host look like a vanished
 * transfer.
 */
export async function listTransfers(
	rdKey: string,
	limit: number,
	offset: number
): Promise<{ transfers: TransferRow[]; raw: Map<string, any>; degraded: string[] }> {
	const take = Math.min(offset + limit, MAX_SOURCE_ROWS);
	const sources = [
		...getDebridUploaderServers().map((server) => ({
			url: server,
			map: debridRowOf,
			label: server,
		})),
		{ url: getNzb2rdUrl(), map: nzb2rdRowOf, label: 'nzb2rd' },
	];

	const results = await Promise.all(
		sources.map((s) => fetchSource(s.url, rdKey, take, s.map, s.label))
	);

	return {
		transfers: mergeRows(
			results.flatMap((r) => r.rows),
			limit,
			offset
		),
		// The service's own job object, kept beside the flattened row rather than
		// on it. Registering a completed transfer needs fields the UI never shows
		// — `input`, `files`, `completed_at` — and putting them on the row would
		// serve every one of them to the browser for no reason.
		raw: new Map(results.flatMap((r) => r.raw)),
		degraded: results.flatMap((r) => (r.degraded ? [r.degraded] : [])),
	};
}
