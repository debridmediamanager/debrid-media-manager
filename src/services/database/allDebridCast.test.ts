import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AllDebridCastService } from './allDebridCast';

const prismaMock = vi.hoisted(() => ({
	allDebridCastProfile: {
		upsert: vi.fn(),
		findUnique: vi.fn(),
		updateMany: vi.fn(),
	},
	allDebridCast: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		groupBy: vi.fn(),
		upsert: vi.fn(),
		delete: vi.fn(),
		deleteMany: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('AllDebridCastService', () => {
	let service: AllDebridCastService;

	beforeEach(() => {
		service = new AllDebridCastService();
		Object.values(prismaMock.allDebridCastProfile).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.allDebridCast).forEach((fn) => (fn as Mock).mockReset());
	});

	describe('updateCastSettings', () => {
		it('updates settings without touching the stored api key', async () => {
			prismaMock.allDebridCastProfile.updateMany.mockResolvedValue({ count: 1 });

			const updated = await service.updateCastSettings('u1', 10, 5, 3, true);

			expect(updated).toBe(true);
			const call = prismaMock.allDebridCastProfile.updateMany.mock.calls[0][0];
			expect(call.where).toEqual({ userId: 'u1' });
			expect(call.data).toEqual(
				expect.objectContaining({
					movieMaxSize: 10,
					episodeMaxSize: 5,
					otherStreamsLimit: 3,
					hideCastOption: true,
				})
			);
			expect(call.data).not.toHaveProperty('apiKey');
		});

		it('omits fields that were not supplied', async () => {
			prismaMock.allDebridCastProfile.updateMany.mockResolvedValue({ count: 1 });

			await service.updateCastSettings('u1', undefined, undefined, undefined, true);

			const call = prismaMock.allDebridCastProfile.updateMany.mock.calls[0][0];
			expect(call.data).not.toHaveProperty('movieMaxSize');
			expect(call.data).not.toHaveProperty('episodeMaxSize');
			expect(call.data).not.toHaveProperty('otherStreamsLimit');
			expect(call.data.hideCastOption).toBe(true);
		});

		it('reports false when there is no such profile', async () => {
			prismaMock.allDebridCastProfile.updateMany.mockResolvedValue({ count: 0 });

			expect(await service.updateCastSettings('missing', 1)).toBe(false);
		});
	});

	describe('saveCastProfile', () => {
		it('upserts a profile with all fields', async () => {
			const profile = { userId: 'u1', apiKey: 'key1' };
			prismaMock.allDebridCastProfile.upsert.mockResolvedValue(profile);

			await service.saveCastProfile('u1', 'key1', 10, 5, 3, true);

			expect(prismaMock.allDebridCastProfile.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { userId: 'u1' },
					create: expect.objectContaining({
						userId: 'u1',
						apiKey: 'key1',
						movieMaxSize: 10,
						episodeMaxSize: 5,
						otherStreamsLimit: 3,
						hideCastOption: true,
					}),
				})
			);
		});

		it('uses defaults when optional params are omitted', async () => {
			prismaMock.allDebridCastProfile.upsert.mockResolvedValue({});

			await service.saveCastProfile('u1', 'key1');

			expect(prismaMock.allDebridCastProfile.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					create: expect.objectContaining({
						movieMaxSize: 0,
						episodeMaxSize: 0,
						otherStreamsLimit: 5,
						hideCastOption: false,
					}),
				})
			);
		});
	});

	describe('getLatestCast', () => {
		it('returns url and link when found', async () => {
			prismaMock.allDebridCast.findFirst.mockResolvedValue({
				url: 'http://example.com/movie.mkv',
				link: 'http://ad.link/123',
			});

			const result = await service.getLatestCast('tt123', 'u1');

			expect(result).toEqual({
				url: 'http://example.com/movie.mkv',
				link: 'http://ad.link/123',
			});
		});

		it('returns null when no cast found', async () => {
			prismaMock.allDebridCast.findFirst.mockResolvedValue(null);

			const result = await service.getLatestCast('tt123', 'u1');

			expect(result).toBeNull();
		});

		it('returns null when url or link is missing', async () => {
			prismaMock.allDebridCast.findFirst.mockResolvedValue({
				url: 'http://example.com/movie.mkv',
				link: null,
			});

			const result = await service.getLatestCast('tt123', 'u1');

			expect(result).toBeNull();
		});
	});

	describe('getCastURLs', () => {
		it('converts bigint size to number and filters out null links', async () => {
			prismaMock.allDebridCast.findMany.mockResolvedValue([
				{ url: 'http://a.com/f1.mkv', link: 'http://ad/1', size: BigInt(2048) },
				{ url: 'http://a.com/f2.mkv', link: null, size: BigInt(1024) },
			]);

			const results = await service.getCastURLs('tt123', 'u1');

			expect(results).toEqual([
				{ url: 'http://a.com/f1.mkv', link: 'http://ad/1', size: 2048 },
			]);
		});
	});

	describe('getCastProfile', () => {
		it('returns profile when found', async () => {
			const profile = {
				apiKey: 'key1',
				movieMaxSize: 10,
				episodeMaxSize: 5,
				otherStreamsLimit: 3,
				hideCastOption: false,
			};
			prismaMock.allDebridCastProfile.findUnique.mockResolvedValue(profile);

			const result = await service.getCastProfile('u1');

			expect(result).toEqual(profile);
		});

		it('returns null when not found', async () => {
			prismaMock.allDebridCastProfile.findUnique.mockResolvedValue(null);

			const result = await service.getCastProfile('u1');

			expect(result).toBeNull();
		});
	});

	describe('saveCast', () => {
		it('upserts a cast entry with BigInt size', async () => {
			prismaMock.allDebridCast.upsert.mockResolvedValue({});

			await service.saveCast(
				'tt123',
				'u1',
				'hash1',
				'http://a.com/f.mkv',
				'http://ad/1',
				1024000,
				42,
				3
			);

			expect(prismaMock.allDebridCast.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { imdbId_userId_hash: { imdbId: 'tt123', userId: 'u1', hash: 'hash1' } },
					create: expect.objectContaining({
						size: BigInt(1024000),
						magnetId: 42,
						fileIndex: 3,
					}),
				})
			);
		});
	});

	describe('fetchCastedMovies', () => {
		it('returns distinct movie imdbIds', async () => {
			prismaMock.allDebridCast.findMany.mockResolvedValue([
				{ imdbId: 'tt001' },
				{ imdbId: 'tt002' },
			]);

			const result = await service.fetchCastedMovies('u1');

			expect(result).toEqual(['tt001', 'tt002']);
			expect(prismaMock.allDebridCast.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						imdbId: { not: { contains: ':' } },
					}),
				})
			);
		});
	});

	describe('fetchCastedShows', () => {
		it('extracts unique base imdbIds from episode entries', async () => {
			prismaMock.allDebridCast.findMany.mockResolvedValue([
				{ imdbId: 'tt001:1:1' },
				{ imdbId: 'tt001:1:2' },
				{ imdbId: 'tt002:2:1' },
			]);

			const result = await service.fetchCastedShows('u1');

			expect(result).toEqual(['tt001', 'tt002']);
		});
	});

	describe('fetchAllCastedLinks', () => {
		it('converts bigint size to number', async () => {
			const updatedAt = new Date();
			prismaMock.allDebridCast.findMany.mockResolvedValue([
				{
					imdbId: 'tt123',
					url: 'http://a.com/f.mkv',
					hash: 'h1',
					size: BigInt(99999),
					updatedAt,
				},
			]);

			const result = await service.fetchAllCastedLinks('u1');

			expect(result).toEqual([
				{ imdbId: 'tt123', url: 'http://a.com/f.mkv', hash: 'h1', size: 99999, updatedAt },
			]);
		});
	});

	describe('deleteCastedLink', () => {
		it('deletes the cast entry and reports success', async () => {
			prismaMock.allDebridCast.deleteMany.mockResolvedValue({ count: 1 });

			await expect(service.deleteCastedLink('tt123', 'u1', 'h1')).resolves.toBe(true);

			expect(prismaMock.allDebridCast.deleteMany).toHaveBeenCalledWith({
				where: { imdbId: 'tt123', userId: 'u1', hash: 'h1' },
			});
		});

		it('reports false when there is no matching link', async () => {
			prismaMock.allDebridCast.deleteMany.mockResolvedValue({ count: 0 });

			await expect(service.deleteCastedLink('tt123', 'u1', 'h1')).resolves.toBe(false);
		});

		it('throws with message when delete fails', async () => {
			prismaMock.allDebridCast.deleteMany.mockRejectedValue(new Error('db down'));

			await expect(service.deleteCastedLink('tt123', 'u1', 'h1')).rejects.toThrow(
				'Failed to delete casted link: db down'
			);
		});
	});

	describe('getAllUserCasts', () => {
		it('maps casts with bigint size to number', async () => {
			prismaMock.allDebridCast.findMany.mockResolvedValue([
				{
					imdbId: 'tt1',
					hash: 'h1',
					url: 'http://a.com/f.mkv',
					link: 'http://ad/1',
					size: BigInt(5000),
				},
			]);

			const result = await service.getAllUserCasts('u1');

			expect(result).toEqual([
				{
					imdbId: 'tt1',
					hash: 'h1',
					url: 'http://a.com/f.mkv',
					link: 'http://ad/1',
					size: 5000,
				},
			]);
		});
	});

	describe('getUserCastStreams', () => {
		it('returns streams with extracted filename', async () => {
			prismaMock.allDebridCast.findMany.mockResolvedValue([
				{
					url: 'http://a.com/path/Movie.mkv',
					link: 'http://ad/1',
					size: BigInt(2048),
					hash: 'h1',
					magnetId: 10,
					fileIndex: 2,
				},
			]);

			const result = await service.getUserCastStreams('tt123', 'u1');

			expect(result).toEqual([
				{
					url: 'http://a.com/path/Movie.mkv',
					link: 'http://ad/1',
					size: 2048,
					filename: 'Movie.mkv',
					hash: 'h1',
					magnetId: 10,
					fileIndex: 2,
				},
			]);
		});

		it('respects limit parameter', async () => {
			prismaMock.allDebridCast.findMany.mockResolvedValue([]);

			await service.getUserCastStreams('tt123', 'u1', 3);

			expect(prismaMock.allDebridCast.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 3 })
			);
		});
	});

	describe('getOtherStreams', () => {
		it('returns streams from other users with size limit', async () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			prismaMock.allDebridCast.groupBy.mockResolvedValue([{ size: BigInt(2048) }]);
			prismaMock.allDebridCast.findFirst.mockResolvedValue({
				url: 'http://a.com/path/Movie.mkv',
				link: 'http://ad/1',
				size: BigInt(2048),
				hash: 'h1',
				magnetId: null,
				fileIndex: null,
			});

			const result = await service.getOtherStreams('tt123', 'u1', 5, 10);

			expect(result).toHaveLength(1);
			expect(result[0].filename).toBe('Movie.mkv');
			expect(prismaMock.allDebridCast.groupBy).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						userId: { not: 'u1' },
						size: expect.objectContaining({ gt: 10 }),
					}),
				})
			);
			consoleSpy.mockRestore();
		});

		it('dedupes by size in SQL and bounds the query with take', async () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			prismaMock.allDebridCast.groupBy.mockResolvedValue([]);

			await service.getOtherStreams('tt123', 'u1', 3);

			expect(prismaMock.allDebridCast.groupBy).toHaveBeenCalledWith(
				expect.objectContaining({ by: ['size'], take: 3 })
			);
			// `distinct` would force Prisma to drop the SQL LIMIT and read every row
			expect(prismaMock.allDebridCast.findMany).not.toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it('returns nothing and issues no query when the limit is zero', async () => {
			const result = await service.getOtherStreams('tt123', 'u1', 0);

			expect(result).toEqual([]);
			expect(prismaMock.allDebridCast.groupBy).not.toHaveBeenCalled();
			expect(prismaMock.allDebridCast.findMany).not.toHaveBeenCalled();
		});

		it('applies maxSize as MB-based BigInt limit', async () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			prismaMock.allDebridCast.groupBy.mockResolvedValue([]);

			await service.getOtherStreams('tt123', 'u1', 5, 5);

			expect(prismaMock.allDebridCast.groupBy).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						size: expect.objectContaining({ lte: BigInt(5120) }),
					}),
				})
			);
			consoleSpy.mockRestore();
		});
	});
});
