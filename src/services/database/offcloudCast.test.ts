import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { OffcloudCastService } from './offcloudCast';

const prismaMock = vi.hoisted(() => ({
	offcloudCastProfile: {
		upsert: vi.fn(),
		findUnique: vi.fn(),
		updateMany: vi.fn(),
	},
	offcloudCast: {
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

describe('OffcloudCastService', () => {
	let service: OffcloudCastService;

	beforeEach(() => {
		service = new OffcloudCastService();
		Object.values(prismaMock.offcloudCastProfile).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.offcloudCast).forEach((fn) => (fn as Mock).mockReset());
		prismaMock.offcloudCast.groupBy.mockResolvedValue([]);
	});

	// An Offcloud CDN URL carries an account-scoped token in its path, so a
	// stored link would be the caster's credential handed to every viewer - and
	// `POST /api/cloud` re-mints from the hash for free anyway.
	it('stores a hash and a path, never a link', async () => {
		await service.saveCast('tt123', 'user-1', 'hash', 'Movie.mkv', 700, 'Release/Movie.mkv');

		const call = prismaMock.offcloudCast.upsert.mock.calls[0][0];
		expect(call.create).toMatchObject({ hash: 'hash', path: 'Release/Movie.mkv' });
		expect(Object.keys(call.create)).not.toContain('link');
		expect(Object.keys(call.update)).not.toContain('link');
	});

	it('keeps a cast keyed on (imdbId, userId, hash)', async () => {
		await service.saveCast('tt123', 'user-1', 'hash', 'Movie.mkv', 700);
		expect(prismaMock.offcloudCast.upsert.mock.calls[0][0].where).toEqual({
			imdbId_userId_hash: { imdbId: 'tt123', userId: 'user-1', hash: 'hash' },
		});
	});

	it('returns a user their own casts, newest first', async () => {
		prismaMock.offcloudCast.findMany.mockResolvedValue([
			{ url: 'Show/Movie.mkv', size: BigInt(700), hash: 'h1', path: 'Show/Movie.mkv' },
		]);

		const streams = await service.getUserCastStreams('tt123', 'user-1');

		expect(streams).toEqual([
			{
				url: 'Show/Movie.mkv',
				size: 700,
				filename: 'Movie.mkv',
				hash: 'h1',
				path: 'Show/Movie.mkv',
			},
		]);
		expect(prismaMock.offcloudCast.findMany.mock.calls[0][0].orderBy).toEqual({
			updatedAt: 'desc',
		});
	});

	// Deliberately unbounded by age: there is no stored link here to rot, and
	// the stream route settles playability with a live `/api/cache` probe.
	it('does not age-bound other users casts', async () => {
		await service.getOtherStreams('tt123', 'user-1', 5);
		expect(prismaMock.offcloudCast.groupBy.mock.calls[0][0].where).not.toHaveProperty(
			'updatedAt'
		);
	});

	it('excludes the viewer own rows from the other pool', async () => {
		await service.getOtherStreams('tt123', 'user-1', 5);
		expect(prismaMock.offcloudCast.groupBy.mock.calls[0][0].where.userId).toEqual({
			not: 'user-1',
		});
	});

	it('applies the caller size cap in MB', async () => {
		await service.getOtherStreams('tt123', 'user-1', 5, 2);
		expect(prismaMock.offcloudCast.groupBy.mock.calls[0][0].where.size).toEqual({
			gt: 10,
			lte: BigInt(2048),
		});
	});

	it('asks for nothing when the other-streams limit is zero', async () => {
		expect(await service.getOtherStreams('tt123', 'user-1', 0)).toEqual([]);
		expect(prismaMock.offcloudCast.groupBy).not.toHaveBeenCalled();
	});

	it('reports a delete that matched nothing so callers can answer 404', async () => {
		prismaMock.offcloudCast.deleteMany.mockResolvedValue({ count: 0 });
		expect(await service.deleteCastedLink('tt123', 'user-1', 'hash')).toBe(false);

		prismaMock.offcloudCast.deleteMany.mockResolvedValue({ count: 1 });
		expect(await service.deleteCastedLink('tt123', 'user-1', 'hash')).toBe(true);
	});

	it('splits casted movies from shows on the episode suffix', async () => {
		prismaMock.offcloudCast.findMany.mockResolvedValue([
			{ imdbId: 'tt1:1:1' },
			{ imdbId: 'tt1:1:2' },
			{ imdbId: 'tt2:2:1' },
		]);
		expect(await service.fetchCastedShows('user-1')).toEqual(['tt1', 'tt2']);
	});

	it('reports a settings update that found no profile', async () => {
		prismaMock.offcloudCastProfile.updateMany.mockResolvedValue({ count: 0 });
		expect(await service.updateCastSettings('user-1', 5)).toBe(false);
	});

	it('never touches the stored key on a settings-only update', async () => {
		prismaMock.offcloudCastProfile.updateMany.mockResolvedValue({ count: 1 });
		await service.updateCastSettings('user-1', 5);
		expect(prismaMock.offcloudCastProfile.updateMany.mock.calls[0][0].data).not.toHaveProperty(
			'apiKey'
		);
	});

	// The profile row carries the account's whole API key - Offcloud has no
	// scoping and no per-app keys - so the select list is the leak boundary.
	it('reads a profile through a select list rather than returning the row', async () => {
		prismaMock.offcloudCastProfile.findUnique.mockResolvedValue({ apiKey: 'k' });
		await service.getCastProfile('user-1');
		expect(prismaMock.offcloudCastProfile.findUnique.mock.calls[0][0].select).toEqual({
			apiKey: true,
			movieMaxSize: true,
			episodeMaxSize: true,
			otherStreamsLimit: true,
			hideCastOption: true,
		});
	});
});
