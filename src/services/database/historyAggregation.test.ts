import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HistoryAggregationService } from './historyAggregation';

const rdCleanupMock = vi.hoisted(() => vi.fn());

vi.mock('./rdOperational', () => ({
	RdOperationalService: class {
		cleanupOldData = rdCleanupMock;
		rollupDaily = vi.fn().mockResolvedValue(undefined);
	},
}));

const prismaMock = vi.hoisted(() => ({
	streamHealthHourly: {
		findUnique: vi.fn(),
		findMany: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		deleteMany: vi.fn(),
	},
	streamHealthDaily: {
		upsert: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	serverReliabilityDaily: {
		findUnique: vi.fn(),
		findMany: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		deleteMany: vi.fn(),
		groupBy: vi.fn(),
	},
	torrentioHealthHourly: {
		findUnique: vi.fn(),
		findMany: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		deleteMany: vi.fn(),
	},
	torrentioHealthDaily: {
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

describe('HistoryAggregationService', () => {
	let service: HistoryAggregationService;

	beforeEach(() => {
		service = new HistoryAggregationService();
		Object.values(prismaMock.streamHealthHourly).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.streamHealthDaily).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.serverReliabilityDaily).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.torrentioHealthHourly).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.torrentioHealthDaily).forEach((fn) => (fn as Mock).mockReset());
		rdCleanupMock.mockReset();
	});

	describe('recordStreamHealthSnapshot', () => {
		const snapshotData = {
			totalServers: 10,
			workingServers: 8,
			avgLatencyMs: 100,
			minLatencyMs: 50,
			maxLatencyMs: 200,
			fastestServer: 'server1',
			failedServers: ['server9', 'server10'],
		};

		it('creates a new hourly record when none exists', async () => {
			prismaMock.streamHealthHourly.findUnique.mockResolvedValue(null);
			prismaMock.streamHealthHourly.create.mockResolvedValue({});

			await service.recordStreamHealthSnapshot(snapshotData);

			expect(prismaMock.streamHealthHourly.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					totalServers: 10,
					workingServers: 8,
					workingRate: 0.8,
					checksInHour: 1,
					failedServers: ['server9', 'server10'],
				}),
			});
		});

		it('merges with existing hourly record', async () => {
			prismaMock.streamHealthHourly.findUnique.mockResolvedValue({
				hour: new Date(),
				totalServers: 10,
				workingServers: 9,
				workingRate: 0.9,
				avgLatencyMs: 80,
				minLatencyMs: 40,
				maxLatencyMs: 150,
				fastestServer: 'server2',
				checksInHour: 2,
				failedServers: ['server10'],
			});
			prismaMock.streamHealthHourly.update.mockResolvedValue({});

			await service.recordStreamHealthSnapshot(snapshotData);

			expect(prismaMock.streamHealthHourly.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						checksInHour: 3,
						minLatencyMs: 40,
						maxLatencyMs: 200,
						failedServers: expect.arrayContaining(['server9', 'server10']),
					}),
				})
			);
		});

		it('handles P2021 error silently', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.streamHealthHourly.findUnique.mockRejectedValue({ code: 'P2021' });

			await expect(service.recordStreamHealthSnapshot(snapshotData)).resolves.toBeUndefined();
			consoleSpy.mockRestore();
		});

		it('handles zero total servers', async () => {
			prismaMock.streamHealthHourly.findUnique.mockResolvedValue(null);
			prismaMock.streamHealthHourly.create.mockResolvedValue({});

			await service.recordStreamHealthSnapshot({
				...snapshotData,
				totalServers: 0,
				workingServers: 0,
			});

			expect(prismaMock.streamHealthHourly.create).toHaveBeenCalledWith({
				data: expect.objectContaining({ workingRate: 0 }),
			});
		});
	});

	describe('recordServerReliability', () => {
		it('creates new reliability records', async () => {
			prismaMock.serverReliabilityDaily.findUnique.mockResolvedValue(null);
			prismaMock.serverReliabilityDaily.create.mockResolvedValue({});

			await service.recordServerReliability([
				{ host: 's1', ok: true, latencyMs: 100 },
				{ host: 's2', ok: false, latencyMs: null },
			]);

			expect(prismaMock.serverReliabilityDaily.create).toHaveBeenCalledTimes(2);
			expect(prismaMock.serverReliabilityDaily.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					host: 's1',
					successCount: 1,
					reliability: 1,
					avgLatencyMs: 100,
				}),
			});
			expect(prismaMock.serverReliabilityDaily.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					host: 's2',
					successCount: 0,
					reliability: 0,
					avgLatencyMs: null,
				}),
			});
		});

		it('updates existing reliability records', async () => {
			prismaMock.serverReliabilityDaily.findUnique.mockResolvedValue({
				id: 1,
				checksCount: 4,
				successCount: 3,
				avgLatencyMs: 100,
			});
			prismaMock.serverReliabilityDaily.update.mockResolvedValue({});

			await service.recordServerReliability([{ host: 's1', ok: true, latencyMs: 200 }]);

			expect(prismaMock.serverReliabilityDaily.update).toHaveBeenCalledWith({
				where: { id: 1 },
				data: expect.objectContaining({
					checksCount: 5,
					successCount: 4,
					reliability: 0.8,
				}),
			});
		});

		it('handles P2021 error silently', async () => {
			prismaMock.serverReliabilityDaily.findUnique.mockRejectedValue({ code: 'P2021' });

			await expect(
				service.recordServerReliability([{ host: 's1', ok: true, latencyMs: 100 }])
			).resolves.toBeUndefined();
		});
	});

	describe('rollupStreamDaily', () => {
		it('returns false when no hourly data', async () => {
			prismaMock.streamHealthHourly.findMany.mockResolvedValue([]);

			expect(await service.rollupStreamDaily(new Date('2024-01-01'))).toBe(false);
		});

		it('creates daily aggregate from hourly data', async () => {
			prismaMock.streamHealthHourly.findMany.mockResolvedValue([
				{
					hour: new Date('2024-01-01T10:00:00Z'),
					totalServers: 10,
					workingServers: 8,
					workingRate: 0.8,
					avgLatencyMs: 100,
					checksInHour: 2,
				},
				{
					hour: new Date('2024-01-01T14:00:00Z'),
					totalServers: 10,
					workingServers: 10,
					workingRate: 1.0,
					avgLatencyMs: 80,
					checksInHour: 3,
				},
			]);
			prismaMock.serverReliabilityDaily.findMany.mockResolvedValue([
				{ reliability: 1 },
				{ reliability: 0 },
				{ reliability: 0.5 },
			]);
			prismaMock.streamHealthDaily.upsert.mockResolvedValue({});

			const result = await service.rollupStreamDaily(new Date('2024-01-01'));

			expect(result).toBe(true);
			expect(prismaMock.streamHealthDaily.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					create: expect.objectContaining({
						checksCount: 5,
						alwaysWorking: 1,
						neverWorking: 1,
						flaky: 1,
						minWorkingRate: 0.8,
						maxWorkingRate: 1.0,
					}),
				})
			);
		});

		it('returns false on P2021 error', async () => {
			prismaMock.streamHealthHourly.findMany.mockRejectedValue({ code: 'P2021' });

			expect(await service.rollupStreamDaily()).toBe(false);
		});
	});

	describe('cleanupOldData', () => {
		it('cleans up all tables', async () => {
			prismaMock.streamHealthHourly.deleteMany.mockResolvedValue({ count: 10 });
			prismaMock.streamHealthDaily.deleteMany.mockResolvedValue({ count: 5 });
			prismaMock.serverReliabilityDaily.deleteMany.mockResolvedValue({ count: 3 });
			prismaMock.torrentioHealthHourly.deleteMany.mockResolvedValue({ count: 7 });
			prismaMock.torrentioHealthDaily.deleteMany.mockResolvedValue({ count: 2 });
			rdCleanupMock.mockResolvedValue({ hourlyDeleted: 4, dailyDeleted: 1 });

			const result = await service.cleanupOldData();

			expect(result.streamHourlyDeleted).toBe(10);
			expect(result.streamDailyDeleted).toBe(5);
			expect(result.serverReliabilityDeleted).toBe(3);
			expect(result.rdHourlyDeleted).toBe(4);
			expect(result.rdDailyDeleted).toBe(1);
			expect(result.torrentioHourlyDeleted).toBe(7);
			expect(result.torrentioDailyDeleted).toBe(2);
		});

		it('returns partial results when some tables do not exist', async () => {
			prismaMock.streamHealthHourly.deleteMany.mockResolvedValue({ count: 1 });
			prismaMock.streamHealthDaily.deleteMany.mockResolvedValue({ count: 0 });
			prismaMock.serverReliabilityDaily.deleteMany.mockResolvedValue({ count: 0 });
			rdCleanupMock.mockResolvedValue({ hourlyDeleted: 0, dailyDeleted: 0 });
			prismaMock.torrentioHealthHourly.deleteMany.mockRejectedValue(
				new Error('table not exist')
			);
			prismaMock.torrentioHealthDaily.deleteMany.mockRejectedValue(
				new Error('table not exist')
			);

			const result = await service.cleanupOldData();

			expect(result.streamHourlyDeleted).toBe(1);
			expect(result.torrentioHourlyDeleted).toBe(0);
			expect(result.torrentioDailyDeleted).toBe(0);
		});
	});

	describe('getStreamHourlyHistory', () => {
		it('returns mapped hourly data', async () => {
			const hour = new Date();
			prismaMock.streamHealthHourly.findMany.mockResolvedValue([
				{
					hour,
					totalServers: 10,
					workingServers: 9,
					workingRate: 0.9,
					avgLatencyMs: 100,
					minLatencyMs: 50,
					maxLatencyMs: 200,
					fastestServer: 's1',
					checksInHour: 3,
					failedServers: ['s10'],
				},
			]);

			const result = await service.getStreamHourlyHistory(24);

			expect(result).toHaveLength(1);
			expect(result[0].totalServers).toBe(10);
			expect(result[0].failedServers).toEqual(['s10']);
		});

		it('returns empty on Prisma error', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.streamHealthHourly.findMany.mockRejectedValue({
				code: 'P2021',
				message: 'does not exist',
			});

			expect(await service.getStreamHourlyHistory()).toEqual([]);
			consoleSpy.mockRestore();
		});
	});

	describe('getStreamDailyHistory', () => {
		it('returns mapped daily data', async () => {
			const date = new Date();
			prismaMock.streamHealthDaily.findMany.mockResolvedValue([
				{
					date,
					avgWorkingRate: 0.95,
					minWorkingRate: 0.8,
					maxWorkingRate: 1.0,
					avgLatencyMs: 90,
					checksCount: 48,
					alwaysWorking: 8,
					neverWorking: 1,
					flaky: 1,
				},
			]);

			const result = await service.getStreamDailyHistory(90);

			expect(result).toHaveLength(1);
			expect(result[0].avgWorkingRate).toBe(0.95);
		});

		it('returns empty on Prisma error', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.streamHealthDaily.findMany.mockRejectedValue({
				code: 'P2021',
				message: 'does not exist',
			});

			expect(await service.getStreamDailyHistory()).toEqual([]);
			consoleSpy.mockRestore();
		});
	});

	describe('getServerReliability', () => {
		it('returns aggregated server reliability sorted by reliability', async () => {
			prismaMock.serverReliabilityDaily.groupBy.mockResolvedValue([
				{
					host: 's1',
					_sum: { checksCount: 100, successCount: 95 },
					_avg: { avgLatencyMs: 80 },
				},
				{
					host: 's2',
					_sum: { checksCount: 50, successCount: 25 },
					_avg: { avgLatencyMs: 200 },
				},
			]);

			const result = await service.getServerReliability(7, 'reliability');

			expect(result).toHaveLength(2);
			expect(result[0].host).toBe('s1');
			expect(result[0].reliability).toBeCloseTo(0.95);
			expect(result[1].reliability).toBe(0.5);
		});

		it('sorts by latency when requested', async () => {
			prismaMock.serverReliabilityDaily.groupBy.mockResolvedValue([
				{
					host: 's1',
					_sum: { checksCount: 10, successCount: 10 },
					_avg: { avgLatencyMs: 200 },
				},
				{
					host: 's2',
					_sum: { checksCount: 10, successCount: 10 },
					_avg: { avgLatencyMs: 50 },
				},
			]);

			const result = await service.getServerReliability(7, 'latency');

			expect(result[0].host).toBe('s2');
		});

		it('returns empty on Prisma error', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.serverReliabilityDaily.groupBy.mockRejectedValue({
				code: 'P2021',
				message: 'does not exist',
			});

			expect(await service.getServerReliability()).toEqual([]);
			consoleSpy.mockRestore();
		});
	});

	describe('recordTorrentioHealthSnapshot', () => {
		it('creates a new record when none exists', async () => {
			prismaMock.torrentioHealthHourly.findUnique.mockResolvedValue(null);
			prismaMock.torrentioHealthHourly.create.mockResolvedValue({});

			await service.recordTorrentioHealthSnapshot({ ok: true, latencyMs: 200 });

			expect(prismaMock.torrentioHealthHourly.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					successCount: 1,
					totalCount: 1,
					successRate: 1,
					avgLatencyMs: 200,
				}),
			});
		});

		it('merges with existing record', async () => {
			prismaMock.torrentioHealthHourly.findUnique.mockResolvedValue({
				hour: new Date(),
				successCount: 3,
				totalCount: 4,
				successRate: 0.75,
				avgLatencyMs: 100,
			});
			prismaMock.torrentioHealthHourly.update.mockResolvedValue({});

			await service.recordTorrentioHealthSnapshot({ ok: false, latencyMs: 300 });

			expect(prismaMock.torrentioHealthHourly.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						successCount: 3,
						totalCount: 5,
						successRate: 0.6,
					}),
				})
			);
		});

		it('handles P2021 error silently', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.torrentioHealthHourly.findUnique.mockRejectedValue({ code: 'P2021' });

			await expect(
				service.recordTorrentioHealthSnapshot({ ok: true, latencyMs: 100 })
			).resolves.toBeUndefined();
			consoleSpy.mockRestore();
		});
	});

	describe('getTorrentioHourlyHistory', () => {
		it('returns mapped data', async () => {
			const hour = new Date();
			prismaMock.torrentioHealthHourly.findMany.mockResolvedValue([
				{ hour, successCount: 5, totalCount: 6, successRate: 0.833, avgLatencyMs: 150 },
			]);

			const result = await service.getTorrentioHourlyHistory(24);

			expect(result).toHaveLength(1);
			expect(result[0].successRate).toBeCloseTo(0.833);
		});

		it('returns empty on Prisma error', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.torrentioHealthHourly.findMany.mockRejectedValue({
				code: 'P2021',
				message: 'does not exist',
			});

			expect(await service.getTorrentioHourlyHistory()).toEqual([]);
			consoleSpy.mockRestore();
		});
	});

	describe('getTorrentioDailyHistory', () => {
		it('returns mapped data', async () => {
			const date = new Date();
			prismaMock.torrentioHealthDaily.findMany.mockResolvedValue([
				{
					date,
					avgSuccessRate: 0.95,
					minSuccessRate: 0.8,
					maxSuccessRate: 1.0,
					avgLatencyMs: 120,
					checksCount: 100,
				},
			]);

			const result = await service.getTorrentioDailyHistory(90);

			expect(result).toHaveLength(1);
			expect(result[0].avgSuccessRate).toBe(0.95);
		});
	});

	describe('rollupTorrentioDaily', () => {
		it('returns false when no hourly data', async () => {
			prismaMock.torrentioHealthHourly.findMany.mockResolvedValue([]);

			expect(await service.rollupTorrentioDaily(new Date())).toBe(false);
		});

		it('creates daily aggregate from hourly data', async () => {
			prismaMock.torrentioHealthHourly.findMany.mockResolvedValue([
				{
					hour: new Date('2024-01-01T10:00:00Z'),
					successCount: 5,
					totalCount: 6,
					successRate: 5 / 6,
					avgLatencyMs: 100,
				},
				{
					hour: new Date('2024-01-01T14:00:00Z'),
					successCount: 4,
					totalCount: 4,
					successRate: 1.0,
					avgLatencyMs: 80,
				},
			]);
			prismaMock.torrentioHealthDaily.upsert.mockResolvedValue({});

			const result = await service.rollupTorrentioDaily(new Date('2024-01-01'));

			expect(result).toBe(true);
			expect(prismaMock.torrentioHealthDaily.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					create: expect.objectContaining({
						checksCount: 10,
						minSuccessRate: 5 / 6,
						maxSuccessRate: 1.0,
					}),
				})
			);
		});
	});

	describe('runAggregation', () => {
		it('returns streamHealthRecorded as false', async () => {
			const result = await service.runAggregation();
			expect(result.streamHealthRecorded).toBe(false);
		});
	});

	describe('runDailyRollup', () => {
		it('runs all rollup tasks', async () => {
			prismaMock.streamHealthHourly.findMany.mockResolvedValue([]);
			prismaMock.torrentioHealthHourly.findMany.mockResolvedValue([]);

			const result = await service.runDailyRollup(new Date('2024-01-01'));

			expect(result).toEqual({
				streamDailyRolled: false,
				rdDailyRolled: true,
				torrentioDailyRolled: false,
			});
		});
	});
});
