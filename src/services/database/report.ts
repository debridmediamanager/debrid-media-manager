import { JEV_DISPUTED, JEV_REPORTER, type ReportType } from '@/services/reporterId';
import { Prisma } from '@prisma/client';
import { DatabaseClient } from './client';

export class ReportService extends DatabaseClient {
	/**
	 * Creates or updates a report for incorrect content.
	 * @param hash - The hash of the torrent being reported
	 * @param imdbId - The IMDB ID of the content
	 * @param userId - The user ID (from RealDebrid or AllDebrid)
	 * @param type - The type of report (see `ReportType`)
	 * @returns A promise that resolves when the report is saved
	 */
	public async reportContent(
		hash: string,
		imdbId: string,
		userId: string,
		type: ReportType
	): Promise<void> {
		// Every reader compares reports to served hashes, which are lower case. None
		// was stored otherwise as of 2026-11-06 (20,103 reports); this keeps it so.
		hash = hash.toLowerCase();
		try {
			await this.prisma.report.upsert({
				where: {
					hash_userId: {
						hash,
						userId,
					},
				},
				update: {
					type,
					createdAt: new Date(),
				},
				create: {
					hash,
					imdbId,
					userId,
					type,
				},
			});
		} catch (error: any) {
			throw new Error(`Failed to save report: ${error.message}`);
		}
	}

	public async getEmptyMedia(quantity = 3): Promise<string[] | null> {
		const scrapedItems = await this.prisma.scraped.findMany({
			where: {
				OR: [
					{
						key: { startsWith: `tv:tt` },
						value: { equals: [] },
					},
					{
						key: { startsWith: `movie:tt` },
						value: { equals: [] },
					},
				],
			},
			orderBy: { updatedAt: 'asc' },
			take: quantity,
			select: { key: true },
		});

		if (scrapedItems.length > 0) {
			return scrapedItems.map((item) => item.key.split(':')[1]);
		}

		return null;
	}

	/**
	 * The hashes hidden on this title: the releases an admin approved a report on at
	 * /admin/reports. Reports alone hide nothing, however many there are or whether
	 * Jev agreed; they wait in the queue for a decision.
	 */
	public async getReportedHashes(imdbId: string): Promise<string[]> {
		try {
			const rows = await this.prisma.reportDecision.findMany({
				where: { imdbId, decision: 'approved' },
				select: { hash: true },
			});
			return rows.map((row) => row.hash);
		} catch (error: any) {
			throw new Error(`Failed to get reported hashes: ${error.message}`);
		}
	}

	/** The undecided pairs the model's verdict selects; built per query, never at module load. */
	private modelHaving(filter: ModelFilter): Prisma.Sql {
		switch (filter) {
			case 'agrees':
				return Prisma.sql`HAVING SUM(r.userId = ${JEV_REPORTER}) > 0`;
			case 'disagrees':
				return Prisma.sql`HAVING SUM(r.userId = ${JEV_DISPUTED}) > 0 AND SUM(r.userId = ${JEV_REPORTER}) = 0`;
			case 'unjudged':
				return Prisma.sql`HAVING SUM(r.userId IN (${JEV_REPORTER}, ${JEV_DISPUTED})) = 0`;
			default:
				return Prisma.empty;
		}
	}

	/** One page of the review queue, newest report first, and how many wait in all. */
	public async listUndecidedReports(
		take: number,
		skip: number,
		filter: ModelFilter = 'all'
	): Promise<{ total: number; pairs: ReportPair[] }> {
		const having = this.modelHaving(filter);
		const [pairs, counted] = await Promise.all([
			this.prisma.$queryRaw<ReportPair[]>`
				SELECT r.imdbId, r.hash
				FROM Report r
				LEFT JOIN ReportDecision d ON d.imdbId = r.imdbId AND d.hash = r.hash
				WHERE d.hash IS NULL
				GROUP BY r.imdbId, r.hash
				${having}
				ORDER BY MAX(r.createdAt) DESC
				LIMIT ${take} OFFSET ${skip}`,
			this.prisma.$queryRaw<{ total: bigint }[]>`
				SELECT COUNT(*) AS total FROM (
					SELECT 1 FROM Report r
					LEFT JOIN ReportDecision d ON d.imdbId = r.imdbId AND d.hash = r.hash
					WHERE d.hash IS NULL
					GROUP BY r.imdbId, r.hash
					${having}
				) pending`,
		]);
		return { total: Number(counted[0]?.total ?? 0), pairs };
	}

	/** How many undecided pairs each model filter holds. */
	public async countUndecidedByModel(): Promise<Record<ModelFilter, number>> {
		const [row] = await this.prisma.$queryRaw<Record<ModelFilter, bigint | null>[]>`
			SELECT COUNT(*) AS \`all\`,
				SUM(agrees > 0) AS agrees,
				SUM(disputed > 0 AND agrees = 0) AS disagrees,
				SUM(agrees = 0 AND disputed = 0) AS unjudged
			FROM (
				SELECT SUM(r.userId = ${JEV_REPORTER}) AS agrees, SUM(r.userId = ${JEV_DISPUTED}) AS disputed
				FROM Report r
				LEFT JOIN ReportDecision d ON d.imdbId = r.imdbId AND d.hash = r.hash
				WHERE d.hash IS NULL
				GROUP BY r.imdbId, r.hash
			) pending`;
		return {
			all: Number(row?.all ?? 0),
			agrees: Number(row?.agrees ?? 0),
			disagrees: Number(row?.disagrees ?? 0),
			unjudged: Number(row?.unjudged ?? 0),
		};
	}

	/** Keeps every undecided pair the model disputed and never confirmed. Returns how many. */
	public async keepModelDisputed(note: string): Promise<number> {
		return this.prisma.$executeRaw`
			INSERT INTO ReportDecision (imdbId, hash, decision, note, decidedAt)
			SELECT r.imdbId, r.hash, 'dismissed', ${note}, NOW(3)
			FROM Report r
			LEFT JOIN ReportDecision d ON d.imdbId = r.imdbId AND d.hash = r.hash
			WHERE d.hash IS NULL
			GROUP BY r.imdbId, r.hash
			${this.modelHaving('disagrees')}`;
	}

	/** One page of decided pairs, latest decision first. */
	public async listDecidedReports(
		decision: ReportDecisionKind,
		take: number,
		skip: number
	): Promise<{ total: number; decisions: ReportDecisionRow[] }> {
		const [decisions, total] = await Promise.all([
			this.prisma.reportDecision.findMany({
				where: { decision },
				orderBy: { decidedAt: 'desc' },
				take,
				skip,
			}),
			this.prisma.reportDecision.count({ where: { decision } }),
		]);
		return { total, decisions: decisions as ReportDecisionRow[] };
	}

	/** Every report filed on these pairs. */
	public async getReportsFor(pairs: ReportPair[]) {
		if (pairs.length === 0) return [];
		return this.prisma.report.findMany({
			where: { OR: pairs.map(({ imdbId, hash }) => ({ imdbId, hash })) },
			select: { imdbId: true, hash: true, userId: true, type: true, createdAt: true },
		});
	}

	public async getDecision(imdbId: string, hash: string): Promise<ReportDecisionRow | null> {
		const row = await this.prisma.reportDecision.findUnique({
			where: { imdbId_hash: { imdbId, hash } },
		});
		return row as ReportDecisionRow | null;
	}

	public async decide(
		imdbId: string,
		hash: string,
		decision: ReportDecisionKind,
		note: string | null
	): Promise<void> {
		await this.prisma.reportDecision.upsert({
			where: { imdbId_hash: { imdbId, hash } },
			create: { imdbId, hash, decision, note },
			update: { decision, note, decidedAt: new Date() },
		});
	}

	/** Back into the queue. */
	public async undecide(imdbId: string, hash: string): Promise<void> {
		await this.prisma.reportDecision.deleteMany({ where: { imdbId, hash } });
	}
}

export type ReportPair = { imdbId: string; hash: string };
export type ReportDecisionKind = 'approved' | 'dismissed';
export type ModelFilter = 'all' | 'agrees' | 'disagrees' | 'unjudged';
export type ReportDecisionRow = ReportPair & {
	decision: ReportDecisionKind;
	note: string | null;
	decidedAt: Date;
};
