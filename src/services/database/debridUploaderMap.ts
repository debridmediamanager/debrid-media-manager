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
