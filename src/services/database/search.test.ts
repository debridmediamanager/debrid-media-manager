import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchService } from './search';

vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn(function () {
		return {
			search: {
				upsert: vi.fn(),
				findUnique: vi.fn(),
			},
			$disconnect: vi.fn(),
		};
	}),
}));

describe('SearchService', () => {
	let service: SearchService;
	let mockPrisma: any;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new SearchService();
		mockPrisma = (service as any).prisma;
	});

	describe('saveSearchResults', () => {
		it('upserts search results with correct parameters', async () => {
			const key = 'test-search-key';
			const value = { results: ['item1', 'item2'] };

			mockPrisma.search.upsert.mockResolvedValue({
				key,
				value,
				updatedAt: new Date(),
			});

			await service.saveSearchResults(key, value);

			expect(mockPrisma.search.upsert).toHaveBeenCalledWith({
				where: { key },
				update: { value },
				create: { key, value },
			});
		});

		it('handles string values', async () => {
			const key = 'string-key';
			const value = 'test string';

			mockPrisma.search.upsert.mockResolvedValue({
				key,
				value,
				updatedAt: new Date(),
			});

			await service.saveSearchResults(key, value);

			expect(mockPrisma.search.upsert).toHaveBeenCalledWith({
				where: { key },
				update: { value },
				create: { key, value },
			});
		});

		it('handles array values', async () => {
			const key = 'array-key';
			const value = [1, 2, 3, 4, 5];

			mockPrisma.search.upsert.mockResolvedValue({
				key,
				value,
				updatedAt: new Date(),
			});

			await service.saveSearchResults(key, value);

			expect(mockPrisma.search.upsert).toHaveBeenCalledWith({
				where: { key },
				update: { value },
				create: { key, value },
			});
		});

		it('handles complex nested objects', async () => {
			const key = 'complex-key';
			const value = {
				nested: {
					data: {
						deep: {
							value: 'test',
						},
					},
				},
			};

			mockPrisma.search.upsert.mockResolvedValue({
				key,
				value,
				updatedAt: new Date(),
			});

			await service.saveSearchResults(key, value);

			expect(mockPrisma.search.upsert).toHaveBeenCalledWith({
				where: { key },
				update: { value },
				create: { key, value },
			});
		});
	});

	describe('getSearchResults', () => {
		it('returns cached results when found and fresh (< 48 hours)', async () => {
			const key = 'test-key';
			const value = { results: ['item1', 'item2'] };
			const recentDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

			mockPrisma.search.findUnique.mockResolvedValue({
				key,
				value,
				updatedAt: recentDate,
			});

			const result = await service.getSearchResults(key);

			expect(result).toEqual(value);
			expect(mockPrisma.search.findUnique).toHaveBeenCalledWith({
				where: { key },
			});
		});

		it('returns undefined when cache is expired (> 48 hours)', async () => {
			const key = 'test-key';
			const value = { results: ['item1', 'item2'] };
			const oldDate = new Date(Date.now() - 50 * 60 * 60 * 1000); // 50 hours ago

			mockPrisma.search.findUnique.mockResolvedValue({
				key,
				value,
				updatedAt: oldDate,
			});

			const result = await service.getSearchResults(key);

			expect(result).toBeUndefined();
		});

		it('returns undefined when no cache entry exists', async () => {
			const key = 'nonexistent-key';

			mockPrisma.search.findUnique.mockResolvedValue(null);

			const result = await service.getSearchResults(key);

			expect(result).toBeUndefined();
		});

		it('handles cache at exactly 48 hours boundary', async () => {
			const key = 'test-key';
			const value = { results: ['item1'] };
			const exactDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // Exactly 48 hours

			mockPrisma.search.findUnique.mockResolvedValue({
				key,
				value,
				updatedAt: exactDate,
			});

			const result = await service.getSearchResults(key);

			// Should still return data at exactly 48 hours
			expect(result).toEqual(value);
		});

		it('handles cache at 48.1 hours (just expired)', async () => {
			const key = 'test-key';
			const value = { results: ['item1'] };
			const slightlyExpiredDate = new Date(Date.now() - 48.1 * 60 * 60 * 1000); // 48.1 hours

			mockPrisma.search.findUnique.mockResolvedValue({
				key,
				value,
				updatedAt: slightlyExpiredDate,
			});

			const result = await service.getSearchResults(key);

			expect(result).toBeUndefined();
		});

		it('correctly types the returned value', async () => {
			interface TestType {
				id: number;
				name: string;
			}

			const key = 'typed-key';
			const value: TestType = { id: 1, name: 'test' };
			const recentDate = new Date(Date.now() - 1000);

			mockPrisma.search.findUnique.mockResolvedValue({
				key,
				value,
				updatedAt: recentDate,
			});

			const result = await service.getSearchResults<TestType>(key);

			expect(result).toEqual(value);
			if (result) {
				expect(result.id).toBe(1);
				expect(result.name).toBe('test');
			}
		});

		it('handles very recent cache (< 1 hour)', async () => {
			const key = 'recent-key';
			const value = { data: 'fresh' };
			const veryRecentDate = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago

			mockPrisma.search.findUnique.mockResolvedValue({
				key,
				value,
				updatedAt: veryRecentDate,
			});

			const result = await service.getSearchResults(key);

			expect(result).toEqual(value);
		});
	});
});
