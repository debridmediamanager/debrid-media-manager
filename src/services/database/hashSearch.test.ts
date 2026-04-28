import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HashSearchService } from './hashSearch';

const prismaMock = vi.hoisted(() => ({
	available: {
		findMany: vi.fn(),
	},
	cast: {
		findMany: vi.fn(),
	},
	scraped: {
		findUnique: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('HashSearchService', () => {
	let service: HashSearchService;

	beforeEach(() => {
		service = new HashSearchService();
		(prismaMock.available.findMany as Mock).mockReset();
		(prismaMock.cast.findMany as Mock).mockReset();
		(prismaMock.scraped.findUnique as Mock).mockReset();
	});

	describe('getHashesByImdbId', () => {
		it('returns available results when enough are found', async () => {
			prismaMock.available.findMany.mockResolvedValue([
				{
					hash: 'h1',
					filename: 'Movie.mkv',
					originalFilename: 'Movie.mkv',
					bytes: BigInt(5368709120),
					imdbId: 'tt123',
				},
				{
					hash: 'h2',
					filename: 'Movie2.mkv',
					originalFilename: 'Movie2.mkv',
					bytes: BigInt(3221225472),
					imdbId: 'tt123',
				},
				{
					hash: 'h3',
					filename: 'Movie3.mkv',
					originalFilename: 'Movie3.mkv',
					bytes: BigInt(2147483648),
					imdbId: 'tt123',
				},
				{
					hash: 'h4',
					filename: 'Movie4.mkv',
					originalFilename: 'Movie4.mkv',
					bytes: BigInt(1073741824),
					imdbId: 'tt123',
				},
				{
					hash: 'h5',
					filename: 'Movie5.mkv',
					originalFilename: 'Movie5.mkv',
					bytes: BigInt(536870912),
					imdbId: 'tt123',
				},
			]);

			const results = await service.getHashesByImdbId({ imdbId: 'tt123', limit: 5 });

			expect(results).toHaveLength(5);
			expect(results[0].source).toBe('available');
			expect(prismaMock.cast.findMany).not.toHaveBeenCalled();
			expect(prismaMock.scraped.findUnique).not.toHaveBeenCalled();
		});

		it('falls through to cast when available returns fewer than limit', async () => {
			prismaMock.available.findMany.mockResolvedValue([
				{
					hash: 'h1',
					filename: 'Movie.mkv',
					originalFilename: 'Movie.mkv',
					bytes: BigInt(1073741824),
					imdbId: 'tt123',
				},
			]);
			prismaMock.cast.findMany.mockResolvedValue([
				{
					hash: 'h2',
					url: 'http://example.com/Movie2.mkv',
					size: BigInt(2048),
					imdbId: 'tt123',
				},
			]);

			const results = await service.getHashesByImdbId({ imdbId: 'tt123', limit: 5 });

			expect(results).toHaveLength(2);
			expect(results[0].source).toBe('available');
			expect(results[1].source).toBe('cast');
		});

		it('falls through to scraped when available and cast return fewer than limit', async () => {
			prismaMock.available.findMany.mockResolvedValue([]);
			prismaMock.cast.findMany.mockResolvedValue([]);
			prismaMock.scraped.findUnique
				.mockResolvedValueOnce({
					key: 'movie:tt123',
					value: [{ hash: 'h1', title: 'Movie.mkv', fileSize: 1024 }],
				})
				.mockResolvedValueOnce(null);

			const results = await service.getHashesByImdbId({ imdbId: 'tt123', limit: 5 });

			expect(results).toHaveLength(1);
			expect(results[0].source).toBe('scraped');
			expect(results[0].size).toBe(1024 * 1024 * 1024);
		});

		it('tries tv key when movie key returns null', async () => {
			prismaMock.available.findMany.mockResolvedValue([]);
			prismaMock.cast.findMany.mockResolvedValue([]);
			prismaMock.scraped.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
				key: 'tv:tt456',
				value: [{ hash: 'h1', title: 'Show.S01E01.mkv', fileSize: 512 }],
			});

			const results = await service.getHashesByImdbId({ imdbId: 'tt456', limit: 5 });

			expect(results).toHaveLength(1);
			expect(results[0].source).toBe('scraped');
		});

		it('applies size filters to available results', async () => {
			prismaMock.available.findMany.mockResolvedValue([]);
			prismaMock.cast.findMany.mockResolvedValue([]);
			prismaMock.scraped.findUnique.mockResolvedValue(null);

			await service.getHashesByImdbId({
				imdbId: 'tt123',
				sizeFilters: { min: 1, max: 10 },
			});

			expect(prismaMock.available.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						bytes: {
							gte: BigInt(Math.floor(1 * 1024 * 1024 * 1024)),
							lte: BigInt(Math.floor(10 * 1024 * 1024 * 1024)),
						},
					}),
				})
			);
		});

		it('applies MB-based size filters to cast results', async () => {
			prismaMock.available.findMany.mockResolvedValue([]);
			prismaMock.cast.findMany.mockResolvedValue([]);
			prismaMock.scraped.findUnique.mockResolvedValue(null);

			await service.getHashesByImdbId({
				imdbId: 'tt123',
				sizeFilters: { min: 2 },
			});

			expect(prismaMock.cast.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						size: { gte: BigInt(2 * 1024) },
					}),
				})
			);
		});

		it('filters scraped results by size', async () => {
			prismaMock.available.findMany.mockResolvedValue([]);
			prismaMock.cast.findMany.mockResolvedValue([]);
			prismaMock.scraped.findUnique
				.mockResolvedValueOnce({
					key: 'movie:tt123',
					value: [
						{ hash: 'h1', title: 'Small.mkv', fileSize: 100 },
						{ hash: 'h2', title: 'Big.mkv', fileSize: 5120 },
					],
				})
				.mockResolvedValueOnce(null);

			const results = await service.getHashesByImdbId({
				imdbId: 'tt123',
				sizeFilters: { min: 1 },
			});

			expect(results).toHaveLength(1);
			expect(results[0].hash).toBe('h2');
		});

		it('applies blacklist substring filter', async () => {
			prismaMock.available.findMany.mockResolvedValue([
				{
					hash: 'h1',
					filename: 'Movie.CAM.mkv',
					originalFilename: 'Movie.CAM.mkv',
					bytes: BigInt(1073741824),
					imdbId: 'tt123',
				},
				{
					hash: 'h2',
					filename: 'Movie.BluRay.mkv',
					originalFilename: 'Movie.BluRay.mkv',
					bytes: BigInt(2147483648),
					imdbId: 'tt123',
				},
			]);
			prismaMock.cast.findMany.mockResolvedValue([]);
			prismaMock.scraped.findUnique.mockResolvedValue(null);

			const results = await service.getHashesByImdbId({
				imdbId: 'tt123',
				substringFilters: { blacklist: ['CAM'] },
			});

			expect(results).toHaveLength(1);
			expect(results[0].filename).toBe('Movie.BluRay.mkv');
		});

		it('applies whitelist substring filter', async () => {
			prismaMock.available.findMany.mockResolvedValue([
				{
					hash: 'h1',
					filename: 'Movie.720p.mkv',
					originalFilename: 'Movie.720p.mkv',
					bytes: BigInt(1073741824),
					imdbId: 'tt123',
				},
				{
					hash: 'h2',
					filename: 'Movie.1080p.mkv',
					originalFilename: 'Movie.1080p.mkv',
					bytes: BigInt(2147483648),
					imdbId: 'tt123',
				},
			]);
			prismaMock.cast.findMany.mockResolvedValue([]);
			prismaMock.scraped.findUnique.mockResolvedValue(null);

			const results = await service.getHashesByImdbId({
				imdbId: 'tt123',
				substringFilters: { whitelist: ['1080p'] },
			});

			expect(results).toHaveLength(1);
			expect(results[0].filename).toBe('Movie.1080p.mkv');
		});

		it('uses default limit of 5', async () => {
			const items = Array.from({ length: 10 }, (_, i) => ({
				hash: `h${i}`,
				filename: `Movie${i}.mkv`,
				originalFilename: `Movie${i}.mkv`,
				bytes: BigInt(1073741824),
				imdbId: 'tt123',
			}));
			prismaMock.available.findMany.mockResolvedValue(items);

			const results = await service.getHashesByImdbId({ imdbId: 'tt123' });

			expect(results).toHaveLength(5);
		});

		it('returns empty when no sources have data', async () => {
			prismaMock.available.findMany.mockResolvedValue([]);
			prismaMock.cast.findMany.mockResolvedValue([]);
			prismaMock.scraped.findUnique.mockResolvedValue(null);

			const results = await service.getHashesByImdbId({ imdbId: 'tt999' });

			expect(results).toEqual([]);
		});

		it('converts cast size from MB to bytes in output', async () => {
			prismaMock.available.findMany.mockResolvedValue([]);
			prismaMock.cast.findMany.mockResolvedValue([
				{
					hash: 'h1',
					url: 'http://example.com/Movie.mkv',
					size: BigInt(2048),
					imdbId: 'tt123',
				},
			]);

			const results = await service.getHashesByImdbId({ imdbId: 'tt123', limit: 1 });

			expect(results[0].size).toBe(2048 * 1024 * 1024);
			expect(results[0].sizeGB).toBe(2048 / 1024);
		});

		it('extracts filename from cast url', async () => {
			prismaMock.available.findMany.mockResolvedValue([]);
			prismaMock.cast.findMany.mockResolvedValue([
				{
					hash: 'h1',
					url: 'http://example.com/path/to/Movie.mkv',
					size: BigInt(1024),
					imdbId: 'tt123',
				},
			]);

			const results = await service.getHashesByImdbId({ imdbId: 'tt123', limit: 1 });

			expect(results[0].filename).toBe('Movie.mkv');
		});

		it('matches originalFilename for substring filters on available results', async () => {
			prismaMock.available.findMany.mockResolvedValue([
				{
					hash: 'h1',
					filename: 'renamed.mkv',
					originalFilename: 'Movie.1080p.mkv',
					bytes: BigInt(1073741824),
					imdbId: 'tt123',
				},
			]);
			prismaMock.cast.findMany.mockResolvedValue([]);
			prismaMock.scraped.findUnique.mockResolvedValue(null);

			const results = await service.getHashesByImdbId({
				imdbId: 'tt123',
				substringFilters: { whitelist: ['1080p'] },
			});

			expect(results).toHaveLength(1);
		});
	});
});
