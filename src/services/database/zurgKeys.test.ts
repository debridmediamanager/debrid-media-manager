import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ZurgKeysService } from './zurgKeys';

const prismaMock = vi.hoisted(() => ({
	zurgKeys: {
		create: vi.fn(),
		findUnique: vi.fn(),
		findMany: vi.fn(),
		delete: vi.fn(),
		deleteMany: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('ZurgKeysService', () => {
	let service: ZurgKeysService;

	beforeEach(() => {
		service = new ZurgKeysService();
		(prismaMock.zurgKeys.create as Mock).mockReset();
		(prismaMock.zurgKeys.findUnique as Mock).mockReset();
		(prismaMock.zurgKeys.findMany as Mock).mockReset();
		(prismaMock.zurgKeys.delete as Mock).mockReset();
		(prismaMock.zurgKeys.deleteMany as Mock).mockReset();
	});

	describe('generateApiKey', () => {
		it('returns a 64-character hex string', () => {
			const key = service.generateApiKey();
			expect(key).toMatch(/^[0-9a-f]{64}$/);
		});

		it('generates unique keys', () => {
			const key1 = service.generateApiKey();
			const key2 = service.generateApiKey();
			expect(key1).not.toBe(key2);
		});
	});

	describe('createApiKey', () => {
		it('creates a key with expiration and returns it', async () => {
			prismaMock.zurgKeys.create.mockResolvedValue({});
			const validUntil = new Date('2030-01-01');

			const key = await service.createApiKey(validUntil);

			expect(key).toMatch(/^[0-9a-f]{64}$/);
			expect(prismaMock.zurgKeys.create).toHaveBeenCalledWith({
				data: {
					apiKey: key,
					validUntil,
				},
			});
		});
	});

	describe('validateApiKey', () => {
		it('returns false when key does not exist', async () => {
			prismaMock.zurgKeys.findUnique.mockResolvedValue(null);

			const valid = await service.validateApiKey('nonexistent');

			expect(valid).toBe(false);
		});

		it('returns true when key exists with no expiration', async () => {
			prismaMock.zurgKeys.findUnique.mockResolvedValue({
				apiKey: 'key1',
				validUntil: null,
				createdAt: new Date(),
			});

			const valid = await service.validateApiKey('key1');

			expect(valid).toBe(true);
		});

		it('returns true when key is not expired', async () => {
			const future = new Date(Date.now() + 86400000);
			prismaMock.zurgKeys.findUnique.mockResolvedValue({
				apiKey: 'key1',
				validUntil: future,
				createdAt: new Date(),
			});

			const valid = await service.validateApiKey('key1');

			expect(valid).toBe(true);
		});

		it('returns false when key is expired', async () => {
			const past = new Date(Date.now() - 86400000);
			prismaMock.zurgKeys.findUnique.mockResolvedValue({
				apiKey: 'key1',
				validUntil: past,
				createdAt: new Date(),
			});

			const valid = await service.validateApiKey('key1');

			expect(valid).toBe(false);
		});
	});

	describe('getApiKey', () => {
		it('returns null when key does not exist', async () => {
			prismaMock.zurgKeys.findUnique.mockResolvedValue(null);

			const result = await service.getApiKey('nonexistent');

			expect(result).toBeNull();
		});

		it('returns key details when found', async () => {
			const createdAt = new Date();
			const validUntil = new Date('2030-01-01');
			prismaMock.zurgKeys.findUnique.mockResolvedValue({
				apiKey: 'key1',
				validUntil,
				createdAt,
			});

			const result = await service.getApiKey('key1');

			expect(result).toEqual({ apiKey: 'key1', validUntil, createdAt });
		});
	});

	describe('deleteApiKey', () => {
		it('deletes the key', async () => {
			prismaMock.zurgKeys.delete.mockResolvedValue({});

			await service.deleteApiKey('key1');

			expect(prismaMock.zurgKeys.delete).toHaveBeenCalledWith({
				where: { apiKey: 'key1' },
			});
		});
	});

	describe('deleteExpiredKeys', () => {
		it('returns count of deleted keys', async () => {
			prismaMock.zurgKeys.deleteMany.mockResolvedValue({ count: 3 });

			const count = await service.deleteExpiredKeys();

			expect(count).toBe(3);
			expect(prismaMock.zurgKeys.deleteMany).toHaveBeenCalledWith({
				where: {
					validUntil: { lt: expect.any(Date) },
				},
			});
		});
	});

	describe('listApiKeys', () => {
		it('returns keys with isExpired flag', async () => {
			const now = new Date();
			const future = new Date(now.getTime() + 86400000);
			const past = new Date(now.getTime() - 86400000);

			prismaMock.zurgKeys.findMany.mockResolvedValue([
				{ apiKey: 'active', validUntil: future, createdAt: now },
				{ apiKey: 'expired', validUntil: past, createdAt: now },
				{ apiKey: 'noexpiry', validUntil: null, createdAt: now },
			]);

			const keys = await service.listApiKeys();

			expect(keys).toHaveLength(3);
			expect(keys[0].isExpired).toBe(false);
			expect(keys[1].isExpired).toBe(true);
			expect(keys[2].isExpired).toBe(false);
		});

		it('returns empty array when no keys exist', async () => {
			prismaMock.zurgKeys.findMany.mockResolvedValue([]);

			const keys = await service.listApiKeys();

			expect(keys).toEqual([]);
		});
	});
});
