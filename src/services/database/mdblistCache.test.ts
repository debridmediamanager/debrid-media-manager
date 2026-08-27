import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMdblistCacheService, MdblistCacheService } from './mdblistCache';

vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn(() => ({
		mdblistCache: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
			upsert: vi.fn(),
		},
		$queryRaw: vi.fn(),
		$disconnect: vi.fn(),
	})),
	Prisma: {
		sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
		join: (values: unknown[]) => values,
	},
}));

describe('MdblistCacheService', () => {
	let service: MdblistCacheService;
	let mockPrisma: any;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new MdblistCacheService();
		mockPrisma = (service as any).prisma;
	});

	describe('getTitles', () => {
		const idsIn = (call: any) => call[0].values[0];

		it('returns a title per cached id', async () => {
			mockPrisma.$queryRaw.mockResolvedValue([
				{ id: 'tt1', title: 'First' },
				{ id: 'tt2', title: 'Second' },
			]);

			const result = await service.getTitles(['tt1', 'tt2', 'tt3']);

			expect(result).toEqual(
				new Map([
					['tt1', 'First'],
					['tt2', 'Second'],
				])
			);
			expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
			expect(idsIn(mockPrisma.$queryRaw.mock.calls[0])).toEqual(['tt1', 'tt2', 'tt3']);
		});

		it('reads the title in SQL instead of hauling the cached payload', async () => {
			mockPrisma.$queryRaw.mockResolvedValue([]);

			await service.getTitles(['tt1']);

			const sql = mockPrisma.$queryRaw.mock.calls[0][0].strings.join('');
			expect(sql).toContain("JSON_EXTRACT(data, '$.title')");
			expect(sql).not.toContain('SELECT *');
			expect(mockPrisma.mdblistCache.findMany).not.toHaveBeenCalled();
		});

		it('skips rows with no usable title', async () => {
			mockPrisma.$queryRaw.mockResolvedValue([
				{ id: 'tt1', title: null },
				{ id: 'tt2', title: '' },
				{ id: 'tt3', title: 'null' },
				{ id: 'tt4', title: 'Real' },
			]);

			expect(await service.getTitles(['tt1', 'tt2', 'tt3', 'tt4'])).toEqual(
				new Map([['tt4', 'Real']])
			);
		});

		it('chunks a catalog too big for one IN list', async () => {
			const ids = Array.from({ length: 2500 }, (_, i) => `tt${i}`);
			mockPrisma.$queryRaw.mockResolvedValue([]);

			await service.getTitles(ids);

			expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(3);
			expect(mockPrisma.$queryRaw.mock.calls.map((c: any) => idsIn(c).length)).toEqual([
				1000, 1000, 500,
			]);
		});

		it('does not query for an empty catalog', async () => {
			expect(await service.getTitles([])).toEqual(new Map());
			expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
		});

		it('returns no titles rather than failing the catalog on a db error', async () => {
			mockPrisma.$queryRaw.mockRejectedValue(new Error('db down'));

			expect(await service.getTitles(['tt1'])).toEqual(new Map());
		});
	});

	describe('get', () => {
		it('returns cached data when found', async () => {
			const mockData = { title: 'Test Movie', year: 2020 };
			mockPrisma.mdblistCache.findUnique.mockResolvedValue({
				id: 'tt123',
				type: 'movie',
				data: mockData,
				updatedAt: new Date(),
			});

			const result = await service.get('tt123');

			expect(result).toEqual(mockData);
			expect(mockPrisma.mdblistCache.findUnique).toHaveBeenCalledWith({
				where: { id: 'tt123' },
			});
		});

		it('returns null when no cache entry exists', async () => {
			mockPrisma.mdblistCache.findUnique.mockResolvedValue(null);

			const result = await service.get('tt999');

			expect(result).toBeNull();
		});

		it('returns null when error occurs', async () => {
			mockPrisma.mdblistCache.findUnique.mockRejectedValue(new Error('Database error'));

			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await service.get('tt123');

			expect(result).toBeNull();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				'Error getting MDBList cache:',
				expect.any(Error)
			);

			consoleErrorSpy.mockRestore();
		});
	});

	describe('getWithMetadata', () => {
		it('returns cached data with updatedAt timestamp', async () => {
			const mockData = { title: 'Test Movie', year: 2020 };
			const mockUpdatedAt = new Date('2024-01-01');

			mockPrisma.mdblistCache.findUnique.mockResolvedValue({
				id: 'tt123',
				type: 'movie',
				data: mockData,
				updatedAt: mockUpdatedAt,
			});

			const result = await service.getWithMetadata('tt123');

			expect(result).toEqual({
				data: mockData,
				updatedAt: mockUpdatedAt,
			});
		});

		it('returns null when no cache entry exists', async () => {
			mockPrisma.mdblistCache.findUnique.mockResolvedValue(null);

			const result = await service.getWithMetadata('tt999');

			expect(result).toBeNull();
		});

		it('returns null when error occurs', async () => {
			mockPrisma.mdblistCache.findUnique.mockRejectedValue(new Error('Database error'));

			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await service.getWithMetadata('tt123');

			expect(result).toBeNull();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				'Error getting MDBList cache with metadata:',
				expect.any(Error)
			);

			consoleErrorSpy.mockRestore();
		});
	});

	describe('set', () => {
		it('upserts cache entry with correct parameters', async () => {
			const mockData = { title: 'Test Movie', year: 2020 };

			mockPrisma.mdblistCache.upsert.mockResolvedValue({
				id: 'tt123',
				type: 'movie',
				data: mockData,
				updatedAt: new Date(),
			});

			await service.set('tt123', 'movie', mockData);

			expect(mockPrisma.mdblistCache.upsert).toHaveBeenCalledWith({
				where: { id: 'tt123' },
				update: {
					data: mockData,
					type: 'movie',
				},
				create: {
					id: 'tt123',
					type: 'movie',
					data: mockData,
				},
			});
		});

		it('handles errors gracefully', async () => {
			mockPrisma.mdblistCache.upsert.mockRejectedValue(new Error('Database error'));

			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await service.set('tt123', 'movie', {});

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				'Error setting MDBList cache:',
				expect.any(Error)
			);

			consoleErrorSpy.mockRestore();
		});

		it('updates existing entry', async () => {
			const newData = { title: 'Updated Movie', year: 2021 };

			mockPrisma.mdblistCache.upsert.mockResolvedValue({
				id: 'tt123',
				type: 'movie',
				data: newData,
				updatedAt: new Date(),
			});

			await service.set('tt123', 'movie', newData);

			expect(mockPrisma.mdblistCache.upsert).toHaveBeenCalled();
		});
	});

	describe('cacheMovie', () => {
		it('calls set with movie type', async () => {
			const movieData = { title: 'Test Movie', type: 'movie', year: 2020 };
			const setSpy = vi.spyOn(service, 'set').mockResolvedValue();

			await service.cacheMovie('tt123', movieData as any);

			expect(setSpy).toHaveBeenCalledWith('tt123', 'movie', movieData);
		});
	});

	describe('cacheShow', () => {
		it('calls set with show type', async () => {
			const showData = { title: 'Test Show', type: 'show', year: 2020 };
			const setSpy = vi.spyOn(service, 'set').mockResolvedValue();

			await service.cacheShow('tt456', showData as any);

			expect(setSpy).toHaveBeenCalledWith('tt456', 'show', showData);
		});
	});

	describe('cacheSearch', () => {
		it('calls set with search type', async () => {
			const searchData = { search: [], total: 0, response: true };
			const setSpy = vi.spyOn(service, 'set').mockResolvedValue();

			await service.cacheSearch('search_key', searchData);

			expect(setSpy).toHaveBeenCalledWith('search_key', 'search', searchData);
		});
	});

	describe('cacheList', () => {
		it('calls set with list type', async () => {
			const listData = { id: 1, name: 'Top Movies', slug: 'top-movies' };
			const setSpy = vi.spyOn(service, 'set').mockResolvedValue();

			await service.cacheList('list_123', listData);

			expect(setSpy).toHaveBeenCalledWith('list_123', 'list', listData);
		});
	});

	describe('getCachedMovie', () => {
		it('calls get and returns movie data', async () => {
			const movieData = { title: 'Test Movie', type: 'movie' };
			const getSpy = vi.spyOn(service, 'get').mockResolvedValue(movieData);

			const result = await service.getCachedMovie('tt123');

			expect(getSpy).toHaveBeenCalledWith('tt123');
			expect(result).toEqual(movieData);
		});
	});

	describe('getCachedShow', () => {
		it('calls get and returns show data', async () => {
			const showData = { title: 'Test Show', type: 'show' };
			const getSpy = vi.spyOn(service, 'get').mockResolvedValue(showData);

			const result = await service.getCachedShow('tt456');

			expect(getSpy).toHaveBeenCalledWith('tt456');
			expect(result).toEqual(showData);
		});
	});

	describe('getCachedSearch', () => {
		it('calls get and returns search data', async () => {
			const searchData = { search: [], total: 0, response: true };
			const getSpy = vi.spyOn(service, 'get').mockResolvedValue(searchData);

			const result = await service.getCachedSearch('search_key');

			expect(getSpy).toHaveBeenCalledWith('search_key');
			expect(result).toEqual(searchData);
		});
	});

	describe('getCachedList', () => {
		it('calls get and returns list data', async () => {
			const listData = { id: 1, name: 'Top Movies' };
			const getSpy = vi.spyOn(service, 'get').mockResolvedValue(listData);

			const result = await service.getCachedList('list_123');

			expect(getSpy).toHaveBeenCalledWith('list_123');
			expect(result).toEqual(listData);
		});
	});
});

describe('getMdblistCacheService', () => {
	it('returns singleton instance', () => {
		const service1 = getMdblistCacheService();
		const service2 = getMdblistCacheService();

		expect(service1).toBe(service2);
		expect(service1).toBeInstanceOf(MdblistCacheService);
	});
});
