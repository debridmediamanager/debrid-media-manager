import { DatabaseClient } from './client';

/**
 * A Usenet → RD transfer produces a torrent that exists nowhere but Real-Debrid:
 * nzb2rd builds it around a webseed, so it has no announce and no DHT presence,
 * and its info hash cannot be known before the job finishes. There is no
 * original torrent hash to key on either — the release only ever existed as an
 * NZB — so transfers are keyed by the *indexer release id*, which is stable and
 * unique per posting.
 *
 * That mapping lets any user (not just the browser that started the job) see
 * that a release has already been fetched, and jump to the registered RD result
 * instead of paying for the same Usenet download twice.
 *
 * Stored in the generic `Cache` KV table under an `nzbrd:` prefix, mirroring how
 * DebridUploaderMapService stores TB → RD transfers — no migration needed.
 */
export type Nzb2rdTransferStatus = 'pending' | 'completed';

export interface Nzb2rdTransferRecord {
	releaseId: string;
	jobId: string;
	imdbId: string;
	status: Nzb2rdTransferStatus;
	/** The built torrent's hash. Only known once the job completes. */
	infoHash?: string;
	title?: string;
	updatedAt: number;
}

const KEY_PREFIX = 'nzbrd:';
const keyFor = (releaseId: string) => `${KEY_PREFIX}${releaseId.toLowerCase()}`;

export class Nzb2rdMapService extends DatabaseClient {
	async getTransfer(releaseId: string): Promise<Nzb2rdTransferRecord | null> {
		const row = await this.prisma.cache.findUnique({ where: { key: keyFor(releaseId) } });
		return row ? (row.value as unknown as Nzb2rdTransferRecord) : null;
	}

	async getTransfers(releaseIds: string[]): Promise<Nzb2rdTransferRecord[]> {
		if (releaseIds.length === 0) return [];
		const rows = await this.prisma.cache.findMany({
			where: { key: { in: releaseIds.map(keyFor) } },
		});
		return rows.map((r) => r.value as unknown as Nzb2rdTransferRecord);
	}

	private async put(record: Nzb2rdTransferRecord): Promise<void> {
		const value = { ...record, updatedAt: Date.now() } as unknown as object;
		await this.prisma.cache.upsert({
			where: { key: keyFor(record.releaseId) },
			update: { value } as any,
			create: { key: keyFor(record.releaseId), value } as any,
		});
	}

	async recordPending(
		releaseId: string,
		jobId: string,
		imdbId: string,
		title?: string
	): Promise<void> {
		// Never downgrade a completed mapping back to pending.
		const existing = await this.getTransfer(releaseId);
		if (existing?.status === 'completed') return;
		await this.put({
			releaseId: releaseId.toLowerCase(),
			jobId,
			imdbId,
			status: 'pending',
			title,
			updatedAt: Date.now(),
		});
	}

	async recordCompleted(
		releaseId: string,
		jobId: string,
		imdbId: string,
		infoHash: string,
		title?: string
	): Promise<void> {
		await this.put({
			releaseId: releaseId.toLowerCase(),
			jobId,
			imdbId,
			status: 'completed',
			infoHash: infoHash.toLowerCase(),
			title,
			updatedAt: Date.now(),
		});
	}

	async removeTransfer(releaseId: string): Promise<void> {
		await this.prisma.cache
			.delete({ where: { key: keyFor(releaseId) } })
			.catch(() => undefined);
	}
}
