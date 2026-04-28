import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { TorBoxCastService } from './torboxCast';

const prismaMock = vi.hoisted(() => ({
	torBoxCastProfile: {
		upsert: vi.fn(),
		findUnique: vi.fn(),
	},
	torBoxCast: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		upsert: vi.fn(),
		delete: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('TorBoxCastService', () => {
	let service: TorBoxCastService;

	beforeEach(() => {
		service = new TorBoxCastService();
		Object.values(prismaMock.torBoxCastProfile).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.torBoxCast).forEach((fn) => (fn as Mock).mockReset());
	});

	describe('saveCastProfile', () => {
		it('upserts a profile with all fields', async () => {
			prismaMock.torBoxCastProfile.upsert.mockResolvedValue({});

			await service.saveCastProfile('u1', 'key1', 10, 5, 3, true);

			expect(prismaMock.torBoxCastProfile.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { userId: 'u1' },
					create: expect.objectContaining({
						movieMaxSize: 10,
						episodeMaxSize: 5,
						otherStreamsLimit: 3,
						hideCastOption: true,
					}),
				})
			);
		});

		it('uses defaults when optional params are omitted', async () => {
			prismaMock.torBoxCastProfile.upsert.mockResolvedValue({});

			await service.saveCastProfile('u1', 'key1');

			expect(prismaMock.torBoxCastProfile.upsert).toHaveBeenCalledWith(
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
			prismaMock.torBoxCast.findFirst.mockResolvedValue({
				url: 'http://tb.com/movie.mkv',
				link: 'http://tb.link/123',
			});

			const result = await service.getLatestCast('tt123', 'u1');

			expect(result).toEqual({
				url: 'http://tb.com/movie.mkv',
				link: 'http://tb.link/123',
			});
		});

		it('returns null when not found', async () => {
			prismaMock.torBoxCast.findFirst.mockResolvedValue(null);

			expect(await service.getLatestCast('tt123', 'u1')).toBeNull();
		});

		it('returns null when link is missing', async () => {
			prismaMock.torBoxCast.findFirst.mockResolvedValue({
				url: 'http://tb.com/movie.mkv',
				link: null,
			});

			expect(await service.getLatestCast('tt123', 'u1')).toBeNull();
		});
	});

	describe('getCastURLs', () => {
		it('filters null links and converts size', async () => {
			prismaMock.torBoxCast.findMany.mockResolvedValue([
				{ url: 'http://tb.com/f1.mkv', link: 'http://tb/1', size: BigInt(2048) },
				{ url: 'http://tb.com/f2.mkv', link: null, size: BigInt(1024) },
			]);

			const results = await service.getCastURLs('tt123', 'u1');

			expect(results).toEqual([
				{ url: 'http://tb.com/f1.mkv', link: 'http://tb/1', size: 2048 },
			]);
		});
	});

	describe('getOtherCastURLs', () => {
		it('returns casts from other users with size filter', async () => {
			prismaMock.torBoxCast.findMany.mockResolvedValue([
				{ url: 'http://tb.com/f1.mkv', link: 'http://tb/1', size: BigInt(5000) },
			]);

			const results = await service.getOtherCastURLs('tt123', 'u1');

			expect(results).toEqual([
				{ url: 'http://tb.com/f1.mkv', link: 'http://tb/1', size: 5000 },
			]);
			expect(prismaMock.torBoxCast.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						userId: { not: 'u1' },
						size: { gt: 10 },
					}),
					take: 2,
				})
			);
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
			prismaMock.torBoxCastProfile.findUnique.mockResolvedValue(profile);

			expect(await service.getCastProfile('u1')).toEqual(profile);
		});

		it('returns null when not found', async () => {
			prismaMock.torBoxCastProfile.findUnique.mockResolvedValue(null);

			expect(await service.getCastProfile('u1')).toBeNull();
		});
	});

	describe('saveCast', () => {
		it('upserts a cast entry with BigInt size', async () => {
			prismaMock.torBoxCast.upsert.mockResolvedValue({});

			await service.saveCast(
				'tt123',
				'u1',
				'hash1',
				'http://tb.com/f.mkv',
				'http://tb/1',
				1024000,
				42,
				3
			);

			expect(prismaMock.torBoxCast.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { imdbId_userId_hash: { imdbId: 'tt123', userId: 'u1', hash: 'hash1' } },
					create: expect.objectContaining({
						size: BigInt(1024000),
						torrentId: 42,
						fileId: 3,
					}),
				})
			);
		});
	});

	describe('fetchCastedMovies', () => {
		it('returns distinct movie imdbIds', async () => {
			prismaMock.torBoxCast.findMany.mockResolvedValue([
				{ imdbId: 'tt001' },
				{ imdbId: 'tt002' },
			]);

			expect(await service.fetchCastedMovies('u1')).toEqual(['tt001', 'tt002']);
		});
	});

	describe('fetchCastedShows', () => {
		it('extracts unique base imdbIds from episode entries', async () => {
			prismaMock.torBoxCast.findMany.mockResolvedValue([
				{ imdbId: 'tt001:1:1' },
				{ imdbId: 'tt001:1:2' },
				{ imdbId: 'tt002:2:1' },
			]);

			expect(await service.fetchCastedShows('u1')).toEqual(['tt001', 'tt002']);
		});
	});

	describe('fetchAllCastedLinks', () => {
		it('converts bigint size to number', async () => {
			const updatedAt = new Date();
			prismaMock.torBoxCast.findMany.mockResolvedValue([
				{
					imdbId: 'tt123',
					url: 'http://tb.com/f.mkv',
					hash: 'h1',
					size: BigInt(99999),
					updatedAt,
				},
			]);

			const result = await service.fetchAllCastedLinks('u1');

			expect(result).toEqual([
				{ imdbId: 'tt123', url: 'http://tb.com/f.mkv', hash: 'h1', size: 99999, updatedAt },
			]);
		});
	});

	describe('deleteCastedLink', () => {
		it('deletes the cast entry', async () => {
			prismaMock.torBoxCast.delete.mockResolvedValue({});

			await service.deleteCastedLink('tt123', 'u1', 'h1');

			expect(prismaMock.torBoxCast.delete).toHaveBeenCalledWith({
				where: { imdbId_userId_hash: { imdbId: 'tt123', userId: 'u1', hash: 'h1' } },
			});
		});

		it('throws with message when delete fails', async () => {
			prismaMock.torBoxCast.delete.mockRejectedValue(new Error('Record not found'));

			await expect(service.deleteCastedLink('tt123', 'u1', 'h1')).rejects.toThrow(
				'Failed to delete casted link: Record not found'
			);
		});
	});

	describe('getAllUserCasts', () => {
		it('maps casts with bigint size to number', async () => {
			prismaMock.torBoxCast.findMany.mockResolvedValue([
				{
					imdbId: 'tt1',
					hash: 'h1',
					url: 'http://tb.com/f.mkv',
					link: 'http://tb/1',
					size: BigInt(5000),
				},
			]);

			expect(await service.getAllUserCasts('u1')).toEqual([
				{
					imdbId: 'tt1',
					hash: 'h1',
					url: 'http://tb.com/f.mkv',
					link: 'http://tb/1',
					size: 5000,
				},
			]);
		});
	});

	describe('getUserCastStreams', () => {
		it('returns streams with extracted filename and torrent fields', async () => {
			prismaMock.torBoxCast.findMany.mockResolvedValue([
				{
					url: 'http://tb.com/path/Movie.mkv',
					link: 'http://tb/1',
					size: BigInt(2048),
					hash: 'h1',
					torrentId: 10,
					fileId: 2,
				},
			]);

			const result = await service.getUserCastStreams('tt123', 'u1');

			expect(result).toEqual([
				{
					url: 'http://tb.com/path/Movie.mkv',
					link: 'http://tb/1',
					size: 2048,
					filename: 'Movie.mkv',
					hash: 'h1',
					torrentId: 10,
					fileId: 2,
				},
			]);
		});

		it('respects limit parameter', async () => {
			prismaMock.torBoxCast.findMany.mockResolvedValue([]);

			await service.getUserCastStreams('tt123', 'u1', 3);

			expect(prismaMock.torBoxCast.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 3 })
			);
		});
	});

	describe('getOtherStreams', () => {
		it('returns streams from other users', async () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			prismaMock.torBoxCast.findMany.mockResolvedValue([
				{
					url: 'http://tb.com/path/Movie.mkv',
					link: 'http://tb/1',
					size: BigInt(2048),
					hash: 'h1',
					torrentId: null,
					fileId: null,
				},
			]);

			const result = await service.getOtherStreams('tt123', 'u1', 5);

			expect(result).toHaveLength(1);
			expect(result[0].filename).toBe('Movie.mkv');
			consoleSpy.mockRestore();
		});

		it('applies maxSize as MB-based BigInt limit', async () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			prismaMock.torBoxCast.findMany.mockResolvedValue([]);

			await service.getOtherStreams('tt123', 'u1', 5, 5);

			expect(prismaMock.torBoxCast.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						size: expect.objectContaining({ lte: BigInt(5120) }),
					}),
				})
			);
			consoleSpy.mockRestore();
		});

		it('omits maxSize constraint when not provided', async () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			prismaMock.torBoxCast.findMany.mockResolvedValue([]);

			await service.getOtherStreams('tt123', 'u1', 5);

			const callArgs = prismaMock.torBoxCast.findMany.mock.calls[0][0];
			expect(callArgs.where.size).not.toHaveProperty('lte');
			consoleSpy.mockRestore();
		});
	});
});
