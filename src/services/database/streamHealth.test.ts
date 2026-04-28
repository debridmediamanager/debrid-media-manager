import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { StreamHealthService } from './streamHealth';

const prismaMock = vi.hoisted(() => ({
	streamServerHealth: {
		upsert: vi.fn(),
		findMany: vi.fn(),
		findFirst: vi.fn(),
		deleteMany: vi.fn(),
		count: vi.fn(),
	},
	streamCheckResult: {
		create: vi.fn(),
		count: vi.fn(),
		findMany: vi.fn(),
		deleteMany: vi.fn(),
	},
	torrentioCheckResult: {
		create: vi.fn(),
		count: vi.fn(),
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

describe('StreamHealthService', () => {
	let service: StreamHealthService;

	beforeEach(() => {
		service = new StreamHealthService();
		Object.values(prismaMock.streamServerHealth).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.streamCheckResult).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.torrentioCheckResult).forEach((fn) => (fn as Mock).mockReset());
		(prismaMock.$transaction as Mock).mockReset();
	});

	describe('upsertHealthResults', () => {
		it('does nothing for empty array', async () => {
			await service.upsertHealthResults([]);
			expect(prismaMock.$transaction).not.toHaveBeenCalled();
		});

		it('calls $transaction with upsert operations', async () => {
			prismaMock.$transaction.mockResolvedValue([]);
			const results = [
				{
					host: 'server1',
					status: 200,
					latencyMs: 100,
					ok: true,
					error: null,
					checkedAt: new Date(),
				},
			];

			await service.upsertHealthResults(results);

			expect(prismaMock.$transaction).toHaveBeenCalled();
		});

		it('handles P2021 error silently', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.$transaction.mockRejectedValue({ code: 'P2021' });

			await expect(
				service.upsertHealthResults([
					{
						host: 'a',
						status: 200,
						latencyMs: 50,
						ok: true,
						error: null,
						checkedAt: new Date(),
					},
				])
			).resolves.toBeUndefined();
			consoleSpy.mockRestore();
		});
	});

	describe('getAllStatuses', () => {
		it('returns mapped results', async () => {
			const checkedAt = new Date();
			prismaMock.streamServerHealth.findMany.mockResolvedValue([
				{ host: 'server1', status: 200, latencyMs: 100, ok: true, error: null, checkedAt },
			]);

			const results = await service.getAllStatuses();

			expect(results).toEqual([
				{ host: 'server1', status: 200, latencyMs: 100, ok: true, error: null, checkedAt },
			]);
		});

		it('returns empty array on Prisma error', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.streamServerHealth.findMany.mockRejectedValue({
				code: 'P2021',
				message: 'does not exist',
			});

			expect(await service.getAllStatuses()).toEqual([]);
			consoleSpy.mockRestore();
		});

		it('throws non-Prisma errors', async () => {
			prismaMock.streamServerHealth.findMany.mockRejectedValue(new TypeError('unexpected'));

			await expect(service.getAllStatuses()).rejects.toThrow('unexpected');
		});
	});

	describe('deleteHosts', () => {
		it('returns 0 for empty array', async () => {
			expect(await service.deleteHosts([])).toBe(0);
		});

		it('returns count of deleted hosts', async () => {
			prismaMock.streamServerHealth.deleteMany.mockResolvedValue({ count: 2 });

			expect(await service.deleteHosts(['s1', 's2'])).toBe(2);
		});

		it('returns 0 on Prisma error', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.streamServerHealth.deleteMany.mockRejectedValue({
				code: 'P2021',
				message: 'does not exist',
			});

			expect(await service.deleteHosts(['s1'])).toBe(0);
			consoleSpy.mockRestore();
		});
	});

	describe('deleteDeprecatedHosts', () => {
		it('deletes hosts not in valid list', async () => {
			prismaMock.streamServerHealth.findMany.mockResolvedValue([
				{ host: 'keep' },
				{ host: 'remove' },
			]);
			prismaMock.streamServerHealth.deleteMany.mockResolvedValue({ count: 1 });
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const count = await service.deleteDeprecatedHosts(['keep']);

			expect(count).toBe(1);
			expect(prismaMock.streamServerHealth.deleteMany).toHaveBeenCalledWith({
				where: { host: { in: ['remove'] } },
			});
			consoleSpy.mockRestore();
		});

		it('returns 0 when all hosts are valid', async () => {
			prismaMock.streamServerHealth.findMany.mockResolvedValue([{ host: 'keep' }]);

			expect(await service.deleteDeprecatedHosts(['keep'])).toBe(0);
		});
	});

	describe('getMetrics', () => {
		it('returns computed metrics', async () => {
			prismaMock.streamServerHealth.count.mockResolvedValueOnce(5).mockResolvedValueOnce(4);
			prismaMock.streamServerHealth.findMany
				.mockResolvedValueOnce([
					{ host: 'fast', latencyMs: 50 },
					{ host: 'slow', latencyMs: 150 },
				])
				.mockResolvedValueOnce([{ host: 'down1' }]);
			prismaMock.streamServerHealth.findFirst.mockResolvedValue({
				checkedAt: new Date('2024-01-01'),
			});

			const metrics = await service.getMetrics();

			expect(metrics.total).toBe(5);
			expect(metrics.working).toBe(4);
			expect(metrics.rate).toBe(0.8);
			expect(metrics.avgLatencyMs).toBe(100);
			expect(metrics.fastestServer).toBe('fast');
			expect(metrics.failedServers).toEqual(['down1']);
		});

		it('returns empty metrics on Prisma error', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.streamServerHealth.count.mockRejectedValue({
				code: 'P2021',
				message: 'does not exist',
			});

			const metrics = await service.getMetrics();

			expect(metrics.total).toBe(0);
			expect(metrics.rate).toBe(0);
			consoleSpy.mockRestore();
		});
	});

	describe('cleanupOldEntries', () => {
		it('returns count of deleted entries', async () => {
			prismaMock.streamServerHealth.deleteMany.mockResolvedValue({ count: 3 });

			expect(await service.cleanupOldEntries(24)).toBe(3);
		});

		it('returns 0 on P2021 error', async () => {
			prismaMock.streamServerHealth.deleteMany.mockRejectedValue({ code: 'P2021' });

			expect(await service.cleanupOldEntries()).toBe(0);
		});
	});

	describe('getCount', () => {
		it('returns count', async () => {
			prismaMock.streamServerHealth.count.mockResolvedValue(42);
			expect(await service.getCount()).toBe(42);
		});

		it('returns 0 on P2021 error', async () => {
			prismaMock.streamServerHealth.count.mockRejectedValue({ code: 'P2021' });
			expect(await service.getCount()).toBe(0);
		});
	});

	describe('recordCheckResult', () => {
		it('creates a result and trims old entries when over 50', async () => {
			prismaMock.streamCheckResult.create.mockResolvedValue({});
			prismaMock.streamCheckResult.count.mockResolvedValue(55);
			prismaMock.streamCheckResult.findMany.mockResolvedValue([
				{ id: 1 },
				{ id: 2 },
				{ id: 3 },
				{ id: 4 },
				{ id: 5 },
			]);
			prismaMock.streamCheckResult.deleteMany.mockResolvedValue({ count: 5 });

			await service.recordCheckResult({
				ok: true,
				latencyMs: 100,
				server: 's1',
				error: null,
			});

			expect(prismaMock.streamCheckResult.create).toHaveBeenCalled();
			expect(prismaMock.streamCheckResult.deleteMany).toHaveBeenCalledWith({
				where: { id: { in: [1, 2, 3, 4, 5] } },
			});
		});

		it('does not trim when under 50 results', async () => {
			prismaMock.streamCheckResult.create.mockResolvedValue({});
			prismaMock.streamCheckResult.count.mockResolvedValue(30);

			await service.recordCheckResult({
				ok: true,
				latencyMs: 100,
				server: 's1',
				error: null,
			});

			expect(prismaMock.streamCheckResult.findMany).not.toHaveBeenCalled();
		});

		it('handles P2021 error silently', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.streamCheckResult.create.mockRejectedValue({ code: 'P2021' });

			await expect(
				service.recordCheckResult({ ok: true, latencyMs: 100, server: 's1', error: null })
			).resolves.toBeUndefined();
			consoleSpy.mockRestore();
		});
	});

	describe('getRecentChecks', () => {
		it('returns mapped check results', async () => {
			const checkedAt = new Date();
			prismaMock.streamCheckResult.findMany.mockResolvedValue([
				{ ok: true, latencyMs: 100, server: 's1', error: null, checkedAt },
			]);

			const results = await service.getRecentChecks(5);

			expect(results).toEqual([
				{ ok: true, latencyMs: 100, server: 's1', error: null, checkedAt },
			]);
		});

		it('returns empty on Prisma error', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.streamCheckResult.findMany.mockRejectedValue({
				code: 'P2021',
				message: 'does not exist',
			});

			expect(await service.getRecentChecks()).toEqual([]);
			consoleSpy.mockRestore();
		});
	});

	describe('recordTorrentioCheckResult', () => {
		it('creates a result and trims when over 50', async () => {
			prismaMock.torrentioCheckResult.create.mockResolvedValue({});
			prismaMock.torrentioCheckResult.count.mockResolvedValue(52);
			prismaMock.torrentioCheckResult.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
			prismaMock.torrentioCheckResult.deleteMany.mockResolvedValue({ count: 2 });

			await service.recordTorrentioCheckResult({
				ok: true,
				latencyMs: 200,
				error: null,
				urls: [],
			});

			expect(prismaMock.torrentioCheckResult.create).toHaveBeenCalled();
			expect(prismaMock.torrentioCheckResult.deleteMany).toHaveBeenCalled();
		});
	});

	describe('getRecentTorrentioChecks', () => {
		it('returns mapped results', async () => {
			const checkedAt = new Date();
			prismaMock.torrentioCheckResult.findMany.mockResolvedValue([
				{ ok: true, latencyMs: 200, error: null, urls: [], checkedAt },
			]);

			const results = await service.getRecentTorrentioChecks(5);

			expect(results).toEqual([
				{ ok: true, latencyMs: 200, error: null, urls: [], checkedAt },
			]);
		});

		it('returns empty on Prisma error', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			prismaMock.torrentioCheckResult.findMany.mockRejectedValue({
				code: 'P2021',
				message: 'does not exist',
			});

			expect(await service.getRecentTorrentioChecks()).toEqual([]);
			consoleSpy.mockRestore();
		});
	});
});
