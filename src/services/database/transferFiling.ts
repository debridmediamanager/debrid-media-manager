import { DatabaseClient } from './client';
import type { TransferMetaSource } from './transferMeta';

/**
 * What the completion sweep already did with a finished transfer.
 *
 * The sweep (`fileCompletedTransfers`) reads every completed job on every
 * uploader each tick and files the ones missing from `Available`. Without a
 * note of what it already tried, two kinds of job would be redone every five
 * minutes for as long as they stay in its window:
 *
 * - a refusal, such as a release whose only file is a sample or a title with no
 *   DMM page, which costs an uploader round trip each time to be told no again;
 * - a release it filed that a user then evicted from `Available` as a false
 *   positive (`/api/availability/remove`). Filing it again would undo that
 *   eviction within five minutes, every time.
 *
 * So each job gets one record, keyed like the `xfer:` page context by source
 * and job id. A `filed` record is final. A `refused` one is retried after a
 * while, because one refusal does heal: an IMDb id newer than the last daily
 * import has no title type until the next one lands.
 *
 * Stored in the generic `Cache` KV table under an `xfersweep:` prefix, like the
 * other transfer records, so no migration. The prefix does not begin with
 * `xfer:`, so no `xfer:` lookup can match one. Records only matter while their
 * job is inside the sweep's window, and the sweep prunes them after that.
 */
export type TransferFilingOutcome = 'filed' | 'refused';

export interface TransferFilingRecord {
	source: TransferMetaSource;
	jobId: string;
	outcome: TransferFilingOutcome;
	/** Why a refused job was refused, as `FilingRefusal` names it. */
	reason?: string;
	at: number;
}

const KEY_PREFIX = 'xfersweep:';
const keyFor = (source: TransferMetaSource, jobId: string) => `${KEY_PREFIX}${source}:${jobId}`;

export class TransferFilingService extends DatabaseClient {
	/** The records for a set of jobs, in one query, keyed `<source>:<jobId>`. */
	async getMany(
		jobs: { source: TransferMetaSource; jobId: string }[]
	): Promise<Map<string, TransferFilingRecord>> {
		if (jobs.length === 0) return new Map();
		const rows = await this.prisma.cache.findMany({
			where: { key: { in: jobs.map((j) => keyFor(j.source, j.jobId)) } },
		});
		const byJob = new Map<string, TransferFilingRecord>();
		for (const row of rows) {
			const record = row.value as unknown as TransferFilingRecord;
			if (record?.source && record?.jobId)
				byJob.set(`${record.source}:${record.jobId}`, record);
		}
		return byJob;
	}

	async record(record: Omit<TransferFilingRecord, 'at'>, at: number = Date.now()): Promise<void> {
		const value = { ...record, at } as unknown as object;
		const key = keyFor(record.source, record.jobId);
		await this.prisma.cache.upsert({
			where: { key },
			update: { value } as any,
			create: { key, value } as any,
		});
	}

	/** Drop the records last written before `cutoff`; answers how many went. */
	async pruneBefore(cutoff: Date): Promise<number> {
		const { count } = await this.prisma.cache.deleteMany({
			where: { key: { startsWith: KEY_PREFIX }, updatedAt: { lt: cutoff } },
		});
		return count;
	}
}
