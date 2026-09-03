import { DatabaseClient } from './client';

/**
 * A TB → RD transfer produces a torrent in Real-Debrid under a *rewritten* info
 * hash (de-infringed filenames + a per-attempt salt), so the original torrent
 * hash the search result carries is never itself RD-cached. This maps that
 * original hash to the transfer, so any user (not just the browser that started
 * it) can tell a completed/in-flight transfer already exists and use the
 * registered RD result instead of running a redundant job.
 *
 * Stored in the generic `Cache` KV table under a `tbrd:` prefix — no migration,
 * and the shared DB already carries that table.
 */
export type TransferStatus = 'pending' | 'completed';

export interface DebridTransferRecord {
	originalHash: string;
	jobId: string;
	imdbId: string;
	status: TransferStatus;
	rewrittenHash?: string;
	updatedAt: number;
}

const KEY_PREFIX = 'tbrd:';
const keyFor = (originalHash: string) => `${KEY_PREFIX}${originalHash.toLowerCase()}`;

/**
 * How many `tbrd:` rows the pending scan reads before giving up on finding more.
 *
 * Oldest-first, so `pending` rows — whose `updatedAt` is never bumped again —
 * sort ahead of every `completed` one, and the cap is only ever reached by a
 * backlog far larger than the 1.8k rows this table holds.
 */
const PENDING_SCAN_CAP = 3000;

// A job lives on exactly one server (the one that created it), keyed by job id.
const JOB_KEY_PREFIX = 'tbjob:';
const jobKeyFor = (jobId: string) => `${JOB_KEY_PREFIX}${jobId}`;

export class DebridUploaderMapService extends DatabaseClient {
	async getTransfer(originalHash: string): Promise<DebridTransferRecord | null> {
		const row = await this.prisma.cache.findUnique({ where: { key: keyFor(originalHash) } });
		return row ? (row.value as unknown as DebridTransferRecord) : null;
	}

	async getTransfers(originalHashes: string[]): Promise<DebridTransferRecord[]> {
		if (originalHashes.length === 0) return [];
		const rows = await this.prisma.cache.findMany({
			where: { key: { in: originalHashes.map(keyFor) } },
		});
		return rows.map((r) => r.value as unknown as DebridTransferRecord);
	}

	private async put(record: DebridTransferRecord): Promise<void> {
		const value = { ...record, updatedAt: Date.now() } as unknown as object;
		await this.prisma.cache.upsert({
			where: { key: keyFor(record.originalHash) },
			update: { value } as any,
			create: { key: keyFor(record.originalHash), value } as any,
		});
	}

	async recordPending(originalHash: string, jobId: string, imdbId: string): Promise<void> {
		// Never downgrade a completed mapping back to pending.
		const existing = await this.getTransfer(originalHash);
		if (existing?.status === 'completed') return;
		await this.put({
			originalHash: originalHash.toLowerCase(),
			jobId,
			imdbId,
			status: 'pending',
			updatedAt: Date.now(),
		});
	}

	async recordCompleted(
		originalHash: string,
		jobId: string,
		imdbId: string,
		rewrittenHash: string
	): Promise<void> {
		await this.put({
			originalHash: originalHash.toLowerCase(),
			jobId,
			imdbId,
			status: 'completed',
			rewrittenHash: rewrittenHash.toLowerCase(),
			updatedAt: Date.now(),
		});
	}

	/**
	 * The oldest mappings still marked `pending`, for the reconciliation sweep.
	 *
	 * Filters the status in JS off a prefix scan rather than with a JSON path
	 * predicate. Nothing else in this codebase filters on a JSON column, the
	 * whole prefix is a couple of thousand small rows, and this runs inside a
	 * cron that must not throw — a dialect mismatch there would be silent.
	 */
	async listPending(limit: number): Promise<DebridTransferRecord[]> {
		if (limit <= 0) return [];
		const rows = await this.prisma.cache.findMany({
			where: { key: { startsWith: KEY_PREFIX } },
			orderBy: { updatedAt: 'asc' },
			take: PENDING_SCAN_CAP,
		});
		const pending: DebridTransferRecord[] = [];
		for (const row of rows) {
			const record = row.value as unknown as DebridTransferRecord | null;
			if (record?.status !== 'pending' || !record.jobId) continue;
			pending.push(record);
			if (pending.length >= limit) break;
		}
		return pending;
	}

	/**
	 * Completed mappings, oldest first — the second half of the sweep.
	 *
	 * A mapping goes `completed` as soon as the rewritten hash is known, which
	 * happens *before* the release is filed into search, and the filing can fail
	 * on its own (a title with no page to file under, a job whose file list has
	 * no RD links). Those rows are redeemable — the dedup path hands the content
	 * to anyone who asks for that magnet — but they appear in no listing, which
	 * is the half of the complaint that reads as "TB → RD transfers aren't
	 * showing in the list". 71 of 323 were in that state on 2026-09-03.
	 */
	async listCompleted(limit: number): Promise<DebridTransferRecord[]> {
		if (limit <= 0) return [];
		const rows = await this.prisma.cache.findMany({
			where: { key: { startsWith: KEY_PREFIX } },
			orderBy: { updatedAt: 'asc' },
			take: PENDING_SCAN_CAP,
		});
		const completed: DebridTransferRecord[] = [];
		for (const row of rows) {
			const record = row.value as unknown as DebridTransferRecord | null;
			if (record?.status !== 'completed' || !record.rewrittenHash) continue;
			completed.push(record);
			if (completed.length >= limit) break;
		}
		return completed;
	}

	/**
	 * Move a mapping to the back of its queue without changing what it says.
	 *
	 * Both listings read oldest-first, so a row the sweep cannot resolve keeps
	 * its place at the front and is re-examined every tick. Measured on the
	 * first production tick, 2026-09-03: 13 of 25 slots went to in-flight jobs
	 * while debrid02 held ~128 non-terminal ones — more than a whole batch. Left
	 * alone the sweep would have filled with the same rows and never reached the
	 * 344 completions it exists to file. Bumping the row on each look makes the
	 * scan a fair round-robin instead; nothing reads this timestamp for anything
	 * but that ordering.
	 */
	async touchTransfer(record: DebridTransferRecord): Promise<void> {
		await this.put(record);
	}

	async removeTransfer(originalHash: string): Promise<void> {
		await this.prisma.cache
			.delete({ where: { key: keyFor(originalHash) } })
			.catch(() => undefined);
	}

	// job → owning server, so polls/deletes/file-fetches reach the right host.
	async recordJobServer(jobId: string, serverUrl: string): Promise<void> {
		const value = { serverUrl, updatedAt: Date.now() } as unknown as object;
		await this.prisma.cache.upsert({
			where: { key: jobKeyFor(jobId) },
			update: { value } as any,
			create: { key: jobKeyFor(jobId), value } as any,
		});
	}

	async getJobServer(jobId: string): Promise<string | null> {
		const row = await this.prisma.cache.findUnique({ where: { key: jobKeyFor(jobId) } });
		return row ? ((row.value as any)?.serverUrl ?? null) : null;
	}
}
