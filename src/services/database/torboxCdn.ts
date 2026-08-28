import { DatabaseClient } from './client';

// Crowd-sourced TorBox CDN reachability.
//
// Every sample here was measured by a reader's browser on the status page, from
// that reader's own network - see `lib/observability/torboxCdnProbe.ts`. Nothing
// in DMM probes tb-cdn on a schedule, and reintroducing that is the one thing
// this table must never become: a probe from a single datacentre IP measures
// that IP's standing with TorBox, which is how the old cron came to announce
// outages that no user was experiencing.
//
// Aggregating across many readers is what makes the numbers mean something the
// live panel cannot say on its own. The panel answers "can *I* reach this
// region"; these counters answer "can anyone else", which is the actual
// "or just me" question.

export interface TorBoxCdnSample {
	region: string;
	ok: boolean;
	/** Only present, and only counted, for a region that served bytes. */
	latencyMs: number | null;
}

export interface TorBoxCdnBucket {
	/** Bucket start - an hour for hourly rows, a UTC midnight for daily ones. */
	time: Date;
	okCount: number;
	failCount: number;
	/** okCount / (okCount + failCount), or 0 when the bucket is empty. */
	rate: number;
	avgLatencyMs: number | null;
}

export interface TorBoxCdnRegionSummary {
	region: string;
	okCount: number;
	failCount: number;
	rate: number;
	avgLatencyMs: number | null;
}

function getHourStart(date: Date = new Date()): Date {
	const hourStart = new Date(date);
	hourStart.setMinutes(0, 0, 0);
	return hourStart;
}

function rateOf(okCount: number, failCount: number): number {
	const considered = okCount + failCount;
	return considered > 0 ? okCount / considered : 0;
}

function averageOf(sumMs: number, count: number): number | null {
	return count > 0 ? sumMs / count : null;
}

/** A missing table is the normal state on a fresh DB; it is not worth logging. */
function isMissingTable(error: any): boolean {
	return error?.code === 'P2021' || error?.message?.includes('does not exist');
}

export class TorBoxCdnService extends DatabaseClient {
	/**
	 * Folds one reader's probe run into the hourly counters, one upsert per
	 * region. Fire-and-forget: a status page must not fail because a counter did.
	 */
	public async recordSamples(samples: TorBoxCdnSample[]): Promise<number> {
		if (samples.length === 0) return 0;

		const hour = getHourStart();
		let recorded = 0;

		for (const sample of samples) {
			// Latency is only meaningful for a node that actually served the
			// range; a failure has no latency to average, and counting a
			// timeout as "8000ms" would quietly turn outages into slowness.
			const latencyMs =
				sample.ok &&
				typeof sample.latencyMs === 'number' &&
				Number.isFinite(sample.latencyMs)
					? sample.latencyMs
					: null;

			try {
				// Atomic upsert: many readers write the same (hour, region) row
				// concurrently, and read-then-write would lose votes to the
				// unique constraint.
				await this.prisma.torBoxCdnHourly.upsert({
					where: { hour_region: { hour, region: sample.region } },
					create: {
						hour,
						region: sample.region,
						okCount: sample.ok ? 1 : 0,
						failCount: sample.ok ? 0 : 1,
						latencySumMs: latencyMs ?? 0,
						latencyCount: latencyMs !== null ? 1 : 0,
					},
					update: {
						...(sample.ok
							? { okCount: { increment: 1 } }
							: { failCount: { increment: 1 } }),
						...(latencyMs !== null && {
							latencySumMs: { increment: latencyMs },
							latencyCount: { increment: 1 },
						}),
					},
				});
				recorded += 1;
			} catch (error: any) {
				if (isMissingTable(error)) return recorded;
				console.error('Failed to record TorBox CDN sample:', error);
			}
		}

		return recorded;
	}

	/**
	 * Overall reachability per hour, summed across regions. One region being
	 * dark drags the whole line down, which is the intent - a reader cannot use
	 * a region they cannot reach.
	 */
	public async getHourlyHistory(hoursBack: number = 24): Promise<TorBoxCdnBucket[]> {
		try {
			const cutoff = new Date();
			cutoff.setHours(cutoff.getHours() - hoursBack);

			const rows = await this.prisma.torBoxCdnHourly.findMany({
				where: { hour: { gte: cutoff } },
				orderBy: { hour: 'asc' },
			});

			return this.foldBuckets(
				rows.map((row) => ({
					time: row.hour,
					okCount: row.okCount,
					failCount: row.failCount,
					latencySumMs: row.latencySumMs,
					latencyCount: row.latencyCount,
				}))
			);
		} catch (error: any) {
			if (isMissingTable(error)) return [];
			console.error('Failed to get TorBox CDN hourly history:', error);
			return [];
		}
	}

	/** Same shape as the hourly history, bucketed by UTC day. */
	public async getDailyHistory(daysBack: number = 90): Promise<TorBoxCdnBucket[]> {
		try {
			const cutoff = new Date();
			cutoff.setUTCDate(cutoff.getUTCDate() - daysBack);
			cutoff.setUTCHours(0, 0, 0, 0);

			const rows = await this.prisma.torBoxCdnDaily.findMany({
				where: { date: { gte: cutoff } },
				orderBy: { date: 'asc' },
			});

			return this.foldBuckets(
				rows.map((row) => ({
					time: row.date,
					okCount: row.okCount,
					failCount: row.failCount,
					latencySumMs: row.latencySumMs,
					latencyCount: row.latencyCount,
				}))
			);
		} catch (error: any) {
			if (isMissingTable(error)) return [];
			console.error('Failed to get TorBox CDN daily history:', error);
			return [];
		}
	}

	/**
	 * Per-region totals over the window, worst first. This is the half the live
	 * panel cannot show: whether a region has been flaky for everyone or only
	 * for the reader looking at it right now.
	 */
	public async getRegionSummary(hoursBack: number = 24): Promise<TorBoxCdnRegionSummary[]> {
		try {
			const cutoff = new Date();
			cutoff.setHours(cutoff.getHours() - hoursBack);

			const grouped = await this.prisma.torBoxCdnHourly.groupBy({
				by: ['region'],
				where: { hour: { gte: cutoff } },
				_sum: {
					okCount: true,
					failCount: true,
					latencySumMs: true,
					latencyCount: true,
				},
			});

			return grouped
				.map((row) => {
					const okCount = row._sum.okCount ?? 0;
					const failCount = row._sum.failCount ?? 0;
					return {
						region: row.region,
						okCount,
						failCount,
						rate: rateOf(okCount, failCount),
						avgLatencyMs: averageOf(
							row._sum.latencySumMs ?? 0,
							row._sum.latencyCount ?? 0
						),
					};
				})
				.sort((a, b) => a.rate - b.rate || a.region.localeCompare(b.region));
		} catch (error: any) {
			if (isMissingTable(error)) return [];
			console.error('Failed to get TorBox CDN region summary:', error);
			return [];
		}
	}

	/**
	 * Rolls one UTC day of hourly rows into daily ones. Idempotent, so the cron
	 * re-running over the same day is harmless.
	 */
	public async rollupDaily(targetDate?: Date): Promise<boolean> {
		const date = targetDate ?? new Date();
		const dayStart = new Date(date);
		dayStart.setUTCHours(0, 0, 0, 0);
		const dayEnd = new Date(dayStart);
		dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

		try {
			const rows = await this.prisma.torBoxCdnHourly.findMany({
				where: { hour: { gte: dayStart, lt: dayEnd } },
			});

			const byRegion = new Map<
				string,
				{
					okCount: number;
					failCount: number;
					latencySumMs: number;
					latencyCount: number;
					rates: number[];
				}
			>();

			for (const row of rows) {
				const existing = byRegion.get(row.region) ?? {
					okCount: 0,
					failCount: 0,
					latencySumMs: 0,
					latencyCount: 0,
					rates: [],
				};
				existing.okCount += row.okCount;
				existing.failCount += row.failCount;
				existing.latencySumMs += row.latencySumMs;
				existing.latencyCount += row.latencyCount;
				existing.rates.push(rateOf(row.okCount, row.failCount));
				byRegion.set(row.region, existing);
			}

			for (const [region, data] of byRegion) {
				const payload = {
					okCount: data.okCount,
					failCount: data.failCount,
					latencySumMs: data.latencySumMs,
					latencyCount: data.latencyCount,
					minRate: data.rates.length > 0 ? Math.min(...data.rates) : 0,
					maxRate: data.rates.length > 0 ? Math.max(...data.rates) : 0,
				};

				await this.prisma.torBoxCdnDaily.upsert({
					where: { date_region: { date: dayStart, region } },
					update: payload,
					create: { date: dayStart, region, ...payload },
				});
			}

			return true;
		} catch (error: any) {
			if (isMissingTable(error)) return false;
			console.error('Failed to rollup TorBox CDN daily:', error);
			return false;
		}
	}

	/** Drops hourly and daily rows older than 90 days. */
	public async cleanupOldData(): Promise<{ hourlyDeleted: number; dailyDeleted: number }> {
		try {
			const cutoff = new Date();
			cutoff.setUTCDate(cutoff.getUTCDate() - 90);

			const [hourly, daily] = await Promise.all([
				this.prisma.torBoxCdnHourly.deleteMany({ where: { hour: { lt: cutoff } } }),
				this.prisma.torBoxCdnDaily.deleteMany({ where: { date: { lt: cutoff } } }),
			]);

			return { hourlyDeleted: hourly.count, dailyDeleted: daily.count };
		} catch (error: any) {
			if (!isMissingTable(error)) {
				console.error('Failed to cleanup old TorBox CDN data:', error);
			}
			return { hourlyDeleted: 0, dailyDeleted: 0 };
		}
	}

	/** Collapses per-region rows sharing a bucket start into one point. */
	private foldBuckets(
		rows: Array<{
			time: Date;
			okCount: number;
			failCount: number;
			latencySumMs: number;
			latencyCount: number;
		}>
	): TorBoxCdnBucket[] {
		const byTime = new Map<
			string,
			{
				time: Date;
				okCount: number;
				failCount: number;
				latencySumMs: number;
				latencyCount: number;
			}
		>();

		for (const row of rows) {
			const key = row.time.toISOString();
			const existing = byTime.get(key);
			if (existing) {
				existing.okCount += row.okCount;
				existing.failCount += row.failCount;
				existing.latencySumMs += row.latencySumMs;
				existing.latencyCount += row.latencyCount;
			} else {
				byTime.set(key, { ...row });
			}
		}

		return Array.from(byTime.values())
			.sort((a, b) => a.time.getTime() - b.time.getTime())
			.map((bucket) => ({
				time: bucket.time,
				okCount: bucket.okCount,
				failCount: bucket.failCount,
				rate: rateOf(bucket.okCount, bucket.failCount),
				avgLatencyMs: averageOf(bucket.latencySumMs, bucket.latencyCount),
			}));
	}
}
