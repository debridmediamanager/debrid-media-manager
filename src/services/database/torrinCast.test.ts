import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { TorrinCastService } from './torrinCast';

const prismaMock = vi.hoisted(() => ({
	torrinCastProfile: {
		upsert: vi.fn(),
		findUnique: vi.fn(),
	},
	torrinCast: {
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

describe('TorrinCastService', () => {
	let service: TorrinCastService;

	beforeEach(() => {
		service = new TorrinCastService();
		Object.values(prismaMock.torrinCastProfile).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.torrinCast).forEach((fn) => (fn as Mock).mockReset());
	});

	describe('saveCastProfile', () => {
		it('upserts a profile with baseUrl + apiKey and all fields', async () => {
			prismaMock.torrinCastProfile.upsert.mockResolvedValue({});

			await service.saveCastProfile('u1', 'https://tr.test', 'key1', 10, 5, 3, true);

			expect(prismaMock.torrinCastProfile.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { userId: 'u1' },
					create: expect.objectContaining({
						baseUrl: 'https://tr.test',
						apiKey: 'key1',
						movieMaxSize: 10,
						episodeMaxSize: 5,
						otherStreamsLimit: 3,
						hideCastOption: true,
					}),
				})
			);
		});
	});

	describe('getCastProfile', () => {
		it('returns the stored profile', async () => {
			prismaMock.torrinCastProfile.findUnique.mockResolvedValue({
				baseUrl: 'https://tr.test',
				apiKey: 'key',
				movieMaxSize: 0,
				episodeMaxSize: 0,
				otherStreamsLimit: 5,
				hideCastOption: false,
			});

			const result = await service.getCastProfile('u1');
			expect(result).toMatchObject({ baseUrl: 'https://tr.test', apiKey: 'key' });
		});
	});

	describe('saveCast', () => {
		it('upserts a cast row with the link and size as BigInt', async () => {
			prismaMock.torrinCast.upsert.mockResolvedValue({});

			await service.saveCast(
				'tt1',
				'u1',
				'hash',
				'https://url',
				'https://link',
				500,
				'https://tr.test'
			);

			expect(prismaMock.torrinCast.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { imdbId_userId_hash: { imdbId: 'tt1', userId: 'u1', hash: 'hash' } },
					create: expect.objectContaining({
						link: 'https://link',
						url: 'https://url',
						size: BigInt(500),
						baseUrl: 'https://tr.test',
					}),
				})
			);
		});
	});

	describe('fetchCastedMovies', () => {
		it('returns imdbIds excluding shows', async () => {
			prismaMock.torrinCast.findMany.mockResolvedValue([
				{ imdbId: 'tt1' },
				{ imdbId: 'tt2' },
			]);

			const result = await service.fetchCastedMovies('u1');
			expect(result).toEqual(['tt1', 'tt2']);
			expect(prismaMock.torrinCast.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						imdbId: { not: { contains: ':' } },
					}),
				})
			);
		});
	});

	describe('fetchCastedShows', () => {
		it('returns unique base imdbIds for shows', async () => {
			prismaMock.torrinCast.findMany.mockResolvedValue([
				{ imdbId: 'tt9:1:1' },
				{ imdbId: 'tt9:1:2' },
				{ imdbId: 'tt8:1:1' },
			]);

			const result = await service.fetchCastedShows('u1');
			expect(result).toEqual(['tt9', 'tt8']);
		});
	});

	describe('getUserCastStreams', () => {
		it('maps rows to streams with a derived filename', async () => {
			prismaMock.torrinCast.findMany.mockResolvedValue([
				{
					url: 'https://files/My.Movie.mkv',
					link: 'https://link',
					size: BigInt(1024),
					hash: 'h1',
				},
			]);

			const result = await service.getUserCastStreams('tt1', 'u1');
			expect(result).toEqual([
				{
					url: 'https://files/My.Movie.mkv',
					link: 'https://link',
					size: 1024,
					filename: 'My.Movie.mkv',
					hash: 'h1',
				},
			]);
		});

		it('drops rows without a link', async () => {
			prismaMock.torrinCast.findMany.mockResolvedValue([
				{ url: 'https://files/a.mkv', link: null, size: BigInt(1), hash: 'h1' },
			]);

			const result = await service.getUserCastStreams('tt1', 'u1');
			expect(result).toEqual([]);
		});
	});

	describe('deleteCastedLink', () => {
		it('deletes by composite key', async () => {
			prismaMock.torrinCast.delete.mockResolvedValue({});

			await service.deleteCastedLink('tt1', 'u1', 'hash');

			expect(prismaMock.torrinCast.delete).toHaveBeenCalledWith({
				where: { imdbId_userId_hash: { imdbId: 'tt1', userId: 'u1', hash: 'hash' } },
			});
		});

		it('wraps delete errors', async () => {
			prismaMock.torrinCast.delete.mockRejectedValue(new Error('nope'));
			await expect(service.deleteCastedLink('tt1', 'u1', 'hash')).rejects.toThrow(
				'Failed to delete casted link: nope'
			);
		});
	});
});
