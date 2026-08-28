import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TorBoxCdnService } from './torboxCdn';

const prismaMock = vi.hoisted(() => ({
	torBoxCdnHourly: {
		upsert: vi.fn(),
		findMany: vi.fn(),
		groupBy: vi.fn(),
		deleteMany: vi.fn(),
	},
	torBoxCdnDaily: {
		upsert: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

function service() {
	return new TorBoxCdnService();
}

function hourlyRow(overrides: Record<string, unknown> = {}) {
	return {
		hour: new Date('2026-08-28T12:00:00Z'),
		region: 'ceur',
		okCount: 10,
		failCount: 0,
		latencySumMs: 500,
		latencyCount: 10,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	prismaMock.torBoxCdnHourly.upsert.mockResolvedValue({});
	prismaMock.torBoxCdnDaily.upsert.mockResolvedValue({});
});

describe('recordSamples', () => {
	it('increments the ok counter and the latency average for a serving region', async () => {
		await service().recordSamples([{ region: 'ceur', ok: true, latencyMs: 42 }]);

		const call = prismaMock.torBoxCdnHourly.upsert.mock.calls[0][0];
		expect(call.create).toMatchObject({
			region: 'ceur',
			okCount: 1,
			failCount: 0,
			latencySumMs: 42,
			latencyCount: 1,
		});
		expect(call.update).toMatchObject({
			okCount: { increment: 1 },
			latencySumMs: { increment: 42 },
			latencyCount: { increment: 1 },
		});
	});

	// Counting a timeout as its 8s ceiling would turn a dark region into a merely
	// slow one, which is the opposite of what the chart is for.
	it('records a failure without touching the latency average', async () => {
		await service().recordSamples([{ region: 'enam', ok: false, latencyMs: 8000 }]);

		const call = prismaMock.torBoxCdnHourly.upsert.mock.calls[0][0];
		expect(call.create).toMatchObject({ okCount: 0, failCount: 1, latencyCount: 0 });
		expect(call.update).toEqual({ failCount: { increment: 1 } });
	});

	it('ignores a non-finite latency on an otherwise good sample', async () => {
		await service().recordSamples([{ region: 'ceur', ok: true, latencyMs: Number.NaN }]);

		const call = prismaMock.torBoxCdnHourly.upsert.mock.calls[0][0];
		expect(call.create).toMatchObject({ okCount: 1, latencyCount: 0 });
		expect(call.update).toEqual({ okCount: { increment: 1 } });
	});

	it('buckets every sample into the current hour', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date('2026-08-28T12:34:56.789Z'));
		try {
			await service().recordSamples([{ region: 'ceur', ok: true, latencyMs: 10 }]);
			const call = prismaMock.torBoxCdnHourly.upsert.mock.calls[0][0];
			expect(call.create.hour.getMinutes()).toBe(0);
			expect(call.create.hour.getSeconds()).toBe(0);
			expect(call.create.hour.getMilliseconds()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('records the regions it can when one write fails', async () => {
		prismaMock.torBoxCdnHourly.upsert
			.mockRejectedValueOnce(new Error('deadlock'))
			.mockResolvedValueOnce({});

		const recorded = await service().recordSamples([
			{ region: 'ceur', ok: true, latencyMs: 10 },
			{ region: 'enam', ok: true, latencyMs: 20 },
		]);

		expect(recorded).toBe(1);
	});

	it('stops quietly when the table does not exist yet', async () => {
		prismaMock.torBoxCdnHourly.upsert.mockRejectedValue({ code: 'P2021' });

		await expect(
			service().recordSamples([{ region: 'ceur', ok: true, latencyMs: 10 }])
		).resolves.toBe(0);
	});

	it('does nothing for an empty run', async () => {
		await expect(service().recordSamples([])).resolves.toBe(0);
		expect(prismaMock.torBoxCdnHourly.upsert).not.toHaveBeenCalled();
	});
});

describe('getHourlyHistory', () => {
	it('folds the per-region rows of an hour into one point', async () => {
		prismaMock.torBoxCdnHourly.findMany.mockResolvedValue([
			hourlyRow({
				region: 'ceur',
				okCount: 8,
				failCount: 2,
				latencySumMs: 800,
				latencyCount: 8,
			}),
			hourlyRow({
				region: 'enam',
				okCount: 0,
				failCount: 10,
				latencySumMs: 0,
				latencyCount: 0,
			}),
		]);

		const [bucket] = await service().getHourlyHistory(24);

		expect(bucket.okCount).toBe(8);
		expect(bucket.failCount).toBe(12);
		expect(bucket.rate).toBeCloseTo(8 / 20);
		expect(bucket.avgLatencyMs).toBe(100);
	});

	it('returns the buckets oldest first', async () => {
		prismaMock.torBoxCdnHourly.findMany.mockResolvedValue([
			hourlyRow({ hour: new Date('2026-08-28T13:00:00Z') }),
			hourlyRow({ hour: new Date('2026-08-28T12:00:00Z') }),
		]);

		const buckets = await service().getHourlyHistory();

		expect(buckets.map((b) => b.time.toISOString())).toEqual([
			'2026-08-28T12:00:00.000Z',
			'2026-08-28T13:00:00.000Z',
		]);
	});

	it('reports no latency for a bucket where nothing served bytes', async () => {
		prismaMock.torBoxCdnHourly.findMany.mockResolvedValue([
			hourlyRow({ okCount: 0, failCount: 5, latencySumMs: 0, latencyCount: 0 }),
		]);

		const [bucket] = await service().getHourlyHistory();

		expect(bucket.rate).toBe(0);
		expect(bucket.avgLatencyMs).toBeNull();
	});

	it('returns nothing when the table is missing', async () => {
		prismaMock.torBoxCdnHourly.findMany.mockRejectedValue({ code: 'P2021' });

		await expect(service().getHourlyHistory()).resolves.toEqual([]);
	});
});

describe('getDailyHistory', () => {
	it('reads the rollup table and folds it the same way', async () => {
		prismaMock.torBoxCdnDaily.findMany.mockResolvedValue([
			{
				date: new Date('2026-08-27T00:00:00Z'),
				region: 'ceur',
				okCount: 90,
				failCount: 10,
				latencySumMs: 9000,
				latencyCount: 90,
			},
		]);

		const [bucket] = await service().getDailyHistory(30);

		expect(bucket.rate).toBeCloseTo(0.9);
		expect(bucket.avgLatencyMs).toBe(100);
	});

	it('returns nothing when the table is missing', async () => {
		prismaMock.torBoxCdnDaily.findMany.mockRejectedValue({ code: 'P2021' });

		await expect(service().getDailyHistory()).resolves.toEqual([]);
	});
});

describe('getRegionSummary', () => {
	it('sorts the worst-served regions first', async () => {
		prismaMock.torBoxCdnHourly.groupBy.mockResolvedValue([
			{
				region: 'ceur',
				_sum: { okCount: 100, failCount: 0, latencySumMs: 5000, latencyCount: 100 },
			},
			{
				region: 'enam',
				_sum: { okCount: 0, failCount: 40, latencySumMs: 0, latencyCount: 0 },
			},
			{
				region: 'apac',
				_sum: { okCount: 50, failCount: 50, latencySumMs: 25000, latencyCount: 50 },
			},
		]);

		const summary = await service().getRegionSummary(24);

		expect(summary.map((r) => r.region)).toEqual(['enam', 'apac', 'ceur']);
		expect(summary[0]).toMatchObject({ rate: 0, avgLatencyMs: null });
		expect(summary[2]).toMatchObject({ rate: 1, avgLatencyMs: 50 });
	});

	it('treats absent sums as zero rather than crashing', async () => {
		prismaMock.torBoxCdnHourly.groupBy.mockResolvedValue([{ region: 'ceur', _sum: {} }]);

		await expect(service().getRegionSummary()).resolves.toEqual([
			{ region: 'ceur', okCount: 0, failCount: 0, rate: 0, avgLatencyMs: null },
		]);
	});

	it('returns nothing when the table is missing', async () => {
		prismaMock.torBoxCdnHourly.groupBy.mockRejectedValue({ code: 'P2021' });

		await expect(service().getRegionSummary()).resolves.toEqual([]);
	});
});

describe('rollupDaily', () => {
	it('sums a day of hourly rows per region and keeps the rate spread', async () => {
		prismaMock.torBoxCdnHourly.findMany.mockResolvedValue([
			hourlyRow({ hour: new Date('2026-08-27T01:00:00Z'), okCount: 10, failCount: 0 }),
			hourlyRow({
				hour: new Date('2026-08-27T02:00:00Z'),
				okCount: 5,
				failCount: 5,
				latencySumMs: 250,
				latencyCount: 5,
			}),
		]);

		await expect(service().rollupDaily(new Date('2026-08-27T09:00:00Z'))).resolves.toBe(true);

		const call = prismaMock.torBoxCdnDaily.upsert.mock.calls[0][0];
		expect(call.where.date_region).toEqual({
			date: new Date('2026-08-27T00:00:00Z'),
			region: 'ceur',
		});
		expect(call.update).toMatchObject({
			okCount: 15,
			failCount: 5,
			latencySumMs: 750,
			latencyCount: 15,
			minRate: 0.5,
			maxRate: 1,
		});
	});

	it('is a no-op that still succeeds when the day has no rows', async () => {
		prismaMock.torBoxCdnHourly.findMany.mockResolvedValue([]);

		await expect(service().rollupDaily()).resolves.toBe(true);
		expect(prismaMock.torBoxCdnDaily.upsert).not.toHaveBeenCalled();
	});

	it('reports failure when the table is missing', async () => {
		prismaMock.torBoxCdnHourly.findMany.mockRejectedValue({ code: 'P2021' });

		await expect(service().rollupDaily()).resolves.toBe(false);
	});
});

describe('cleanupOldData', () => {
	it('reports what it deleted from both tables', async () => {
		prismaMock.torBoxCdnHourly.deleteMany.mockResolvedValue({ count: 7 });
		prismaMock.torBoxCdnDaily.deleteMany.mockResolvedValue({ count: 3 });

		await expect(service().cleanupOldData()).resolves.toEqual({
			hourlyDeleted: 7,
			dailyDeleted: 3,
		});
	});

	it('reports nothing deleted when the tables are missing', async () => {
		prismaMock.torBoxCdnHourly.deleteMany.mockRejectedValue({ code: 'P2021' });
		prismaMock.torBoxCdnDaily.deleteMany.mockRejectedValue({ code: 'P2021' });

		await expect(service().cleanupOldData()).resolves.toEqual({
			hourlyDeleted: 0,
			dailyDeleted: 0,
		});
	});
});
