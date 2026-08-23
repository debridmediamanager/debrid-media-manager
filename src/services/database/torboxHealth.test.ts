import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { TorBoxHealthService } from './torboxHealth';

const prismaMock = vi.hoisted(() => ({
	torBoxCdnHealth: {
		upsert: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	torBoxCheckResult: {
		create: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	torBoxHealthHourly: {
		findUnique: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	torBoxHealthDaily: {
		upsert: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	$transaction: vi.fn(),
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

function node(overrides: Partial<Parameters<TorBoxHealthService['upsertCdnResults']>[0][0]> = {}) {
	return {
		host: 'nexus-067.ceur.tb-cdn.st',
		region: 'ceur',
		name: 'nexus-067',
		status: 206,
		latencyMs: 100,
		ok: true,
		error: null,
		checkedAt: new Date('2026-08-23T10:00:00Z'),
		...overrides,
	};
}

describe('TorBoxHealthService', () => {
	let service: TorBoxHealthService;

	beforeEach(() => {
		service = new TorBoxHealthService();
		for (const model of [
			prismaMock.torBoxCdnHealth,
			prismaMock.torBoxCheckResult,
			prismaMock.torBoxHealthHourly,
			prismaMock.torBoxHealthDaily,
		]) {
			Object.values(model).forEach((fn) => (fn as Mock).mockReset());
		}
		(prismaMock.$transaction as Mock).mockReset();
		(prismaMock.$transaction as Mock).mockResolvedValue([]);
	});

	describe('upsertCdnResults', () => {
		it('does nothing for an empty list', async () => {
			await service.upsertCdnResults([]);
			expect(prismaMock.$transaction).not.toHaveBeenCalled();
		});

		it('upserts every node in one transaction', async () => {
			await service.upsertCdnResults([node(), node({ host: 'b', region: 'japn' })]);

			expect(prismaMock.$transaction).toHaveBeenCalledOnce();
			expect(prismaMock.torBoxCdnHealth.upsert).toHaveBeenCalledTimes(2);
		});

		it('swallows a missing table rather than throwing', async () => {
			(prismaMock.$transaction as Mock).mockRejectedValue({ code: 'P2021' });

			await expect(service.upsertCdnResults([node()])).resolves.toBeUndefined();
		});
	});

	describe('deleteDeprecatedNodes', () => {
		// Guards against wiping every row when discovery returned nothing.
		it('refuses to delete when given no valid hosts', async () => {
			await expect(service.deleteDeprecatedNodes([])).resolves.toBe(0);
			expect(prismaMock.torBoxCdnHealth.deleteMany).not.toHaveBeenCalled();
		});

		it('deletes hosts outside the current list', async () => {
			(prismaMock.torBoxCdnHealth.deleteMany as Mock).mockResolvedValue({ count: 3 });

			await expect(service.deleteDeprecatedNodes(['a', 'b'])).resolves.toBe(3);
			expect(prismaMock.torBoxCdnHealth.deleteMany).toHaveBeenCalledWith({
				where: { host: { notIn: ['a', 'b'] } },
			});
		});
	});

	describe('getCdnMetrics', () => {
		it('returns zeroed metrics with no rows', async () => {
			(prismaMock.torBoxCdnHealth.findMany as Mock).mockResolvedValue([]);

			await expect(service.getCdnMetrics()).resolves.toEqual({
				total: 0,
				working: 0,
				rate: 0,
				lastChecked: null,
				avgLatencyMs: null,
				fastestNode: null,
				failedNodes: [],
			});
		});

		it('averages latency over working nodes only', async () => {
			(prismaMock.torBoxCdnHealth.findMany as Mock).mockResolvedValue([
				node({ host: 'fast', latencyMs: 100 }),
				node({ host: 'slow', latencyMs: 300 }),
				node({ host: 'dead', ok: false, latencyMs: null, error: 'Timeout' }),
			]);

			const metrics = await service.getCdnMetrics();

			expect(metrics.total).toBe(3);
			expect(metrics.working).toBe(2);
			expect(metrics.rate).toBeCloseTo(2 / 3);
			expect(metrics.avgLatencyMs).toBe(200);
			expect(metrics.fastestNode).toBe('fast');
			expect(metrics.failedNodes).toEqual(['dead']);
		});

		it('reports the newest checkedAt as lastChecked', async () => {
			(prismaMock.torBoxCdnHealth.findMany as Mock).mockResolvedValue([
				node({ host: 'a', checkedAt: new Date('2026-08-23T10:00:00Z') }),
				node({ host: 'b', checkedAt: new Date('2026-08-23T10:05:00Z') }),
			]);

			const metrics = await service.getCdnMetrics();

			expect(metrics.lastChecked).toBe(new Date('2026-08-23T10:05:00Z').getTime());
		});
	});

	describe('recordHealthSnapshot', () => {
		it('creates the hour bucket on the first check', async () => {
			(prismaMock.torBoxHealthHourly.findUnique as Mock).mockResolvedValue(null);

			await service.recordHealthSnapshot({
				totalNodes: 10,
				workingNodes: 8,
				apiOk: true,
				avgLatencyMs: 200,
				minLatencyMs: 100,
				maxLatencyMs: 300,
				fastestNode: 'fast',
				failedNodes: ['x', 'y'],
			});

			expect(prismaMock.torBoxHealthHourly.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						totalNodes: 10,
						workingNodes: 8,
						workingRate: 0.8,
						apiSuccessCount: 1,
						apiTotalCount: 1,
						apiSuccessRate: 1,
						checksInHour: 1,
						failedNodes: ['x', 'y'],
					}),
				})
			);
		});

		// Two checks in one hour must average, not overwrite.
		it('merges a second check into the same hour', async () => {
			(prismaMock.torBoxHealthHourly.findUnique as Mock).mockResolvedValue({
				workingRate: 1,
				apiSuccessCount: 1,
				apiTotalCount: 1,
				apiSuccessRate: 1,
				avgLatencyMs: 100,
				minLatencyMs: 100,
				maxLatencyMs: 100,
				fastestNode: 'fast',
				checksInHour: 1,
			});

			await service.recordHealthSnapshot({
				totalNodes: 10,
				workingNodes: 5,
				apiOk: false,
				avgLatencyMs: 300,
				minLatencyMs: 50,
				maxLatencyMs: 400,
				fastestNode: 'other',
				failedNodes: ['a'],
			});

			const data = (prismaMock.torBoxHealthHourly.update as Mock).mock.calls[0][0].data;
			expect(data.checksInHour).toBe(2);
			expect(data.workingRate).toBeCloseTo(0.75);
			expect(data.apiSuccessRate).toBeCloseTo(0.5);
			expect(data.avgLatencyMs).toBe(200);
			expect(data.minLatencyMs).toBe(50);
			expect(data.maxLatencyMs).toBe(400);
		});

		it('keeps the stored latency when a run measured none', async () => {
			(prismaMock.torBoxHealthHourly.findUnique as Mock).mockResolvedValue({
				workingRate: 1,
				apiSuccessCount: 1,
				apiTotalCount: 1,
				apiSuccessRate: 1,
				avgLatencyMs: 150,
				minLatencyMs: 150,
				maxLatencyMs: 150,
				fastestNode: 'fast',
				checksInHour: 1,
			});

			await service.recordHealthSnapshot({
				totalNodes: 10,
				workingNodes: 0,
				apiOk: true,
				avgLatencyMs: null,
				minLatencyMs: null,
				maxLatencyMs: null,
				fastestNode: null,
				failedNodes: [],
			});

			const data = (prismaMock.torBoxHealthHourly.update as Mock).mock.calls[0][0].data;
			expect(data.avgLatencyMs).toBe(150);
			expect(data.fastestNode).toBe('fast');
		});
	});

	describe('rollupDaily', () => {
		it('returns false when the day has no hourly rows', async () => {
			(prismaMock.torBoxHealthHourly.findMany as Mock).mockResolvedValue([]);

			await expect(service.rollupDaily(new Date('2026-08-22T00:00:00Z'))).resolves.toBe(
				false
			);
			expect(prismaMock.torBoxHealthDaily.upsert).not.toHaveBeenCalled();
		});

		// An hour holding 11 checks must outweigh an hour holding 1.
		it('weights each hour by how many checks it holds', async () => {
			(prismaMock.torBoxHealthHourly.findMany as Mock).mockResolvedValue([
				{
					workingRate: 1,
					apiSuccessRate: 1,
					avgLatencyMs: 100,
					checksInHour: 11,
				},
				{
					workingRate: 0,
					apiSuccessRate: 0,
					avgLatencyMs: 500,
					checksInHour: 1,
				},
			]);

			await expect(service.rollupDaily(new Date('2026-08-22T00:00:00Z'))).resolves.toBe(true);

			const row = (prismaMock.torBoxHealthDaily.upsert as Mock).mock.calls[0][0].create;
			expect(row.checksCount).toBe(12);
			expect(row.avgWorkingRate).toBeCloseTo(11 / 12);
			expect(row.minWorkingRate).toBe(0);
			expect(row.maxWorkingRate).toBe(1);
			expect(row.avgLatencyMs).toBeCloseTo((100 * 11 + 500) / 12);
		});

		it('ignores hours with no latency when averaging latency', async () => {
			(prismaMock.torBoxHealthHourly.findMany as Mock).mockResolvedValue([
				{ workingRate: 1, apiSuccessRate: 1, avgLatencyMs: 200, checksInHour: 1 },
				{ workingRate: 0, apiSuccessRate: 1, avgLatencyMs: null, checksInHour: 1 },
			]);

			await service.rollupDaily(new Date('2026-08-22T00:00:00Z'));

			const row = (prismaMock.torBoxHealthDaily.upsert as Mock).mock.calls[0][0].create;
			expect(row.avgLatencyMs).toBe(200);
		});
	});

	describe('getRecentChecks', () => {
		it('maps stored rows into the check shape', async () => {
			(prismaMock.torBoxCheckResult.findMany as Mock).mockResolvedValue([
				{
					apiOk: true,
					apiLatencyMs: 42,
					apiDetail: 'API is running.',
					authState: 'credentials',
					authError: 'AUTH_ERROR',
					totalNodes: 17,
					workingNodes: 17,
					checkedAt: new Date('2026-08-23T10:00:00Z'),
				},
			]);

			const checks = await service.getRecentChecks(5);

			expect(checks).toHaveLength(1);
			expect(checks[0].authState).toBe('credentials');
			expect(checks[0].workingNodes).toBe(17);
		});

		it('degrades to an empty list on a database error', async () => {
			(prismaMock.torBoxCheckResult.findMany as Mock).mockRejectedValue({ code: 'P2021' });

			await expect(service.getRecentChecks()).resolves.toEqual([]);
		});
	});

	describe('cleanupOldData', () => {
		it('reports what each table dropped', async () => {
			(prismaMock.torBoxHealthHourly.deleteMany as Mock).mockResolvedValue({ count: 4 });
			(prismaMock.torBoxHealthDaily.deleteMany as Mock).mockResolvedValue({ count: 2 });
			(prismaMock.torBoxCheckResult.deleteMany as Mock).mockResolvedValue({ count: 9 });

			await expect(service.cleanupOldData()).resolves.toEqual({
				hourlyDeleted: 4,
				dailyDeleted: 2,
				checkResultsDeleted: 9,
			});
		});

		it('survives tables that do not exist yet', async () => {
			(prismaMock.torBoxHealthHourly.deleteMany as Mock).mockRejectedValue(
				new Error('does not exist')
			);
			(prismaMock.torBoxHealthDaily.deleteMany as Mock).mockRejectedValue(
				new Error('does not exist')
			);
			(prismaMock.torBoxCheckResult.deleteMany as Mock).mockRejectedValue(
				new Error('does not exist')
			);

			await expect(service.cleanupOldData()).resolves.toEqual({
				hourlyDeleted: 0,
				dailyDeleted: 0,
				checkResultsDeleted: 0,
			});
		});
	});
});
