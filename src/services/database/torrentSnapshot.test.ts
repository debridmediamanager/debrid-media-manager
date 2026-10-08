import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TorrentSnapshotService } from './torrentSnapshot';

describe('TorrentSnapshotService', () => {
	let service: TorrentSnapshotService;
	let mockPrisma: any;

	beforeEach(() => {
		mockPrisma = {
			torrentSnapshot: {
				upsert: vi.fn(),
				findFirst: vi.fn(),
				findMany: vi.fn(),
			},
			$disconnect: vi.fn(),
		};

		service = new TorrentSnapshotService();
		(service as any).prisma = mockPrisma;
	});

	describe('getSnapshotsByHashes', () => {
		it('returns empty array for empty hash list', async () => {
			const result = await service.getSnapshotsByHashes([]);
			expect(result).toEqual([]);
			expect(mockPrisma.torrentSnapshot.findMany).not.toHaveBeenCalled();
		});

		it('fetches snapshots for given hashes', async () => {
			const mockSnapshots = [
				{
					id: 'hash1:2024-01-01',
					hash: 'hash1',
					addedDate: new Date('2024-01-01'),
					payload: { data: 'test1' },
				},
				{
					id: 'hash2:2024-01-02',
					hash: 'hash2',
					addedDate: new Date('2024-01-02'),
					payload: { data: 'test2' },
				},
			];

			mockPrisma.torrentSnapshot.findMany.mockResolvedValue(mockSnapshots);

			const result = await service.getSnapshotsByHashes(['hash1', 'hash2']);

			expect(mockPrisma.torrentSnapshot.findMany).toHaveBeenCalledWith({
				where: {
					hash: { in: ['hash1', 'hash2'] },
				},
				orderBy: { addedDate: 'desc' },
			});

			expect(result).toEqual(mockSnapshots);
		});

		it('deduplicates snapshots by hash keeping latest', async () => {
			const mockSnapshots = [
				{
					id: 'hash1:2024-01-03',
					hash: 'hash1',
					addedDate: new Date('2024-01-03'),
					payload: { data: 'latest' },
				},
				{
					id: 'hash1:2024-01-01',
					hash: 'hash1',
					addedDate: new Date('2024-01-01'),
					payload: { data: 'older' },
				},
				{
					id: 'hash2:2024-01-02',
					hash: 'hash2',
					addedDate: new Date('2024-01-02'),
					payload: { data: 'test2' },
				},
			];

			mockPrisma.torrentSnapshot.findMany.mockResolvedValue(mockSnapshots);

			const result = await service.getSnapshotsByHashes(['hash1', 'hash2']);

			expect(result).toHaveLength(2);
			expect(result.find((s) => s.hash === 'hash1')?.payload).toEqual({ data: 'latest' });
		});

		it('handles single hash', async () => {
			const mockSnapshot = {
				id: 'hash1:2024-01-01',
				hash: 'hash1',
				addedDate: new Date('2024-01-01'),
				payload: { data: 'test' },
			};

			mockPrisma.torrentSnapshot.findMany.mockResolvedValue([mockSnapshot]);

			const result = await service.getSnapshotsByHashes(['hash1']);

			expect(result).toEqual([mockSnapshot]);
		});

		it('handles database errors gracefully', async () => {
			mockPrisma.torrentSnapshot.findMany.mockRejectedValue(
				new Error('Database connection error')
			);

			await expect(service.getSnapshotsByHashes(['hash1'])).rejects.toThrow(
				'Database connection error'
			);
		});
	});

	describe('getLatestSnapshot', () => {
		it('fetches latest snapshot for a hash', async () => {
			const mockSnapshot = {
				id: 'hash1:2024-01-01',
				hash: 'hash1',
				addedDate: new Date('2024-01-01'),
				payload: { data: 'test' },
			};

			mockPrisma.torrentSnapshot.findFirst.mockResolvedValue(mockSnapshot);

			const result = await service.getLatestSnapshot('hash1');

			expect(mockPrisma.torrentSnapshot.findFirst).toHaveBeenCalledWith({
				where: { hash: 'hash1' },
				orderBy: { addedDate: 'desc' },
			});

			expect(result).toEqual(mockSnapshot);
		});

		it('returns null when no snapshot exists', async () => {
			mockPrisma.torrentSnapshot.findFirst.mockResolvedValue(null);

			const result = await service.getLatestSnapshot('nonexistent');

			expect(result).toBeNull();
		});
	});

	// The merge, its lock and the races it closes run on a real MySQL in
	// torrentSnapshot.integration.test.ts; these pin which failures retry.
	describe('mergeSnapshot', () => {
		const post = {
			id: 'hash1:2024-01-01',
			hash: 'hash1',
			addedDate: new Date('2024-01-01'),
			payload: { SelectedFiles: {} } as any,
		};
		const failure = (code: string, meta?: Record<string, unknown>) =>
			new Prisma.PrismaClientKnownRequestError('failed', {
				code,
				clientVersion: '6.16.1',
				meta,
			});

		it.each([
			['a deadlock on its own queries', failure('P2034')],
			['a deadlock on a raw query', failure('P2010', { code: '1213' })],
			['a key another post took', failure('P2002', { target: 'PRIMARY' })],
		])('runs the transaction again after %s', async (_, error) => {
			mockPrisma.$transaction = vi
				.fn()
				.mockRejectedValueOnce(error)
				.mockResolvedValueOnce({ kept: 1, borrowed: 0 });

			await expect(service.mergeSnapshot(post)).resolves.toEqual({ kept: 1, borrowed: 0 });
			expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
		});

		it('gives up after three attempts', async () => {
			mockPrisma.$transaction = vi.fn().mockRejectedValue(failure('P2034'));

			await expect(service.mergeSnapshot(post)).rejects.toMatchObject({ code: 'P2034' });
			expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
		});

		it.each([
			['an unreachable database', failure('P1001')],
			['a raw query that failed otherwise', failure('P2010', { code: '1205' })],
			['a transaction that ran out of time', failure('P2028')],
		])('does not run it again after %s', async (_, error) => {
			mockPrisma.$transaction = vi.fn().mockRejectedValue(error);

			await expect(service.mergeSnapshot(post)).rejects.toBe(error);
			expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
		});
	});

	describe('upsertSnapshot', () => {
		it('creates or updates a snapshot', async () => {
			const snapshotData = {
				id: 'hash1:2024-01-01',
				hash: 'hash1',
				addedDate: new Date('2024-01-01'),
				payload: { data: 'test' },
			};

			mockPrisma.torrentSnapshot.upsert.mockResolvedValue(snapshotData);

			const result = await service.upsertSnapshot(snapshotData);

			expect(mockPrisma.torrentSnapshot.upsert).toHaveBeenCalledWith({
				where: { id: snapshotData.id },
				update: {
					hash: snapshotData.hash,
					addedDate: snapshotData.addedDate,
					payload: snapshotData.payload,
				},
				create: {
					id: snapshotData.id,
					hash: snapshotData.hash,
					addedDate: snapshotData.addedDate,
					payload: snapshotData.payload,
				},
			});

			expect(result).toEqual(snapshotData);
		});

		// The race itself, on a real MySQL, is in torrentSnapshot.integration.test.ts.
		describe('when another post of the release created the row first', () => {
			const snapshotData = {
				id: 'hash1:2024-01-01',
				hash: 'hash1',
				addedDate: new Date('2024-01-01'),
				payload: { data: 'test' },
			};
			const keyTaken = () =>
				new Prisma.PrismaClientKnownRequestError(
					'Unique constraint failed on the constraint: `PRIMARY`',
					{ code: 'P2002', clientVersion: '6.16.1', meta: { target: 'PRIMARY' } }
				);

			it('writes once more, which updates that row', async () => {
				mockPrisma.torrentSnapshot.upsert
					.mockRejectedValueOnce(keyTaken())
					.mockResolvedValueOnce(snapshotData);

				await expect(service.upsertSnapshot(snapshotData)).resolves.toEqual(snapshotData);
				expect(mockPrisma.torrentSnapshot.upsert).toHaveBeenCalledTimes(2);
				expect(mockPrisma.torrentSnapshot.upsert.mock.calls[1]).toEqual(
					mockPrisma.torrentSnapshot.upsert.mock.calls[0]
				);
			});

			it('writes only once more', async () => {
				mockPrisma.torrentSnapshot.upsert.mockRejectedValue(keyTaken());

				await expect(service.upsertSnapshot(snapshotData)).rejects.toMatchObject({
					code: 'P2002',
				});
				expect(mockPrisma.torrentSnapshot.upsert).toHaveBeenCalledTimes(2);
			});

			it('does not write again after any other failure', async () => {
				const down = new Prisma.PrismaClientKnownRequestError(
					"Can't reach database server",
					{
						code: 'P1001',
						clientVersion: '6.16.1',
					}
				);
				mockPrisma.torrentSnapshot.upsert.mockRejectedValue(down);

				await expect(service.upsertSnapshot(snapshotData)).rejects.toBe(down);
				expect(mockPrisma.torrentSnapshot.upsert).toHaveBeenCalledTimes(1);
			});
		});
	});
});
