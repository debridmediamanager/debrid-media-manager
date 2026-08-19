import { DatabaseClient } from './client';

/**
 * What DMM knows about a transfer that the service running it does not.
 *
 * `debrid` and `nzb2rd` each store a job's own state — status, progress, release
 * name, RD account — and nothing about the page it was started from. The
 * Transfers page needs that page: the DMM title to show instead of a raw release
 * name, and the `/movie/tt…` or `/show/tt…/N` link back to the content. It also
 * decides where a completed torrent gets filed when it is registered into DMM's
 * search index, which is what makes one user's transfer findable by everyone.
 *
 * That context used to live in the browser's `localStorage`, alongside the list
 * of transfers itself. Moving the list server-side (`GET /api/transfers`) left
 * it homeless — and localStorage was always the wrong home for it, since a
 * transfer started on a phone had no context on a laptop.
 *
 * Keyed by **job id**, because that is the only handle every path shares: the
 * existing `tbrd:`/`nzbrd:` records are keyed by content (original hash and
 * indexer release id) and cannot be looked up from a job the service names.
 *
 * Stored in the generic `Cache` KV table under an `xfer:` prefix, mirroring how
 * `DebridUploaderMapService` and `Nzb2rdMapService` store theirs — no migration,
 * and the shared DB already carries that table.
 *
 * A record is best-effort throughout. A transfer submitted through some other
 * client — an *arr pushing into nzb2rd's SABnzbd API, the Discord `rd-uploader`
 * — has none, and still belongs on the page: it just shows the service's own
 * release name with no link.
 */
export type TransferMetaSource = 'debrid' | 'nzb2rd';

export interface TransferMetaRecord {
	source: TransferMetaSource;
	jobId: string;
	imdbId?: string;
	/** The DMM title, which reads better than the release name the service holds. */
	title?: string;
	/** The content page the transfer was started from, e.g. `/movie/tt123`. */
	returnPath?: string;
	/** nzb2rd only: the indexer release id, needed by its polls and cancels. */
	releaseId?: string;
	updatedAt: number;
}

const KEY_PREFIX = 'xfer:';
const keyFor = (source: TransferMetaSource, jobId: string) => `${KEY_PREFIX}${source}:${jobId}`;

export class TransferMetaService extends DatabaseClient {
	async record(meta: Omit<TransferMetaRecord, 'updatedAt'>): Promise<void> {
		const value = { ...meta, updatedAt: Date.now() } as unknown as object;
		await this.prisma.cache.upsert({
			where: { key: keyFor(meta.source, meta.jobId) },
			update: { value } as any,
			create: { key: keyFor(meta.source, meta.jobId), value } as any,
		});
	}

	/**
	 * The context for a page of transfers, in one query.
	 *
	 * Batched rather than per-row: the Transfers page polls every 5 seconds and a
	 * page holds up to a hundred rows, so a lookup each would turn one request
	 * into a hundred round trips to MySQL every tick.
	 *
	 * Returned as a Map keyed `<source>:<jobId>` rather than by job id alone —
	 * the two services generate ids independently and nothing stops them
	 * colliding, so keying on the id alone would let one service's context be
	 * attached to the other's transfer.
	 */
	async getMany(
		jobs: { source: TransferMetaSource; jobId: string }[]
	): Promise<Map<string, TransferMetaRecord>> {
		if (jobs.length === 0) return new Map();
		const rows = await this.prisma.cache.findMany({
			where: { key: { in: jobs.map((j) => keyFor(j.source, j.jobId)) } },
		});
		const byJob = new Map<string, TransferMetaRecord>();
		for (const row of rows) {
			const meta = row.value as unknown as TransferMetaRecord;
			if (meta?.source && meta?.jobId) byJob.set(`${meta.source}:${meta.jobId}`, meta);
		}
		return byJob;
	}
}
