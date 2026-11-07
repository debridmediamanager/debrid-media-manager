import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { EasynewsCastService } from './easynewsCast';

const prismaMock = vi.hoisted(() => ({
	easynewsCastProfile: {
		upsert: vi.fn(),
		findUnique: vi.fn(),
		updateMany: vi.fn(),
	},
	easynewsCast: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		groupBy: vi.fn(),
		upsert: vi.fn(),
		deleteMany: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('EasynewsCastService', () => {
	let service: EasynewsCastService;

	beforeEach(() => {
		service = new EasynewsCastService();
		Object.values(prismaMock.easynewsCastProfile).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.easynewsCast).forEach((fn) => (fn as Mock).mockReset());
		prismaMock.easynewsCast.groupBy.mockResolvedValue([]);
	});

	// Easynews signs a new link per request, and a caster's link handed to a viewer
	// would put the caster's account behind someone else's player.
	it('stores a hash and a path, never a link', async () => {
		await service.saveCast('tt123', 'user-1', 'hash', 'Movie.mkv', 700, 'hash.mkv/Movie.mkv');

		const call = prismaMock.easynewsCast.upsert.mock.calls[0][0];
		expect(call.create).toMatchObject({ hash: 'hash', path: 'hash.mkv/Movie.mkv' });
		expect(Object.keys(call.create)).not.toContain('link');
		expect(Object.keys(call.update)).not.toContain('link');
	});

	it('keeps a cast keyed on (imdbId, userId, hash)', async () => {
		await service.saveCast('tt123', 'user-1', 'hash', 'Movie.mkv', 700, 'hash.mkv/Movie.mkv');
		expect(prismaMock.easynewsCast.upsert.mock.calls[0][0].where).toEqual({
			imdbId_userId_hash: { imdbId: 'tt123', userId: 'user-1', hash: 'hash' },
		});
	});

	it('returns a user their own casts, newest first', async () => {
		prismaMock.easynewsCast.findMany.mockResolvedValue([
			{ url: 'Movie.mkv', size: BigInt(700), hash: 'h1', path: 'h1.mkv/Movie.mkv' },
		]);

		const streams = await service.getUserCastStreams('tt123', 'user-1');

		expect(streams).toEqual([
			{
				url: 'Movie.mkv',
				size: 700,
				filename: 'Movie.mkv',
				hash: 'h1',
				path: 'h1.mkv/Movie.mkv',
			},
		]);
		expect(prismaMock.easynewsCast.findMany.mock.calls[0][0].orderBy).toEqual({
			updatedAt: 'desc',
		});
	});

	// Deliberately unbounded by age, unlike the Real-Debrid pool: there is no
	// stored link here to rot, and play says so when Easynews lost the file.
	it('does not age-bound other users casts', async () => {
		await service.getOtherStreams('tt123', 'user-1', 5);
		expect(prismaMock.easynewsCast.groupBy.mock.calls[0][0].where).not.toHaveProperty(
			'updatedAt'
		);
	});

	it('excludes the viewer own rows from the other pool', async () => {
		await service.getOtherStreams('tt123', 'user-1', 5);
		expect(prismaMock.easynewsCast.groupBy.mock.calls[0][0].where.userId).toEqual({
			not: 'user-1',
		});
	});

	it('applies the caller size cap in MB', async () => {
		await service.getOtherStreams('tt123', 'user-1', 5, 2);
		expect(prismaMock.easynewsCast.groupBy.mock.calls[0][0].where.size).toEqual({
			gt: 10,
			lte: BigInt(2048),
		});
	});

	it('asks for nothing when the other-streams limit is zero', async () => {
		expect(await service.getOtherStreams('tt123', 'user-1', 0)).toEqual([]);
		expect(prismaMock.easynewsCast.groupBy).not.toHaveBeenCalled();
	});

	it('reports a delete that matched nothing so callers can answer 404', async () => {
		prismaMock.easynewsCast.deleteMany.mockResolvedValue({ count: 0 });
		expect(await service.deleteCastedLink('tt123', 'user-1', 'hash')).toBe(false);

		prismaMock.easynewsCast.deleteMany.mockResolvedValue({ count: 1 });
		expect(await service.deleteCastedLink('tt123', 'user-1', 'hash')).toBe(true);
	});

	it('splits casted movies from shows on the episode suffix', async () => {
		prismaMock.easynewsCast.findMany.mockResolvedValue([
			{ imdbId: 'tt1:1:1' },
			{ imdbId: 'tt1:1:2' },
			{ imdbId: 'tt2:2:1' },
		]);
		expect(await service.fetchCastedShows('user-1')).toEqual(['tt1', 'tt2']);
	});

	it('reports a settings update that found no profile', async () => {
		prismaMock.easynewsCastProfile.updateMany.mockResolvedValue({ count: 0 });
		expect(await service.updateCastSettings('user-1', 5)).toBe(false);
	});

	it('never touches the stored key on a settings-only update', async () => {
		prismaMock.easynewsCastProfile.updateMany.mockResolvedValue({ count: 1 });
		await service.updateCastSettings('user-1', 5);
		expect(prismaMock.easynewsCastProfile.updateMany.mock.calls[0][0].data).not.toHaveProperty(
			'apiKey'
		);
	});
});
