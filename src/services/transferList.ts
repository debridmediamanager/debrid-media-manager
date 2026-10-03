import type { TransferMetaRecord } from '@/services/database';
import { originalHashFromInput } from '@/services/debridUploaderRegistration';
import { getDebridUploaderServers } from '@/services/debridUploaderServers';
import { getNzb2rdUrl } from '@/services/nzb2rd';
import type { TransferRow } from '@/utils/transfers';
import { createHash } from 'crypto';

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
		// Only the hash out of `input`, never the input itself: it is what a
		// Retry on a failed row resubmits, and the uploader takes the bare hash.
		hash: originalHashFromInput(job.input),
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
 * Where the next page starts: how far into each service's own newest-first list
 * the pages so far have read.
 *
 * Paging the merged list by a single offset meant asking every service for
 * `offset + limit` rows and slicing after the merge, because rows 200-300 of
 * the merged list are not rows 200-300 of each service. Each page then cost
 * more than the one before, and the services' own 500-row cap ended the list
 * outright: on 2026-10-03 one account held 648 nzb2rd jobs, and everything past
 * the 500th was unreachable. Carrying a read position per service instead
 * makes every page one bounded read from each, at any depth.
 *
 * A position is an offset into the service's list, so it is exact at the
 * moment the page is turned and drifts as that list changes. A transfer
 * started meanwhile pushes everything down one place, and the next page repeats
 * a row of the one before it rather than skipping one. The Transfers page
 * always turns from the cursor its latest refresh returned, so the page it
 * shows and the page it turns to stay adjacent.
 */
export type TransferCursor = Record<string, number>;

/**
 * A service's name in a cursor.
 *
 * Not its URL: the cursor travels in a query string, which every proxy in
 * front of DMM logs. A hash of the URL stays the same across restarts and
 * across the four DMM instances, which an index into the configured list would
 * not if a host were added or removed.
 */
export function sourceIdOf(url: string): string {
	return `debrid-${createHash('sha256').update(url).digest('hex').slice(0, 8)}`;
}

const NZB2RD_SOURCE_ID = 'nzb2rd';
const CURSOR_PART = /^([a-z0-9-]{1,40})\.(\d{1,15})$/;

/** `nzb2rd.300_debrid-1a2b3c4d.12`: URL-safe without escaping, and readable in a log line. */
export function encodeCursor(cursor: TransferCursor): string {
	return Object.entries(cursor)
		.map(([id, position]) => `${id}.${position}`)
		.join('_');
}

/** The cursor `encodeCursor` wrote, or null for anything else. */
export function decodeCursor(raw: string): TransferCursor | null {
	if (!raw || raw.length > 1000) return null;
	const cursor: TransferCursor = {};
	for (const part of raw.split('_')) {
		const match = CURSOR_PART.exec(part);
		if (!match) return null;
		const position = Number(match[2]);
		if (!Number.isSafeInteger(position)) return null;
		cursor[match[1]] = position;
	}
	return cursor;
}

/**
 * One window per service, merged newest first, `limit` rows at most.
 *
 * A k-way merge rather than a sort of the concatenation, because the cursor
 * depends on what it guarantees: whatever is taken from a service is a prefix
 * of that service's window, so its position can simply advance by the count.
 * A tie goes to the service listed first, which keeps the order the same from
 * one refresh to the next.
 */
export function mergePage(
	windows: TransferRow[][],
	limit: number
): { rows: TransferRow[]; taken: number[] } {
	const taken = windows.map(() => 0);
	const rows: TransferRow[] = [];
	while (rows.length < limit) {
		let pick = -1;
		for (let i = 0; i < windows.length; i++) {
			const head = windows[i][taken[i]];
			if (!head) continue;
			if (pick === -1 || head.createdAt > windows[pick][taken[pick]].createdAt) pick = i;
		}
		if (pick === -1) break;
		rows.push(windows[pick][taken[pick]]);
		taken[pick]++;
	}
	return { rows, taken };
}

type SourceResult = {
	rows: TransferRow[];
	/** Each usable row's index in what the service sent, which is what an offset counts. */
	at: number[];
	/** How many entries the service sent, usable or not. */
	received: number;
	raw: [string, any][];
	degraded?: string;
};

async function fetchSource(
	url: string,
	rdKey: string,
	take: number,
	offset: number,
	map: (job: any) => TransferRow,
	label: string
): Promise<SourceResult> {
	const failed = { rows: [], at: [], received: 0, raw: [], degraded: label };
	try {
		const response = await fetch(`${url}/jobs/mine?limit=${take}&offset=${offset}`, {
			headers: { Accept: 'application/json', [RD_KEY_HEADER]: rdKey },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) {
			console.error(`Transfer listing from ${label} answered ${response.status}`);
			return failed;
		}
		const data = await response.json();
		if (!Array.isArray(data)) return failed;
		const at: number[] = [];
		const usable: any[] = [];
		data.forEach((job, i) => {
			if (!job?.id || !job?.status) return;
			at.push(i);
			usable.push(job);
		});
		const rows = usable.map(map);
		return {
			rows,
			at,
			received: data.length,
			raw: rows.map((row, i) => [keyOf(row), usable[i]] as [string, any]),
		};
	} catch (error) {
		console.error(`Transfer listing from ${label} failed:`, error);
		return failed;
	}
}

/**
 * One page of the transfers on the account behind `rdKey`, from every
 * configured service, newest first, with the cursor of the page after it.
 *
 * Each service is asked for `limit + 1` rows at its own position. That is only
 * a page's worth because both services serve up to 500 rows a request; were
 * either to cap below what is asked, its rows past the cap would be passed over
 * as though its list had ended.
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
	cursor?: TransferCursor
): Promise<{
	transfers: TransferRow[];
	raw: Map<string, any>;
	degraded: string[];
	next: string | null;
}> {
	const sources = [
		...getDebridUploaderServers().map((server) => ({
			id: sourceIdOf(server),
			url: server,
			map: debridRowOf,
			label: server,
		})),
		{ id: NZB2RD_SOURCE_ID, url: getNzb2rdUrl(), map: nzb2rdRowOf, label: 'nzb2rd' },
	];
	const from = sources.map((s) => cursor?.[s.id] ?? 0);

	// One row past the page, so a page that ends exactly where a service's list
	// does is known to be the last instead of linking to an empty one.
	const results = await Promise.all(
		sources.map((s, i) => fetchSource(s.url, rdKey, limit + 1, from[i], s.map, s.label))
	);
	const { rows, taken } = mergePage(
		results.map((r) => r.rows),
		limit
	);

	// A position counts what the service sent, so a row skipped here as
	// malformed still moves it on. A service that did not answer stays where it
	// was, and its rows come back on a later page rather than being stepped over.
	const read = results.map((r, i) => (taken[i] > 0 ? r.at[taken[i] - 1] + 1 : 0));
	const more = results.some((r, i) => r.received > read[i]);
	const next = more
		? encodeCursor(Object.fromEntries(sources.map((s, i) => [s.id, from[i] + read[i]])))
		: null;

	return {
		transfers: rows,
		// The service's own job object, kept beside the flattened row rather than
		// on it. Registering a completed transfer needs fields the UI never shows
		// — `input`, `files`, `completed_at` — and putting them on the row would
		// serve every one of them to the browser for no reason.
		raw: new Map(results.flatMap((r) => r.raw)),
		degraded: results.flatMap((r) => (r.degraded ? [r.degraded] : [])),
		next,
	};
}
