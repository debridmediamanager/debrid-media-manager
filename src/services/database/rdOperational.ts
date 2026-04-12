import { DatabaseClient } from './client';

export type RealDebridOperation =
	| 'GET /user'
	| 'GET /torrents'
	| 'GET /torrents/info/{id}'
	| 'POST /torrents/addMagnet'
	| 'POST /torrents/selectFiles/{id}'
	| 'DELETE /torrents/delete/{id}'
	| 'POST /unrestrict/link';

export interface RdOperationStats {
	operation: RealDebridOperation;
	totalCount: number;
	successCount: number;
	failureCount: number;
	successRate: number;
}

export interface RdOverallStats {
	totalCount: number;
	successCount: number;
	failureCount: number;
	successRate: number;
	isDown: boolean;
	byOperation: Record<RealDebridOperation, RdOperationStats>;
	lastHour: Date | null;
}

const MONITORED_OPERATIONS: RealDebridOperation[] = [
	'GET /user',
	'GET /torrents',
	'GET /torrents/info/{id}',
	'POST /torrents/addMagnet',
	'POST /torrents/selectFiles/{id}',
	'DELETE /torrents/delete/{id}',
	'POST /unrestrict/link',
];

const OPERATION_DEFINITIONS: Array<{
	operation: RealDebridOperation;
	method: string;
	test: (pathname: string) => boolean;
}> = [
	{
		operation: 'GET /user',
		method: 'GET',
		test: (pathname) => pathname.endsWith('/user'),
	},
	{
		operation: 'GET /torrents',
		method: 'GET',
		test: (pathname) => pathname.endsWith('/torrents'),
	},
	{
		operation: 'GET /torrents/info/{id}',
		method: 'GET',
		test: (pathname) => /\/torrents\/info(\/|$)/.test(pathname),
	},
	{
		operation: 'POST /torrents/addMagnet',
		method: 'POST',
		test: (pathname) => pathname.endsWith('/torrents/addMagnet'),
	},
	{
		operation: 'POST /torrents/selectFiles/{id}',
		method: 'POST',
		test: (pathname) => /\/torrents\/selectFiles(\/|$)/.test(pathname),
	},
	{
		operation: 'DELETE /torrents/delete/{id}',
		method: 'DELETE',
		test: (pathname) => /\/torrents\/delete(\/|$)/.test(pathname),
	},
	{
		operation: 'POST /unrestrict/link',
		method: 'POST',
		test: (pathname) => /\/unrestrict\/link(\/|$)/.test(pathname),
	},
];

export function resolveRealDebridOperation(
	method: string | undefined,
	pathname: string
): RealDebridOperation | null {
	if (!method) {
		return null;
	}

	const normalizedMethod = method.toUpperCase();
	const matcher = OPERATION_DEFINITIONS.find(
		(def) => def.method === normalizedMethod && def.test(pathname)
	);

	return matcher ? matcher.operation : null;
}

function getHourStart(date: Date = new Date()): Date {
	const hourStart = new Date(date);
	hourStart.setMinutes(0, 0, 0);
	return hourStart;
}

export class RdOperationalService extends DatabaseClient {
	/**
	 * Records an RD API operation by atomically incrementing the hourly counter.
	 * This is a fire-and-forget operation - errors are logged but not thrown.
	 */
	public async recordOperation(operation: RealDebridOperation, status: number): Promise<void> {
		const hour = getHourStart();
		const isSuccess = status >= 200 && status < 300;
		const isFailure = status >= 500 && status < 600;
		const isOther = !isSuccess && !isFailure; // 3xx, 4xx

		try {
			// Atomic upsert avoids the race where two concurrent writers both see
			// no existing row and both try to create, hitting the unique constraint.
			// successRate is always recomputed from counts on read, so it's unused here.
			await this.prisma.rdOperationalHourly.upsert({
				where: { hour_operation: { hour, operation } },
				create: {
					hour,
					operation,
					totalCount: 1,
					successCount: isSuccess ? 1 : 0,
					failureCount: isFailure ? 1 : 0,
					otherCount: isOther ? 1 : 0,
					successRate: isSuccess ? 1 : 0,
				},
				update: {
					totalCount: { increment: 1 },
					...(isSuccess && { successCount: { increment: 1 } }),
					...(isFailure && { failureCount: { increment: 1 } }),
					...(isOther && { otherCount: { increment: 1 } }),
				},
			});
		} catch (error: any) {
			if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
				return;
			}
			console.error('Failed to record RD operation:', error);
		}
	}

	/**
	 * Gets aggregated stats for the last N hours (default 24).
	 */
	public async getStats(hoursBack: number = 24): Promise<RdOverallStats> {
		const emptyStats = this.buildEmptyStats();

		try {
			const cutoff = new Date();
			cutoff.setHours(cutoff.getHours() - hoursBack);

			const hourlyData = await this.prisma.rdOperationalHourly.findMany({
				where: {
					hour: { gte: cutoff },
				},
				orderBy: { hour: 'desc' },
			});

			if (hourlyData.length === 0) {
				return emptyStats;
			}

			const byOperation: Record<RealDebridOperation, RdOperationStats> = {} as any;
			for (const op of MONITORED_OPERATIONS) {
				byOperation[op] = {
					operation: op,
					totalCount: 0,
					successCount: 0,
					failureCount: 0,
					successRate: 0,
				};
			}

			let totalCount = 0;
			let totalSuccess = 0;
			let totalFailure = 0;
			let lastHour: Date | null = null;

			for (const row of hourlyData) {
				const operation = row.operation as RealDebridOperation;
				const opStats = byOperation[operation];
				if (!opStats) continue;

				opStats.totalCount += row.totalCount;
				opStats.successCount += row.successCount;
				opStats.failureCount += row.failureCount;

				totalCount += row.totalCount;
				totalSuccess += row.successCount;
				totalFailure += row.failureCount;

				if (!lastHour || row.hour > lastHour) {
					lastHour = row.hour;
				}
			}

			// Calculate success rates
			for (const op of MONITORED_OPERATIONS) {
				const opStats = byOperation[op];
				const considered = opStats.successCount + opStats.failureCount;
				opStats.successRate = considered > 0 ? opStats.successCount / considered : 0;
			}

			const considered = totalSuccess + totalFailure;
			const successRate = considered > 0 ? totalSuccess / considered : 0;
			const isDown = considered > 0 ? successRate < 0.5 : false;

			return {
				totalCount,
				successCount: totalSuccess,
				failureCount: totalFailure,
				successRate,
				isDown,
				byOperation,
				lastHour,
			};
		} catch (error: any) {
			if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
				return emptyStats;
			}
			console.error('Failed to get RD stats:', error);
			return emptyStats;
		}
	}

	/**
	 * Gets hourly history for charts.
	 */
	public async getHourlyHistory(hoursBack: number = 24): Promise<
		Array<{
			hour: Date;
			totalCount: number;
			successCount: number;
			failureCount: number;
			successRate: number;
		}>
	> {
		try {
			const cutoff = new Date();
			cutoff.setHours(cutoff.getHours() - hoursBack);

			const hourlyData = await this.prisma.rdOperationalHourly.findMany({
				where: {
					hour: { gte: cutoff },
				},
				orderBy: { hour: 'asc' },
			});

			// Aggregate by hour (across all operations)
			const byHour = new Map<
				string,
				{ hour: Date; totalCount: number; successCount: number; failureCount: number }
			>();

			for (const row of hourlyData) {
				const key = row.hour.toISOString();
				const existing = byHour.get(key);
				if (existing) {
					existing.totalCount += row.totalCount;
					existing.successCount += row.successCount;
					existing.failureCount += row.failureCount;
				} else {
					byHour.set(key, {
						hour: row.hour,
						totalCount: row.totalCount,
						successCount: row.successCount,
						failureCount: row.failureCount,
					});
				}
			}

			return Array.from(byHour.values()).map((h) => {
				const considered = h.successCount + h.failureCount;
				return {
					...h,
					successRate: considered > 0 ? h.successCount / considered : 0,
				};
			});
		} catch (error: any) {
			if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
				return [];
			}
			console.error('Failed to get RD hourly history:', error);
			return [];
		}
	}

	/**
	 * Rolls up hourly data into daily aggregates.
	 */
	public async rollupDaily(targetDate?: Date): Promise<void> {
		const date = targetDate ?? new Date();
		const dayStart = new Date(date);
		dayStart.setUTCHours(0, 0, 0, 0);
		const dayEnd = new Date(dayStart);
		dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

		try {
			// Get all hourly data for each operation on this day
			const hourlyData = await this.prisma.rdOperationalHourly.findMany({
				where: {
					hour: { gte: dayStart, lt: dayEnd },
				},
			});

			// Group by operation
			const byOperation = new Map<
				string,
				{
					totalCount: number;
					successCount: number;
					failureCount: number;
					rates: number[];
					peakHour: number | null;
					peakCount: number;
				}
			>();

			for (const row of hourlyData) {
				const existing = byOperation.get(row.operation);
				const considered = row.successCount + row.failureCount;
				const rate = considered > 0 ? row.successCount / considered : 0;
				const hourOfDay = row.hour.getUTCHours();

				if (existing) {
					existing.totalCount += row.totalCount;
					existing.successCount += row.successCount;
					existing.failureCount += row.failureCount;
					existing.rates.push(rate);
					// Track peak hour
					if (row.totalCount > existing.peakCount) {
						existing.peakCount = row.totalCount;
						existing.peakHour = hourOfDay;
					}
				} else {
					byOperation.set(row.operation, {
						totalCount: row.totalCount,
						successCount: row.successCount,
						failureCount: row.failureCount,
						rates: [rate],
						peakHour: hourOfDay,
						peakCount: row.totalCount,
					});
				}
			}

			// Upsert daily aggregates
			for (const [operation, data] of byOperation) {
				const avgRate =
					data.rates.length > 0
						? data.rates.reduce((a, b) => a + b, 0) / data.rates.length
						: 0;
				const minRate = data.rates.length > 0 ? Math.min(...data.rates) : 0;
				const maxRate = data.rates.length > 0 ? Math.max(...data.rates) : 0;

				await this.prisma.rdOperationalDaily.upsert({
					where: {
						date_operation: { date: dayStart, operation },
					},
					update: {
						totalCount: data.totalCount,
						successCount: data.successCount,
						failureCount: data.failureCount,
						avgSuccessRate: avgRate,
						minSuccessRate: minRate,
						maxSuccessRate: maxRate,
						peakHour: data.peakHour,
					},
					create: {
						date: dayStart,
						operation,
						totalCount: data.totalCount,
						successCount: data.successCount,
						failureCount: data.failureCount,
						avgSuccessRate: avgRate,
						minSuccessRate: minRate,
						maxSuccessRate: maxRate,
						peakHour: data.peakHour,
					},
				});
			}
		} catch (error: any) {
			if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
				return;
			}
			console.error('Failed to rollup RD daily:', error);
		}
	}

	/**
	 * Gets daily history for long-term charts.
	 */
	public async getDailyHistory(daysBack: number = 90): Promise<
		Array<{
			date: Date;
			totalCount: number;
			successCount: number;
			failureCount: number;
			avgSuccessRate: number;
			minSuccessRate: number;
			maxSuccessRate: number;
		}>
	> {
		try {
			const cutoff = new Date();
			cutoff.setUTCDate(cutoff.getUTCDate() - daysBack);
			cutoff.setUTCHours(0, 0, 0, 0);

			const dailyData = await this.prisma.rdOperationalDaily.findMany({
				where: {
					date: { gte: cutoff },
				},
				orderBy: { date: 'asc' },
			});

			// Aggregate by date (across all operations)
			const byDate = new Map<
				string,
				{
					date: Date;
					totalCount: number;
					successCount: number;
					failureCount: number;
					rates: number[];
					minRates: number[];
					maxRates: number[];
				}
			>();

			for (const row of dailyData) {
				const key = row.date.toISOString();
				const existing = byDate.get(key);
				if (existing) {
					existing.totalCount += row.totalCount;
					existing.successCount += row.successCount;
					existing.failureCount += row.failureCount;
					existing.rates.push(row.avgSuccessRate);
					existing.minRates.push(row.minSuccessRate);
					existing.maxRates.push(row.maxSuccessRate);
				} else {
					byDate.set(key, {
						date: row.date,
						totalCount: row.totalCount,
						successCount: row.successCount,
						failureCount: row.failureCount,
						rates: [row.avgSuccessRate],
						minRates: [row.minSuccessRate],
						maxRates: [row.maxSuccessRate],
					});
				}
			}

			return Array.from(byDate.values()).map((d) => ({
				date: d.date,
				totalCount: d.totalCount,
				successCount: d.successCount,
				failureCount: d.failureCount,
				avgSuccessRate:
					d.rates.length > 0 ? d.rates.reduce((a, b) => a + b, 0) / d.rates.length : 0,
				minSuccessRate: d.minRates.length > 0 ? Math.min(...d.minRates) : 0,
				maxSuccessRate: d.maxRates.length > 0 ? Math.max(...d.maxRates) : 0,
			}));
		} catch (error: any) {
			if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
				return [];
			}
			console.error('Failed to get RD daily history:', error);
			return [];
		}
	}

	/**
	 * Cleans up old data:
	 * - Hourly data older than 7 days
	 * - Daily data older than 90 days
	 */
	public async cleanupOldData(): Promise<{ hourlyDeleted: number; dailyDeleted: number }> {
		let hourlyDeleted = 0;
		let dailyDeleted = 0;

		try {
			const hourlyKeepDays = 90;
			const dailyKeepDays = 90;

			const hourlyCutoff = new Date();
			hourlyCutoff.setUTCDate(hourlyCutoff.getUTCDate() - hourlyKeepDays);

			const dailyCutoff = new Date();
			dailyCutoff.setUTCDate(dailyCutoff.getUTCDate() - dailyKeepDays);

			const [hourlyResult, dailyResult] = await Promise.all([
				this.prisma.rdOperationalHourly.deleteMany({
					where: { hour: { lt: hourlyCutoff } },
				}),
				this.prisma.rdOperationalDaily.deleteMany({
					where: { date: { lt: dailyCutoff } },
				}),
			]);

			hourlyDeleted = hourlyResult.count;
			dailyDeleted = dailyResult.count;
		} catch (error: any) {
			if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
				return { hourlyDeleted: 0, dailyDeleted: 0 };
			}
			console.error('Failed to cleanup old RD data:', error);
		}

		return { hourlyDeleted, dailyDeleted };
	}

	private buildEmptyStats(): RdOverallStats {
		const byOperation: Record<RealDebridOperation, RdOperationStats> = {} as any;
		for (const op of MONITORED_OPERATIONS) {
			byOperation[op] = {
				operation: op,
				totalCount: 0,
				successCount: 0,
				failureCount: 0,
				successRate: 0,
			};
		}

		return {
			totalCount: 0,
			successCount: 0,
			failureCount: 0,
			successRate: 0,
			isDown: false,
			byOperation,
			lastHour: null,
		};
	}
}
