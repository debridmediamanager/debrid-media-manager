import { Prisma, type PrismaClient } from '@prisma/client';

type Kind = 'success' | 'failure' | 'other';
type Pending = { hour: Date; operation: string; total: number } & Record<Kind, number>;

/**
 * An hourly operations table's counters, summed in memory and written every few seconds.
 * One Prisma upsert per API call read and then updated the hour's row, holding its lock
 * through a commit: on 2026-11-10, 1,427 of those updates on RdOperationalHourly waited
 * 5 to 51 s behind each other. Counts still queued when a replica stops are lost.
 */
export class HourlyCounters {
	private pending = new Map<string, Pending>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private prisma: PrismaClient | null = null;

	constructor(
		private readonly table: 'RdOperationalHourly' | 'TorBoxOperationalHourly',
		private readonly label: string,
		private readonly flushMs = 10_000
	) {}

	add(prisma: PrismaClient, hour: Date, operation: string, kind: Kind): void {
		this.prisma = prisma;
		const key = `${hour.getTime()} ${operation}`;
		const row = this.pending.get(key) ?? {
			hour,
			operation,
			total: 0,
			success: 0,
			failure: 0,
			other: 0,
		};
		row.total++;
		row[kind]++;
		this.pending.set(key, row);
		if (!this.timer) {
			this.timer = setTimeout(() => void this.flush(), this.flushMs);
			this.timer.unref?.();
		}
	}

	/** Writes every queued count in one statement; errors are logged, never thrown. */
	async flush(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const rows = [...this.pending.values()];
		this.pending.clear();
		if (rows.length === 0 || !this.prisma) return;
		const table = Prisma.raw(`\`${this.table}\``);
		try {
			await this.prisma.$executeRaw(Prisma.sql`
				INSERT INTO ${table} (\`hour\`, operation, totalCount, successCount, failureCount, otherCount, successRate)
				VALUES ${Prisma.join(
					rows.map(
						(r) =>
							Prisma.sql`(${r.hour}, ${r.operation}, ${r.total}, ${r.success}, ${r.failure}, ${r.other}, 0)`
					)
				)}
				AS n ON DUPLICATE KEY UPDATE
					totalCount = ${table}.totalCount + n.totalCount,
					successCount = ${table}.successCount + n.successCount,
					failureCount = ${table}.failureCount + n.failureCount,
					otherCount = ${table}.otherCount + n.otherCount`);
		} catch (error: any) {
			if (error?.code === 'P2021' || error?.message?.includes('does not exist')) return;
			console.error(`Failed to record ${this.label} operations:`, error);
		}
	}
}
