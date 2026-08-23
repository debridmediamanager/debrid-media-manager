import { DatabaseClient } from './client';

// Retention periods, matching the Real-Debrid observability tables.
const HOURLY_RETENTION_DAYS = 90;
const DAILY_RETENTION_DAYS = 90;

/**
 * Whether the authenticated TorBox surface was exercised, and how it went.
 *
 * `skipped` is not a failure: the page is designed to work with no TorBox
 * credentials at all, and the authenticated probe is purely supplementary.
 * `credentials` means TorBox answered but refused the key (AUTH_ERROR) - per
 * the notes in CLAUDE.md a rotated key is the real abuse signal, and it says
 * nothing about whether TorBox is up for anyone else.
 */
export type TorBoxAuthState = 'ok' | 'failed' | 'credentials' | 'skipped';

export interface TorBoxCdnNodeStatus {
	host: string;
	region: string;
	name: string;
	status: number | null;
	latencyMs: number | null;
	ok: boolean;
	error: string | null;
	checkedAt: Date;
}

export interface TorBoxCdnMetrics {
	total: number;
	working: number;
	rate: number;
	lastChecked: number | null;
	avgLatencyMs: number | null;
	fastestNode: string | null;
	failedNodes: string[];
}

export interface TorBoxCheckResultData {
	apiOk: boolean;
	apiLatencyMs: number | null;
	apiDetail: string | null;
	authState: TorBoxAuthState;
	authError: string | null;
	totalNodes: number;
	workingNodes: number;
	checkedAt: Date;
}

export interface TorBoxHourlyData {
	hour: Date;
	totalNodes: number;
	workingNodes: number;
	workingRate: number;
	apiSuccessCount: number;
	apiTotalCount: number;
	apiSuccessRate: number;
	avgLatencyMs: number | null;
	minLatencyMs: number | null;
	maxLatencyMs: number | null;
	fastestNode: string | null;
	checksInHour: number;
	failedNodes: string[];
}

export interface TorBoxDailyData {
	date: Date;
	avgWorkingRate: number;
	minWorkingRate: number;
	maxWorkingRate: number;
	avgApiSuccessRate: number;
	avgLatencyMs: number | null;
	checksCount: number;
}

const EMPTY_METRICS: TorBoxCdnMetrics = {
	total: 0,
	working: 0,
	rate: 0,
	lastChecked: null,
	avgLatencyMs: null,
	fastestNode: null,
	failedNodes: [],
};

/**
 * Returns true for the Prisma errors that mean "the table or the database is
 * not reachable" rather than "this query is wrong". Those degrade to empty
 * results so a missing migration never takes the status page down with it.
 */
function isRecoverableDbError(error: any): boolean {
	return Boolean(
		error?.code?.startsWith?.('P') ||
			error?.name?.includes?.('Prisma') ||
			error?.message?.includes('does not exist') ||
			error?.message?.includes('Authentication failed')
	);
}

export class TorBoxHealthService extends DatabaseClient {
	/**
	 * Upserts the current status of every CDN node in one transaction.
	 */
	public async upsertCdnResults(results: TorBoxCdnNodeStatus[]): Promise<void> {
		if (results.length === 0) return;

		const payload = (result: TorBoxCdnNodeStatus) => ({
			region: result.region,
			name: result.name,
			status: result.status,
			latencyMs: result.latencyMs,
			ok: result.ok,
			error: result.error,
			checkedAt: result.checkedAt,
		});

		try {
			await this.prisma.$transaction(
				results.map((result) =>
					this.prisma.torBoxCdnHealth.upsert({
						where: { host: result.host },
						update: payload(result),
						create: { host: result.host, ...payload(result) },
					})
				)
			);
		} catch (error: any) {
			if (isRecoverableDbError(error)) {
				console.warn('[TorBoxHealth] Could not store CDN results:', error?.code ?? error);
				return;
			}
			console.error('[TorBoxHealth] Failed to upsert CDN results:', error);
		}
	}

	/**
	 * Drops nodes TorBox no longer advertises, so a retired region does not
	 * linger as a permanently failing row. Never called with an empty list -
	 * see the caller, which skips the whole write path when discovery fails.
	 */
	public async deleteDeprecatedNodes(validHosts: string[]): Promise<number> {
		if (validHosts.length === 0) return 0;

		try {
			const result = await this.prisma.torBoxCdnHealth.deleteMany({
				where: { host: { notIn: validHosts } },
			});
			return result.count;
		} catch (error: any) {
			if (isRecoverableDbError(error)) return 0;
			console.error('[TorBoxHealth] Failed to delete deprecated nodes:', error);
			return 0;
		}
	}

	public async getAllCdnStatuses(): Promise<TorBoxCdnNodeStatus[]> {
		try {
			const results = await this.prisma.torBoxCdnHealth.findMany({
				orderBy: [{ ok: 'desc' }, { latencyMs: 'asc' }],
			});

			return results.map((r) => ({
				host: r.host,
				region: r.region,
				name: r.name,
				status: r.status,
				latencyMs: r.latencyMs,
				ok: r.ok,
				error: r.error,
				checkedAt: r.checkedAt,
			}));
		} catch (error: any) {
			if (isRecoverableDbError(error)) {
				console.warn('[TorBoxHealth] getAllCdnStatuses degraded:', error?.code ?? error);
				return [];
			}
			throw error;
		}
	}

	public async getCdnMetrics(): Promise<TorBoxCdnMetrics> {
		const statuses = await this.getAllCdnStatuses();
		if (statuses.length === 0) return { ...EMPTY_METRICS };

		const working = statuses.filter((s) => s.ok);
		const withLatency = working.filter(
			(s): s is TorBoxCdnNodeStatus & { latencyMs: number } => s.latencyMs !== null
		);
		const fastest = withLatency.reduce<(typeof withLatency)[number] | null>(
			(best, current) =>
				best === null || current.latencyMs < best.latencyMs ? current : best,
			null
		);

		return {
			total: statuses.length,
			working: working.length,
			rate: working.length / statuses.length,
			lastChecked: Math.max(...statuses.map((s) => s.checkedAt.getTime())),
			avgLatencyMs:
				withLatency.length > 0
					? withLatency.reduce((sum, s) => sum + s.latencyMs, 0) / withLatency.length
					: null,
			fastestNode: fastest?.host ?? null,
			failedNodes: statuses.filter((s) => !s.ok).map((s) => s.host),
		};
	}

	public async recordCheckResult(
		result: Omit<TorBoxCheckResultData, 'checkedAt'>
	): Promise<void> {
		try {
			await this.prisma.torBoxCheckResult.create({
				data: {
					apiOk: result.apiOk,
					apiLatencyMs: result.apiLatencyMs,
					apiDetail: result.apiDetail,
					authState: result.authState,
					authError: result.authError,
					totalNodes: result.totalNodes,
					workingNodes: result.workingNodes,
				},
			});
		} catch (error: any) {
			if (isRecoverableDbError(error)) return;
			console.error('[TorBoxHealth] Failed to record check result:', error);
		}
	}

	public async getRecentChecks(limit = 12): Promise<TorBoxCheckResultData[]> {
		try {
			const results = await this.prisma.torBoxCheckResult.findMany({
				orderBy: { checkedAt: 'desc' },
				take: limit,
			});

			return results.map((r) => ({
				apiOk: r.apiOk,
				apiLatencyMs: r.apiLatencyMs,
				apiDetail: r.apiDetail,
				authState: r.authState as TorBoxAuthState,
				authError: r.authError,
				totalNodes: r.totalNodes,
				workingNodes: r.workingNodes,
				checkedAt: r.checkedAt,
			}));
		} catch (error: any) {
			if (isRecoverableDbError(error)) return [];
			throw error;
		}
	}

	/**
	 * Folds one check run into the current hour's bucket. Latency and rates are
	 * averaged across every run that lands in the same hour.
	 */
	public async recordHealthSnapshot(data: {
		totalNodes: number;
		workingNodes: number;
		apiOk: boolean;
		avgLatencyMs: number | null;
		minLatencyMs: number | null;
		maxLatencyMs: number | null;
		fastestNode: string | null;
		failedNodes: string[];
	}): Promise<void> {
		const hour = startOfHour(new Date());
		const workingRate = data.totalNodes > 0 ? data.workingNodes / data.totalNodes : 0;

		try {
			const existing = await this.prisma.torBoxHealthHourly.findUnique({ where: { hour } });

			if (!existing) {
				await this.prisma.torBoxHealthHourly.create({
					data: {
						hour,
						totalNodes: data.totalNodes,
						workingNodes: data.workingNodes,
						workingRate,
						apiSuccessCount: data.apiOk ? 1 : 0,
						apiTotalCount: 1,
						apiSuccessRate: data.apiOk ? 1 : 0,
						avgLatencyMs: data.avgLatencyMs,
						minLatencyMs: data.minLatencyMs,
						maxLatencyMs: data.maxLatencyMs,
						fastestNode: data.fastestNode,
						checksInHour: 1,
						failedNodes: data.failedNodes,
					},
				});
				return;
			}

			const checksInHour = existing.checksInHour + 1;
			const apiTotalCount = existing.apiTotalCount + 1;
			const apiSuccessCount = existing.apiSuccessCount + (data.apiOk ? 1 : 0);

			// Running mean over the checks in this hour, not over the nodes.
			const mergedAvgLatency =
				data.avgLatencyMs === null
					? existing.avgLatencyMs
					: existing.avgLatencyMs === null
						? data.avgLatencyMs
						: (existing.avgLatencyMs * existing.checksInHour + data.avgLatencyMs) /
							checksInHour;

			await this.prisma.torBoxHealthHourly.update({
				where: { hour },
				data: {
					totalNodes: data.totalNodes,
					workingNodes: data.workingNodes,
					workingRate:
						(existing.workingRate * existing.checksInHour + workingRate) / checksInHour,
					apiSuccessCount,
					apiTotalCount,
					apiSuccessRate: apiSuccessCount / apiTotalCount,
					avgLatencyMs: mergedAvgLatency,
					minLatencyMs: minDefined(existing.minLatencyMs, data.minLatencyMs),
					maxLatencyMs: maxDefined(existing.maxLatencyMs, data.maxLatencyMs),
					fastestNode: data.fastestNode ?? existing.fastestNode,
					checksInHour,
					failedNodes: data.failedNodes,
				},
			});
		} catch (error: any) {
			if (isRecoverableDbError(error)) return;
			console.error('[TorBoxHealth] Failed to record health snapshot:', error);
		}
	}

	public async getHourlyHistory(hoursBack = 24): Promise<TorBoxHourlyData[]> {
		const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

		try {
			const data = await this.prisma.torBoxHealthHourly.findMany({
				where: { hour: { gte: since } },
				orderBy: { hour: 'asc' },
			});

			return data.map((d) => ({
				hour: d.hour,
				totalNodes: d.totalNodes,
				workingNodes: d.workingNodes,
				workingRate: d.workingRate,
				apiSuccessCount: d.apiSuccessCount,
				apiTotalCount: d.apiTotalCount,
				apiSuccessRate: d.apiSuccessRate,
				avgLatencyMs: d.avgLatencyMs,
				minLatencyMs: d.minLatencyMs,
				maxLatencyMs: d.maxLatencyMs,
				fastestNode: d.fastestNode,
				checksInHour: d.checksInHour,
				failedNodes: Array.isArray(d.failedNodes) ? (d.failedNodes as string[]) : [],
			}));
		} catch (error: any) {
			if (isRecoverableDbError(error)) return [];
			throw error;
		}
	}

	public async getDailyHistory(daysBack = 90): Promise<TorBoxDailyData[]> {
		const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

		try {
			const data = await this.prisma.torBoxHealthDaily.findMany({
				where: { date: { gte: since } },
				orderBy: { date: 'asc' },
			});

			return data.map((d) => ({
				date: d.date,
				avgWorkingRate: d.avgWorkingRate,
				minWorkingRate: d.minWorkingRate,
				maxWorkingRate: d.maxWorkingRate,
				avgApiSuccessRate: d.avgApiSuccessRate,
				avgLatencyMs: d.avgLatencyMs,
				checksCount: d.checksCount,
			}));
		} catch (error: any) {
			if (isRecoverableDbError(error)) return [];
			throw error;
		}
	}

	/**
	 * Rolls one day of hourly buckets into a daily row. Idempotent - the cron
	 * calls it on every run and it upserts.
	 */
	public async rollupDaily(targetDate?: Date): Promise<boolean> {
		const date = startOfDay(targetDate ?? new Date());
		const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);

		try {
			const hourlyData = await this.prisma.torBoxHealthHourly.findMany({
				where: { hour: { gte: date, lt: nextDate } },
			});

			if (hourlyData.length === 0) return false;

			// Weight by the number of checks each hour actually contains, so a
			// partially-collected hour does not count as much as a full one.
			const totalChecks = hourlyData.reduce((sum, h) => sum + h.checksInHour, 0);
			const weighted = (pick: (h: (typeof hourlyData)[number]) => number) =>
				totalChecks > 0
					? hourlyData.reduce((sum, h) => sum + pick(h) * h.checksInHour, 0) / totalChecks
					: 0;

			const withLatency = hourlyData.filter((h) => h.avgLatencyMs !== null);
			const latencyChecks = withLatency.reduce((sum, h) => sum + h.checksInHour, 0);
			const avgLatencyMs =
				latencyChecks > 0
					? withLatency.reduce(
							(sum, h) => sum + (h.avgLatencyMs as number) * h.checksInHour,
							0
						) / latencyChecks
					: null;

			const workingRates = hourlyData.map((h) => h.workingRate);
			const row = {
				avgWorkingRate: weighted((h) => h.workingRate),
				minWorkingRate: Math.min(...workingRates),
				maxWorkingRate: Math.max(...workingRates),
				avgApiSuccessRate: weighted((h) => h.apiSuccessRate),
				avgLatencyMs,
				checksCount: totalChecks,
			};

			await this.prisma.torBoxHealthDaily.upsert({
				where: { date },
				update: row,
				create: { date, ...row },
			});

			return true;
		} catch (error: any) {
			if (isRecoverableDbError(error)) return false;
			console.error('[TorBoxHealth] Failed to roll up daily data:', error);
			return false;
		}
	}

	public async cleanupOldData(): Promise<{
		hourlyDeleted: number;
		dailyDeleted: number;
		checkResultsDeleted: number;
	}> {
		const results = { hourlyDeleted: 0, dailyDeleted: 0, checkResultsDeleted: 0 };
		const hourlyCutoff = new Date(Date.now() - HOURLY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
		const dailyCutoff = new Date(Date.now() - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
		// Individual check rows only back the "recent checks" strip on the page.
		const checkCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

		try {
			results.hourlyDeleted = (
				await this.prisma.torBoxHealthHourly.deleteMany({
					where: { hour: { lt: hourlyCutoff } },
				})
			).count;
		} catch {
			// Table may not exist yet.
		}

		try {
			results.dailyDeleted = (
				await this.prisma.torBoxHealthDaily.deleteMany({
					where: { date: { lt: dailyCutoff } },
				})
			).count;
		} catch {
			// Table may not exist yet.
		}

		try {
			results.checkResultsDeleted = (
				await this.prisma.torBoxCheckResult.deleteMany({
					where: { checkedAt: { lt: checkCutoff } },
				})
			).count;
		} catch {
			// Table may not exist yet.
		}

		return results;
	}
}

function minDefined(a: number | null, b: number | null): number | null {
	if (a === null) return b;
	if (b === null) return a;
	return Math.min(a, b);
}

function maxDefined(a: number | null, b: number | null): number | null {
	if (a === null) return b;
	if (b === null) return a;
	return Math.max(a, b);
}

function startOfHour(date: Date): Date {
	const d = new Date(date);
	d.setUTCMinutes(0, 0, 0);
	return d;
}

function startOfDay(date: Date): Date {
	const d = new Date(date);
	d.setUTCHours(0, 0, 0, 0);
	return d;
}

export const __testing = { startOfHour, startOfDay, minDefined, maxDefined };
