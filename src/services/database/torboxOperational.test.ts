import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { TorBoxOperationalService, resolveTorBoxOperation } from './torboxOperational';

const prismaMock = vi.hoisted(() => ({
	torBoxOperationalHourly: {
		upsert: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	torBoxOperationalDaily: {
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

describe('resolveTorBoxOperation', () => {
	it('resolves GET /user/me', () => {
		expect(resolveTorBoxOperation('GET', '/v1/api/user/me')).toBe('GET /user/me');
	});

	it('resolves GET /torrents/mylist', () => {
		expect(resolveTorBoxOperation('GET', '/v1/api/torrents/mylist')).toBe(
			'GET /torrents/mylist'
		);
	});

	it('resolves GET /torrents/checkcached', () => {
		expect(resolveTorBoxOperation('GET', '/v1/api/torrents/checkcached')).toBe(
			'GET /torrents/checkcached'
		);
	});

	it('resolves GET /torrents/requestdl', () => {
		expect(resolveTorBoxOperation('GET', '/v1/api/torrents/requestdl')).toBe(
			'GET /torrents/requestdl'
		);
	});

	it('resolves POST /torrents/createtorrent', () => {
		expect(resolveTorBoxOperation('POST', '/v1/api/torrents/createtorrent')).toBe(
			'POST /torrents/createtorrent'
		);
	});

	it('resolves POST /torrents/controltorrent', () => {
		expect(resolveTorBoxOperation('POST', '/v1/api/torrents/controltorrent')).toBe(
			'POST /torrents/controltorrent'
		);
	});

	it('resolves the webdl endpoints separately from the torrent ones', () => {
		expect(resolveTorBoxOperation('GET', '/v1/api/webdl/mylist')).toBe('GET /webdl/mylist');
		expect(resolveTorBoxOperation('GET', '/v1/api/webdl/requestdl')).toBe(
			'GET /webdl/requestdl'
		);
		expect(resolveTorBoxOperation('POST', '/v1/api/webdl/createwebdownload')).toBe(
			'POST /webdl/createwebdownload'
		);
		expect(resolveTorBoxOperation('POST', '/v1/api/webdl/controlwebdownload')).toBe(
			'POST /webdl/controlwebdownload'
		);
	});

	// torrentinfo is the one path TorBox serves under two methods, and they do
	// different work (hash lookup vs magnet/file upload).
	it('keeps GET and POST torrentinfo apart', () => {
		expect(resolveTorBoxOperation('GET', '/v1/api/torrents/torrentinfo')).toBe(
			'GET /torrents/torrentinfo'
		);
		expect(resolveTorBoxOperation('POST', '/v1/api/torrents/torrentinfo')).toBe(
			'POST /torrents/torrentinfo'
		);
	});

	it('still resolves if TorBox moves to a new API version prefix', () => {
		expect(resolveTorBoxOperation('GET', '/v2/api/torrents/mylist')).toBe(
			'GET /torrents/mylist'
		);
	});

	it('returns null for unmonitored paths', () => {
		expect(resolveTorBoxOperation('GET', '/v1/api/stats')).toBeNull();
		expect(resolveTorBoxOperation('POST', '/v1/api/user/refreshtoken')).toBeNull();
	});

	it('returns null when the method does not match the path', () => {
		expect(resolveTorBoxOperation('POST', '/v1/api/torrents/mylist')).toBeNull();
	});

	it('returns null without a method', () => {
		expect(resolveTorBoxOperation(undefined, '/v1/api/user/me')).toBeNull();
	});

	it('is case-insensitive about the method', () => {
		expect(resolveTorBoxOperation('get', '/v1/api/user/me')).toBe('GET /user/me');
	});
});

describe('TorBoxOperationalService', () => {
	let service: TorBoxOperationalService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new TorBoxOperationalService();
	});

	describe('recordOperation', () => {
		it('counts a 2xx as a success', async () => {
			(prismaMock.torBoxOperationalHourly.upsert as Mock).mockResolvedValue({});

			await service.recordOperation('GET /torrents/mylist', 200);

			const call = (prismaMock.torBoxOperationalHourly.upsert as Mock).mock.calls[0][0];
			expect(call.create).toMatchObject({
				operation: 'GET /torrents/mylist',
				totalCount: 1,
				successCount: 1,
				failureCount: 0,
				otherCount: 0,
			});
		});

		it('counts a 5xx as a failure', async () => {
			(prismaMock.torBoxOperationalHourly.upsert as Mock).mockResolvedValue({});

			await service.recordOperation('GET /torrents/mylist', 503);

			const call = (prismaMock.torBoxOperationalHourly.upsert as Mock).mock.calls[0][0];
			expect(call.create).toMatchObject({
				totalCount: 1,
				successCount: 0,
				failureCount: 1,
				otherCount: 0,
			});
		});

		// A rejected key or a malformed request is the caller's problem, not an
		// outage - it must not drag the success rate down.
		it('counts a 4xx as neither success nor failure', async () => {
			(prismaMock.torBoxOperationalHourly.upsert as Mock).mockResolvedValue({});

			await service.recordOperation('GET /torrents/mylist', 401);

			const call = (prismaMock.torBoxOperationalHourly.upsert as Mock).mock.calls[0][0];
			expect(call.create).toMatchObject({
				totalCount: 1,
				successCount: 0,
				failureCount: 0,
				otherCount: 1,
			});
		});

		it('buckets writes into the current hour', async () => {
			(prismaMock.torBoxOperationalHourly.upsert as Mock).mockResolvedValue({});

			await service.recordOperation('GET /user/me', 200);

			const call = (prismaMock.torBoxOperationalHourly.upsert as Mock).mock.calls[0][0];
			const hour: Date = call.where.hour_operation.hour;
			expect(hour.getMinutes()).toBe(0);
			expect(hour.getSeconds()).toBe(0);
			expect(hour.getMilliseconds()).toBe(0);
		});

		it('swallows a missing-table error', async () => {
			(prismaMock.torBoxOperationalHourly.upsert as Mock).mockRejectedValue({
				code: 'P2021',
			});

			await expect(service.recordOperation('GET /user/me', 200)).resolves.toBeUndefined();
		});
	});

	describe('getStats', () => {
		it('returns empty stats when nothing has been recorded', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockResolvedValue([]);

			const stats = await service.getStats(1);

			expect(stats.totalCount).toBe(0);
			expect(stats.isDown).toBe(false);
			expect(stats.lastHour).toBeNull();
		});

		it('aggregates counts across hours and operations', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockResolvedValue([
				{
					hour: new Date('2026-08-25T11:00:00Z'),
					operation: 'GET /torrents/mylist',
					totalCount: 10,
					successCount: 9,
					failureCount: 1,
				},
				{
					hour: new Date('2026-08-25T10:00:00Z'),
					operation: 'GET /torrents/checkcached',
					totalCount: 5,
					successCount: 5,
					failureCount: 0,
				},
			]);

			const stats = await service.getStats(2);

			expect(stats.totalCount).toBe(15);
			expect(stats.successCount).toBe(14);
			expect(stats.failureCount).toBe(1);
			expect(stats.successRate).toBeCloseTo(14 / 15);
			expect(stats.byOperation['GET /torrents/mylist'].successRate).toBeCloseTo(0.9);
			expect(stats.byOperation['GET /torrents/checkcached'].successRate).toBe(1);
			expect(stats.lastHour).toEqual(new Date('2026-08-25T11:00:00Z'));
		});

		// The rate is computed over success+failure, so the 4xx bucket must not
		// enter the denominator.
		it('excludes the other bucket from the success rate', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockResolvedValue([
				{
					hour: new Date('2026-08-25T11:00:00Z'),
					operation: 'GET /torrents/mylist',
					totalCount: 100,
					successCount: 10,
					failureCount: 0,
				},
			]);

			const stats = await service.getStats(1);

			expect(stats.totalCount).toBe(100);
			expect(stats.successRate).toBe(1);
			expect(stats.isDown).toBe(false);
		});

		it('flags isDown when most considered calls are server errors', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockResolvedValue([
				{
					hour: new Date('2026-08-25T11:00:00Z'),
					operation: 'GET /torrents/mylist',
					totalCount: 10,
					successCount: 2,
					failureCount: 8,
				},
			]);

			const stats = await service.getStats(1);

			expect(stats.isDown).toBe(true);
		});

		it('ignores rows for operations no longer monitored', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockResolvedValue([
				{
					hour: new Date('2026-08-25T11:00:00Z'),
					operation: 'GET /torrents/retired',
					totalCount: 10,
					successCount: 10,
					failureCount: 0,
				},
			]);

			const stats = await service.getStats(1);

			expect(stats.totalCount).toBe(0);
		});

		it('returns empty stats when the table is missing', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockRejectedValue({
				code: 'P2021',
			});

			const stats = await service.getStats(1);

			expect(stats.totalCount).toBe(0);
		});
	});

	describe('getHourlyHistory', () => {
		it('folds every operation into one point per hour', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockResolvedValue([
				{
					hour: new Date('2026-08-25T10:00:00Z'),
					operation: 'GET /torrents/mylist',
					totalCount: 10,
					successCount: 8,
					failureCount: 2,
				},
				{
					hour: new Date('2026-08-25T10:00:00Z'),
					operation: 'GET /user/me',
					totalCount: 10,
					successCount: 10,
					failureCount: 0,
				},
			]);

			const history = await service.getHourlyHistory(24);

			expect(history).toHaveLength(1);
			expect(history[0].totalCount).toBe(20);
			expect(history[0].successRate).toBeCloseTo(18 / 20);
		});

		it('returns an empty list when the table is missing', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockRejectedValue({
				code: 'P2021',
			});

			await expect(service.getHourlyHistory(24)).resolves.toEqual([]);
		});
	});

	describe('rollupDaily', () => {
		it('writes one daily row per operation and reports success', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockResolvedValue([
				{
					hour: new Date('2026-08-24T10:00:00Z'),
					operation: 'GET /torrents/mylist',
					totalCount: 10,
					successCount: 10,
					failureCount: 0,
				},
				{
					hour: new Date('2026-08-24T11:00:00Z'),
					operation: 'GET /torrents/mylist',
					totalCount: 30,
					successCount: 15,
					failureCount: 15,
				},
			]);
			(prismaMock.torBoxOperationalDaily.upsert as Mock).mockResolvedValue({});

			const rolled = await service.rollupDaily(new Date('2026-08-24T00:00:00Z'));

			expect(rolled).toBe(true);
			const call = (prismaMock.torBoxOperationalDaily.upsert as Mock).mock.calls[0][0];
			expect(call.create).toMatchObject({
				operation: 'GET /torrents/mylist',
				totalCount: 40,
				successCount: 25,
				failureCount: 15,
				minSuccessRate: 0.5,
				maxSuccessRate: 1,
				peakHour: 11,
			});
		});

		it('reports failure rather than throwing when the table is missing', async () => {
			(prismaMock.torBoxOperationalHourly.findMany as Mock).mockRejectedValue({
				code: 'P2021',
			});

			await expect(service.rollupDaily(new Date())).resolves.toBe(false);
		});
	});

	describe('getDailyHistory', () => {
		it('folds every operation into one point per day', async () => {
			(prismaMock.torBoxOperationalDaily.findMany as Mock).mockResolvedValue([
				{
					date: new Date('2026-08-24T00:00:00Z'),
					operation: 'GET /torrents/mylist',
					totalCount: 10,
					successCount: 8,
					failureCount: 2,
					avgSuccessRate: 0.8,
					minSuccessRate: 0.6,
					maxSuccessRate: 1,
				},
				{
					date: new Date('2026-08-24T00:00:00Z'),
					operation: 'GET /user/me',
					totalCount: 10,
					successCount: 10,
					failureCount: 0,
					avgSuccessRate: 1,
					minSuccessRate: 1,
					maxSuccessRate: 1,
				},
			]);

			const history = await service.getDailyHistory(7);

			expect(history).toHaveLength(1);
			expect(history[0].totalCount).toBe(20);
			expect(history[0].avgSuccessRate).toBeCloseTo(0.9);
			expect(history[0].minSuccessRate).toBe(0.6);
			expect(history[0].maxSuccessRate).toBe(1);
		});

		it('returns an empty list when the table is missing', async () => {
			(prismaMock.torBoxOperationalDaily.findMany as Mock).mockRejectedValue({
				code: 'P2021',
			});

			await expect(service.getDailyHistory(7)).resolves.toEqual([]);
		});
	});

	describe('cleanupOldData', () => {
		it('deletes from both tables and reports the counts', async () => {
			(prismaMock.torBoxOperationalHourly.deleteMany as Mock).mockResolvedValue({ count: 4 });
			(prismaMock.torBoxOperationalDaily.deleteMany as Mock).mockResolvedValue({ count: 2 });

			await expect(service.cleanupOldData()).resolves.toEqual({
				hourlyDeleted: 4,
				dailyDeleted: 2,
			});
		});

		it('reports zeroes when the tables are missing', async () => {
			(prismaMock.torBoxOperationalHourly.deleteMany as Mock).mockRejectedValue({
				code: 'P2021',
			});
			(prismaMock.torBoxOperationalDaily.deleteMany as Mock).mockRejectedValue({
				code: 'P2021',
			});

			await expect(service.cleanupOldData()).resolves.toEqual({
				hourlyDeleted: 0,
				dailyDeleted: 0,
			});
		});
	});
});
