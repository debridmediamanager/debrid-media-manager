import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ImdbSearchService } from './imdbSearch';

const prismaMock = vi.hoisted(() => ({
	$queryRaw: vi.fn(),
	imdbTitleBasics: {
		findUnique: vi.fn(),
	},
	imdbTitleRatings: {
		findUnique: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('ImdbSearchService', () => {
	let service: ImdbSearchService;

	beforeEach(() => {
		service = new ImdbSearchService();
		(prismaMock.$queryRaw as Mock).mockReset();
		(prismaMock.imdbTitleBasics.findUnique as Mock).mockReset();
		(prismaMock.imdbTitleRatings.findUnique as Mock).mockReset();
	});

	describe('searchTitles', () => {
		it('returns empty array for empty keyword', async () => {
			const results = await service.searchTitles('');
			expect(results).toEqual([]);
			expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
		});

		it('returns empty array for keyword with only special characters', async () => {
			const results = await service.searchTitles('!@#$%');
			expect(results).toEqual([]);
		});

		it('returns results from basics fulltext search', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([
				{
					imdbId: 'tt0111161',
					type: 'movie',
					year: 1994,
					title: 'The Shawshank Redemption',
					originalTitle: 'The Shawshank Redemption',
					rating: 9.3,
					votes: 2500000,
					isOriginalMatch: 1,
				},
			]);

			const results = await service.searchTitles('Shawshank Redemption');

			expect(results).toHaveLength(1);
			expect(results[0].imdbId).toBe('tt0111161');
			expect(results[0].rating).toBe(9.3);
			expect(results[0].isOriginalMatch).toBe(true);
		});

		it('falls back to akas fulltext when basics returns empty', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
				{
					imdbId: 'tt001',
					type: 'movie',
					year: 2000,
					title: 'Foreign Title',
					originalTitle: null,
					rating: 7.0,
					votes: 100,
					isOriginalMatch: 0,
				},
			]);

			const results = await service.searchTitles('Foreign Title');

			expect(results).toHaveLength(1);
			expect(results[0].isOriginalMatch).toBe(false);
			expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
		});

		it('falls back to LIKE search when both fulltext searches fail', async () => {
			prismaMock.$queryRaw
				.mockRejectedValueOnce(new Error('fulltext index missing'))
				.mockRejectedValueOnce(new Error('fulltext index missing'))
				.mockResolvedValueOnce([
					{
						imdbId: 'tt002',
						type: 'show',
						year: 2020,
						title: 'Test Show',
						originalTitle: null,
						rating: null,
						votes: null,
						isOriginalMatch: 1,
					},
				]);

			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const results = await service.searchTitles('Test Show');

			expect(results).toHaveLength(1);
			expect(results[0].title).toBe('Test Show');
			expect(results[0].rating).toBeNull();
			consoleSpy.mockRestore();
		});

		it('falls back to LIKE when both fulltext return empty', async () => {
			prismaMock.$queryRaw
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					{
						imdbId: 'tt003',
						type: 'movie',
						year: 2023,
						title: 'Like Result',
						originalTitle: 'Like Result',
						rating: 6.0,
						votes: 50,
						isOriginalMatch: 1,
					},
				]);

			const results = await service.searchTitles('Like Result');

			expect(results).toHaveLength(1);
			expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(3);
		});

		it('skips fulltext for all-stopword queries', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([
				{
					imdbId: 'tt004',
					type: 'movie',
					year: 2020,
					title: 'The',
					originalTitle: 'The',
					rating: 5.0,
					votes: 10,
					isOriginalMatch: 1,
				},
			]);

			const results = await service.searchTitles('the');

			expect(results).toHaveLength(1);
			expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
		});

		it('uses title when originalTitle is null', async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([
				{
					imdbId: 'tt005',
					type: 'movie',
					year: 2020,
					title: null,
					originalTitle: 'Original Only',
					rating: null,
					votes: null,
					isOriginalMatch: 1,
				},
			]);

			const results = await service.searchTitles('Original');

			expect(results[0].title).toBe('Original Only');
		});

		it('passes year and mediaType filters', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);

			await service.searchTitles('test', { year: 2020, mediaType: 'movie' });

			expect(prismaMock.$queryRaw).toHaveBeenCalled();
		});

		it('passes limit option', async () => {
			prismaMock.$queryRaw.mockResolvedValue([]);

			await service.searchTitles('test', { limit: 10 });

			expect(prismaMock.$queryRaw).toHaveBeenCalled();
		});
	});

	describe('getTitleById', () => {
		it('returns null when title not found', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue(null);

			expect(await service.getTitleById('tt999')).toBeNull();
		});

		it('returns title details with rating', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				tconst: 'tt001',
				titleType: 'movie',
				startYear: 2020,
				primaryTitle: 'Test Movie',
				originalTitle: 'Test Movie Original',
			});
			prismaMock.imdbTitleRatings.findUnique.mockResolvedValue({
				tconst: 'tt001',
				averageRating: 7.5,
				numVotes: 1000,
			});

			const result = await service.getTitleById('tt001');

			expect(result).toEqual({
				imdbId: 'tt001',
				type: 'movie',
				year: 2020,
				title: 'Test Movie',
				originalTitle: 'Test Movie Original',
				rating: 7.5,
				votes: 1000,
				isOriginalMatch: true,
			});
		});

		it('returns null rating when no ratings record', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				tconst: 'tt001',
				titleType: 'tvSeries',
				startYear: 2021,
				primaryTitle: 'Test Show',
				originalTitle: null,
			});
			prismaMock.imdbTitleRatings.findUnique.mockResolvedValue(null);

			const result = await service.getTitleById('tt001');

			expect(result!.type).toBe('show');
			expect(result!.rating).toBeNull();
			expect(result!.votes).toBeNull();
		});

		it('uses originalTitle when primaryTitle is null', async () => {
			prismaMock.imdbTitleBasics.findUnique.mockResolvedValue({
				tconst: 'tt001',
				titleType: 'movie',
				startYear: null,
				primaryTitle: null,
				originalTitle: 'Fallback Title',
			});
			prismaMock.imdbTitleRatings.findUnique.mockResolvedValue(null);

			const result = await service.getTitleById('tt001');

			expect(result!.title).toBe('Fallback Title');
		});
	});
});
