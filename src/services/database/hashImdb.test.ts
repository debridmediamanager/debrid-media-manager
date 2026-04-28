import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HashImdbService } from './hashImdb';

const prismaMock = vi.hoisted(() => ({
	hashImdb: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		update: vi.fn(),
		create: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('HashImdbService', () => {
	let service: HashImdbService;

	beforeEach(() => {
		service = new HashImdbService();
		(prismaMock.hashImdb.findFirst as Mock).mockReset();
		(prismaMock.hashImdb.findMany as Mock).mockReset();
		(prismaMock.hashImdb.update as Mock).mockReset();
		(prismaMock.hashImdb.create as Mock).mockReset();
	});

	describe('upsertBatch', () => {
		it('updates updatedAt when exact hash+imdbId already exists', async () => {
			prismaMock.hashImdb.findFirst.mockResolvedValue({
				id: 'abc123',
				hash: 'abc123',
				imdbId: 'tt0000001',
			});
			prismaMock.hashImdb.update.mockResolvedValue({});

			const results = await service.upsertBatch([{ hash: 'abc123', imdbId: 'tt0000001' }]);

			expect(results).toEqual([{ id: 'abc123', created: false }]);
			expect(prismaMock.hashImdb.update).toHaveBeenCalledWith({
				where: { id: 'abc123' },
				data: { updatedAt: expect.any(Date) },
			});
			expect(prismaMock.hashImdb.create).not.toHaveBeenCalled();
		});

		it('creates with hash as id when no existing entries for hash', async () => {
			prismaMock.hashImdb.findFirst.mockResolvedValue(null);
			prismaMock.hashImdb.findMany.mockResolvedValue([]);
			prismaMock.hashImdb.create.mockResolvedValue({});

			const results = await service.upsertBatch([{ hash: 'abc123', imdbId: 'tt0000001' }]);

			expect(results).toEqual([{ id: 'abc123', created: true }]);
			expect(prismaMock.hashImdb.create).toHaveBeenCalledWith({
				data: { id: 'abc123', hash: 'abc123', imdbId: 'tt0000001' },
			});
		});

		it('creates with incremented suffix when other entries exist for hash', async () => {
			prismaMock.hashImdb.findFirst.mockResolvedValue(null);
			prismaMock.hashImdb.findMany.mockResolvedValue([{ id: 'abc123' }, { id: 'abc123-1' }]);
			prismaMock.hashImdb.create.mockResolvedValue({});

			const results = await service.upsertBatch([{ hash: 'abc123', imdbId: 'tt0000002' }]);

			expect(results).toEqual([{ id: 'abc123-2', created: true }]);
		});

		it('handles multiple pairs in a single batch', async () => {
			prismaMock.hashImdb.findFirst
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ id: 'def456', hash: 'def456', imdbId: 'tt0000002' });
			prismaMock.hashImdb.findMany.mockResolvedValueOnce([]);
			prismaMock.hashImdb.create.mockResolvedValue({});
			prismaMock.hashImdb.update.mockResolvedValue({});

			const results = await service.upsertBatch([
				{ hash: 'abc123', imdbId: 'tt0000001' },
				{ hash: 'def456', imdbId: 'tt0000002' },
			]);

			expect(results).toHaveLength(2);
			expect(results[0]).toEqual({ id: 'abc123', created: true });
			expect(results[1]).toEqual({ id: 'def456', created: false });
		});

		it('handles empty batch', async () => {
			const results = await service.upsertBatch([]);
			expect(results).toEqual([]);
		});
	});

	describe('getByHash', () => {
		it('returns results ordered by createdAt', async () => {
			const expected = [{ id: 'abc123', hash: 'abc123', imdbId: 'tt0000001' }];
			prismaMock.hashImdb.findMany.mockResolvedValue(expected);

			const result = await service.getByHash('abc123');

			expect(result).toEqual(expected);
			expect(prismaMock.hashImdb.findMany).toHaveBeenCalledWith({
				where: { hash: 'abc123' },
				orderBy: { createdAt: 'asc' },
			});
		});
	});

	describe('getByHashes', () => {
		it('returns empty array for empty input', async () => {
			const result = await service.getByHashes([]);
			expect(result).toEqual([]);
			expect(prismaMock.hashImdb.findMany).not.toHaveBeenCalled();
		});

		it('queries multiple hashes', async () => {
			const expected = [
				{ id: 'a', hash: 'a', imdbId: 'tt1' },
				{ id: 'b', hash: 'b', imdbId: 'tt2' },
			];
			prismaMock.hashImdb.findMany.mockResolvedValue(expected);

			const result = await service.getByHashes(['a', 'b']);

			expect(result).toEqual(expected);
			expect(prismaMock.hashImdb.findMany).toHaveBeenCalledWith({
				where: { hash: { in: ['a', 'b'] } },
				orderBy: { createdAt: 'asc' },
			});
		});
	});
});
