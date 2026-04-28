import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { RdOperationalService, resolveRealDebridOperation } from './rdOperational';

const prismaMock = vi.hoisted(() => ({
	rdOperationalHourly: {
		upsert: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	rdOperationalDaily: {
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

describe('resolveRealDebridOperation', () => {
	it('resolves GET /user', () => {
		expect(resolveRealDebridOperation('GET', '/api/v2/user')).toBe('GET /user');
	});

	it('resolves GET /torrents', () => {
		expect(resolveRealDebridOperation('GET', '/api/v2/torrents')).toBe('GET /torrents');
	});

	it('resolves GET /torrents/info/{id}', () => {
		expect(resolveRealDebridOperation('GET', '/api/v2/torrents/info/abc123')).toBe(
			'GET /torrents/info/{id}'
		);
	});

	it('resolves POST /torrents/addMagnet', () => {
		expect(resolveRealDebridOperation('POST', '/api/v2/torrents/addMagnet')).toBe(
			'POST /torrents/addMagnet'
		);
	});

	it('resolves POST /torrents/selectFiles/{id}', () => {
		expect(resolveRealDebridOperation('POST', '/api/v2/torrents/selectFiles/abc')).toBe(
			'POST /torrents/selectFiles/{id}'
		);
	});

	it('resolves DELETE /torrents/delete/{id}', () => {
		expect(resolveRealDebridOperation('DELETE', '/api/v2/torrents/delete/abc')).toBe(
			'DELETE /torrents/delete/{id}'
		);
	});

	it('resolves POST /unrestrict/link', () => {
		expect(resolveRealDebridOperation('POST', '/api/v2/unrestrict/link')).toBe(
			'POST /unrestrict/link'
		);
	});

	it('returns null for unknown paths', () => {
		expect(resolveRealDebridOperation('GET', '/api/v2/unknown')).toBeNull();
	});

	it('returns null when method is undefined', () => {
		expect(resolveRealDebridOperation(undefined, '/api/v2/user')).toBeNull();
	});

	it('is case-insensitive for method', () => {
		expect(resolveRealDebridOperation('get', '/api/v2/user')).toBe('GET /user');
	});
});

describe('RdOperationalService', () => {
	let service: RdOperationalService;

	beforeEach(() => {
		service = new RdOperationalService();
		Object.values(prismaMock.rdOperationalHourly).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.rdOperationalDaily).forEach((fn) => (fn as Mock).mockReset());
	});

	describe('recordOperation', () => {
		it('upserts with success increment for 2xx status', async () => {
			prismaMock.rdOperationalHourly.upsert.mockResolvedValue({});

			await service.recordOperation('GET /user', 200);

			expect(prismaMock.rdOperationalHourly.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					create: expect.objectContaining({
						successCount: 1,
						failureCount: 0,
						otherCount: 0,
					}),
					update: expect.objectContaining({
						totalCount: { increment: 1 },
						successCount: { increment: 1 },
					}),
				})
			);
		});

		it('upserts with failure increment for 5xx status', async () => {
			prismaMock.rdOperationalHourly.upsert.mockResolvedValue({});

			await service.recordOperation('GET /user', 500);

			expect(prismaMock.rdOperationalHourly.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					create: expect.objectContaining({
						successCount: 0,
						failureCount: 1,
						otherCount: 0,
					}),
				})
			);
		});

		it('upserts with other increment for 4xx status', async () => {
			prismaMock.rdOperationalHourly.upsert.mockResolvedValue({});

			await service.recordOperation('GET /user', 404);

			expect(prismaMock.rdOperationalHourly.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					create: expect.objectContaining({
						successCount: 0,
						failureCount: 0,
						otherCount: 1,
					}),
				})
			);
		});

		it('silently handles P2021 table-not-exist errors', async () => {
			prismaMock.rdOperationalHourly.upsert.mockRejectedValue({ code: 'P2021' });

			await expect(service.recordOperation('GET /user', 200)).resolves.toBeUndefined();
		});

		it('logs other errors without throwing', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			prismaMock.rdOperationalHourly.upsert.mockRejectedValue(new Error('connection lost'));

			await expect(service.recordOperation('GET /user', 200)).resolves.toBeUndefined();

			expect(consoleSpy).toHaveBeenCalledWith(
				'Failed to record RD operation:',
				expect.any(Error)
			);
			consoleSpy.mockRestore();
		});
	});

	describe('getStats', () => {
		it('returns empty stats when no data', async () => {
			prismaMock.rdOperationalHourly.findMany.mockResolvedValue([]);

			const stats = await service.getStats();

			expect(stats.totalCount).toBe(0);
			expect(stats.isDown).toBe(false);
			expect(stats.lastHour).toBeNull();
		});

		it('aggregates hourly data into stats', async () => {
			const hour = new Date();
			prismaMock.rdOperationalHourly.findMany.mockResolvedValue([
				{ hour, operation: 'GET /user', totalCount: 10, successCount: 8, failureCount: 2 },
				{
					hour,
					operation: 'GET /torrents',
					totalCount: 5,
					successCount: 5,
					failureCount: 0,
				},
			]);

			const stats = await service.getStats();

			expect(stats.totalCount).toBe(15);
			expect(stats.successCount).toBe(13);
			expect(stats.failureCount).toBe(2);
			expect(stats.successRate).toBeCloseTo(13 / 15);
			expect(stats.isDown).toBe(false);
			expect(stats.lastHour).toEqual(hour);
		});

		it('marks as down when success rate below 50%', async () => {
			prismaMock.rdOperationalHourly.findMany.mockResolvedValue([
				{
					hour: new Date(),
					operation: 'GET /user',
					totalCount: 10,
					successCount: 2,
					failureCount: 8,
				},
			]);

			const stats = await service.getStats();

			expect(stats.isDown).toBe(true);
		});

		it('returns empty stats on database error', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			prismaMock.rdOperationalHourly.findMany.mockRejectedValue(
				new Error('connection failed')
			);

			const stats = await service.getStats();

			expect(stats.totalCount).toBe(0);
			consoleSpy.mockRestore();
		});

		it('returns empty stats on P2021 error', async () => {
			prismaMock.rdOperationalHourly.findMany.mockRejectedValue({ code: 'P2021' });

			const stats = await service.getStats();

			expect(stats.totalCount).toBe(0);
		});
	});

	describe('getHourlyHistory', () => {
		it('aggregates by hour across operations', async () => {
			const hour = new Date('2024-01-01T10:00:00Z');
			prismaMock.rdOperationalHourly.findMany.mockResolvedValue([
				{ hour, operation: 'GET /user', totalCount: 5, successCount: 4, failureCount: 1 },
				{
					hour,
					operation: 'GET /torrents',
					totalCount: 3,
					successCount: 3,
					failureCount: 0,
				},
			]);

			const history = await service.getHourlyHistory();

			expect(history).toHaveLength(1);
			expect(history[0].totalCount).toBe(8);
			expect(history[0].successCount).toBe(7);
			expect(history[0].successRate).toBeCloseTo(7 / 8);
		});

		it('returns empty on error', async () => {
			prismaMock.rdOperationalHourly.findMany.mockRejectedValue({ code: 'P2021' });

			expect(await service.getHourlyHistory()).toEqual([]);
		});
	});

	describe('rollupDaily', () => {
		it('upserts daily aggregates from hourly data', async () => {
			const hour1 = new Date('2024-01-01T10:00:00Z');
			const hour2 = new Date('2024-01-01T14:00:00Z');

			prismaMock.rdOperationalHourly.findMany.mockResolvedValue([
				{
					hour: hour1,
					operation: 'GET /user',
					totalCount: 10,
					successCount: 8,
					failureCount: 2,
				},
				{
					hour: hour2,
					operation: 'GET /user',
					totalCount: 20,
					successCount: 18,
					failureCount: 2,
				},
			]);
			prismaMock.rdOperationalDaily.upsert.mockResolvedValue({});

			await service.rollupDaily(new Date('2024-01-01'));

			expect(prismaMock.rdOperationalDaily.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					create: expect.objectContaining({
						operation: 'GET /user',
						totalCount: 30,
						successCount: 26,
						failureCount: 4,
					}),
				})
			);
		});

		it('handles P2021 error silently', async () => {
			prismaMock.rdOperationalHourly.findMany.mockRejectedValue({ code: 'P2021' });

			await expect(service.rollupDaily()).resolves.toBeUndefined();
		});
	});

	describe('getDailyHistory', () => {
		it('aggregates daily data by date', async () => {
			const date = new Date('2024-01-01');
			prismaMock.rdOperationalDaily.findMany.mockResolvedValue([
				{
					date,
					operation: 'GET /user',
					totalCount: 100,
					successCount: 90,
					failureCount: 10,
					avgSuccessRate: 0.9,
					minSuccessRate: 0.8,
					maxSuccessRate: 1.0,
				},
			]);

			const history = await service.getDailyHistory();

			expect(history).toHaveLength(1);
			expect(history[0].totalCount).toBe(100);
			expect(history[0].avgSuccessRate).toBe(0.9);
		});

		it('returns empty on error', async () => {
			prismaMock.rdOperationalDaily.findMany.mockRejectedValue({ code: 'P2021' });

			expect(await service.getDailyHistory()).toEqual([]);
		});
	});

	describe('cleanupOldData', () => {
		it('deletes old hourly and daily data', async () => {
			prismaMock.rdOperationalHourly.deleteMany.mockResolvedValue({ count: 5 });
			prismaMock.rdOperationalDaily.deleteMany.mockResolvedValue({ count: 2 });

			const result = await service.cleanupOldData();

			expect(result).toEqual({ hourlyDeleted: 5, dailyDeleted: 2 });
		});

		it('returns zeros on P2021 error', async () => {
			prismaMock.rdOperationalHourly.deleteMany.mockRejectedValue({ code: 'P2021' });

			const result = await service.cleanupOldData();

			expect(result).toEqual({ hourlyDeleted: 0, dailyDeleted: 0 });
		});
	});
});
