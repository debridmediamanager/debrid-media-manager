import { RD_LINK_MAX_AGE_MS } from '@/utils/rdLinkRot';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CastService } from './cast';

const prismaMock = vi.hoisted(() => ({
	castProfile: {
		upsert: vi.fn(),
		findUnique: vi.fn(),
	},
	cast: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		groupBy: vi.fn(),
		upsert: vi.fn(),
		delete: vi.fn(),
		deleteMany: vi.fn(),
	},
	available: {
		findMany: vi.fn(),
	},
	availableFile: {
		findMany: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

describe('CastService', () => {
	let service: CastService;

	beforeEach(() => {
		service = new CastService();
		Object.values(prismaMock.castProfile).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.cast).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.available).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.availableFile).forEach((fn) => (fn as Mock).mockReset());
		prismaMock.availableFile.findMany.mockResolvedValue([]);
		prismaMock.cast.groupBy.mockResolvedValue([]);
	});

	// The other-cast query dedupes by size via groupBy + one lookup per size
	// (Prisma's `distinct` would drop the SQL LIMIT and read every row).
	const mockOtherCasts = (rows: { url: string; link: string | null; size: bigint }[]) => {
		prismaMock.cast.groupBy.mockResolvedValueOnce(rows.map((r) => ({ size: r.size })));
		rows.forEach((r) => prismaMock.cast.findFirst.mockResolvedValueOnce(r));
	};

	it('upserts cast profiles', async () => {
		await service.saveCastProfile('user', 'client', 'secret', 'refresh');
		expect(prismaMock.castProfile.upsert).toHaveBeenCalledWith({
			where: { userId: 'user' },
			update: expect.objectContaining({ clientId: 'client', clientSecret: 'secret' }),
			create: expect.objectContaining({ refreshToken: 'refresh' }),
		});
	});

	it('upserts cast profiles with size limits', async () => {
		await service.saveCastProfile('user', 'client', 'secret', 'refresh', 15, 3);
		expect(prismaMock.castProfile.upsert).toHaveBeenCalledWith({
			where: { userId: 'user' },
			update: expect.objectContaining({
				clientId: 'client',
				clientSecret: 'secret',
				movieMaxSize: 15,
				episodeMaxSize: 3,
			}),
			create: expect.objectContaining({
				refreshToken: 'refresh',
				movieMaxSize: 15,
				episodeMaxSize: 3,
			}),
		});
	});

	it('returns the latest cast entry when both url and link exist', async () => {
		prismaMock.cast.findFirst.mockResolvedValueOnce({
			url: 'url',
			link: 'link',
		});
		const latest = await service.getLatestCast('tt', 'user');
		expect(latest).toEqual({ url: 'url', link: 'link' });

		prismaMock.cast.findFirst.mockResolvedValueOnce({ url: null, link: null });
		expect(await service.getLatestCast('tt', 'user')).toBeNull();
	});

	it('returns filtered cast URLs for the owner', async () => {
		prismaMock.cast.findMany.mockResolvedValueOnce([
			{ url: 'url', link: 'link', size: BigInt(100) },
			{ url: 'url2', link: null, size: BigInt(0) },
		]);
		const own = await service.getCastURLs('tt', 'user');
		expect(own).toEqual([{ url: 'url', link: 'link', size: 100 }]);
	});

	it('reads cast profiles for a user', async () => {
		prismaMock.castProfile.findUnique.mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});

		const profile = await service.getCastProfile('user');
		expect(profile).toEqual({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});
	});

	it('saves cast entries and converts file sizes to bigint', async () => {
		await service.saveCast('tt', 'user', 'hash', 'url', 'link', 123);
		expect(prismaMock.cast.upsert).toHaveBeenCalledWith({
			where: {
				imdbId_userId_hash: { imdbId: 'tt', userId: 'user', hash: 'hash' },
			},
			update: expect.objectContaining({ size: BigInt(123) }),
			create: expect.objectContaining({ size: BigInt(123) }),
		});
	});

	it('lists movies and shows that were cast by the user', async () => {
		prismaMock.cast.findMany.mockResolvedValueOnce([
			{ imdbId: 'tt1', updatedAt: new Date() },
			{ imdbId: 'tt2', updatedAt: new Date() },
		]);
		expect(await service.fetchCastedMovies('user')).toEqual(['tt1', 'tt2']);

		prismaMock.cast.findMany.mockResolvedValueOnce([
			{ imdbId: 'tt1:1', updatedAt: new Date() },
			{ imdbId: 'tt1:2', updatedAt: new Date() },
		]);
		expect(await service.fetchCastedShows('user')).toEqual(['tt1']);
	});

	it('returns every stored cast link for a user', async () => {
		const now = new Date();
		prismaMock.cast.findMany.mockResolvedValueOnce([
			{ imdbId: 'tt', url: 'url', hash: 'hash', size: BigInt(10), updatedAt: now },
		]);
		expect(await service.fetchAllCastedLinks('user')).toEqual([
			{ imdbId: 'tt', url: 'url', hash: 'hash', size: 10, updatedAt: now },
		]);
	});

	it('deletes casted links, reports misses, and wraps errors', async () => {
		prismaMock.cast.deleteMany.mockResolvedValueOnce({ count: 1 });
		await expect(service.deleteCastedLink('tt', 'user', 'hash')).resolves.toBe(true);
		expect(prismaMock.cast.deleteMany).toHaveBeenCalledWith({
			where: { imdbId: 'tt', userId: 'user', hash: 'hash' },
		});

		prismaMock.cast.deleteMany.mockResolvedValueOnce({ count: 0 });
		await expect(service.deleteCastedLink('tt', 'user', 'hash')).resolves.toBe(false);

		prismaMock.cast.deleteMany.mockRejectedValue(new Error('db down'));
		await expect(service.deleteCastedLink('tt', 'user', 'hash')).rejects.toThrow(
			'Failed to delete casted link: db down'
		);
	});

	it('returns all cast entries for a user', async () => {
		prismaMock.cast.findMany.mockResolvedValueOnce([
			{ imdbId: 'tt', hash: 'hash', url: 'url', link: 'link', size: BigInt(5) },
		]);
		expect(await service.getAllUserCasts('user')).toEqual([
			{ imdbId: 'tt', hash: 'hash', url: 'url', link: 'link', size: 5 },
		]);
	});

	it('returns user cast streams only', async () => {
		const now = new Date();

		prismaMock.cast.findMany.mockResolvedValueOnce([
			{
				url: 'https://files.dmm.test/cast1.mkv',
				link: 'https://app.real-debrid.com/d/cast1link',
				size: BigInt(2048),
			},
			{
				url: 'https://files.dmm.test/cast2.mkv',
				link: 'https://app.real-debrid.com/d/cast2link',
				size: BigInt(1024),
			},
		]);

		const userStreams = await service.getUserCastStreams('tt123', 'user1', 5);

		expect(userStreams).toHaveLength(2);
		expect(userStreams[0]).toEqual({
			url: 'https://files.dmm.test/cast1.mkv',
			link: 'https://app.real-debrid.com/d/cast1link',
			size: 2048,
			filename: 'cast1.mkv',
		});
	});

	// Regression: nothing here was bounded by age, so the stream list happily
	// offered links minted in 2024. Measured 2026-08-24: 2.1M of the 2.2M stored
	// cast rows were older than the point where most links stop unrestricting,
	// and `orderBy: bytes desc` actively prefers the biggest file, which is
	// often the stalest un-refreshed remux.
	it('will not offer a link older than the rot window', async () => {
		prismaMock.availableFile.findMany.mockResolvedValue([]);
		prismaMock.available.findMany.mockResolvedValue([]);
		mockOtherCasts([]);

		const before = Date.now();
		await service.getOtherStreams('tt123', 'user-1', 5);
		const after = Date.now();

		// The cutoff is `Date.now() - RD_LINK_MAX_AGE_MS` computed somewhere inside
		// the call, so it lands in [before, after] shifted back by the window.
		const withinWindow = (cutoff: Date) => {
			expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - RD_LINK_MAX_AGE_MS);
			expect(cutoff.getTime()).toBeLessThanOrEqual(after - RD_LINK_MAX_AGE_MS);
		};

		withinWindow(
			prismaMock.availableFile.findMany.mock.calls[0][0].where.available.updatedAt.gt
		);
		withinWindow(prismaMock.available.findMany.mock.calls[0][0].where.updatedAt.gt);
		withinWindow(prismaMock.cast.groupBy.mock.calls[0][0].where.updatedAt.gt);
	});

	it('bounds the owner cast stream query by the same window', async () => {
		prismaMock.cast.findMany.mockResolvedValue([]);

		const before = Date.now();
		await service.getUserCastStreams('tt123', 'user-1', 5);

		const cutoff: Date = prismaMock.cast.findMany.mock.calls[0][0].where.updatedAt.gt;
		expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - RD_LINK_MAX_AGE_MS);
		expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - RD_LINK_MAX_AGE_MS);
	});

	it('drops every cast row pointing at a link RD says is gone', async () => {
		prismaMock.cast.deleteMany.mockResolvedValue({ count: 3 });

		const removed = await service.deleteCastsByLinkPrefix(
			'https://real-debrid.com/d/abcdef1234567'
		);

		expect(removed).toBe(3);
		// Prefix, because rows hold the 16-char form while a play request only
		// ever carries the 13-char truncation - and the link is dead for every
		// user who cast it, not just the one who noticed.
		expect(prismaMock.cast.deleteMany).toHaveBeenCalledWith({
			where: { link: { startsWith: 'https://real-debrid.com/d/abcdef1234567' } },
		});
	});

	it('prioritizes Available and only queries casts when Available < limit', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([]);

		prismaMock.available.findMany.mockResolvedValueOnce([
			{
				filename: 'Available Torrent',
				files: [
					{
						link: 'https://app.real-debrid.com/d/availlink',
						path: '/path/to/available.mkv',
						bytes: BigInt(3145728000),
					},
				],
			},
		]);

		mockOtherCasts([
			{
				url: 'https://files.dmm.test/othercast.mkv',
				link: 'https://app.real-debrid.com/d/otherlink',
				size: BigInt(2048),
			},
		]);

		const otherStreams = await service.getOtherStreams('tt123', 'user1', 5);

		expect(otherStreams).toHaveLength(2);
		expect(otherStreams[0]).toEqual({
			url: 'https://app.real-debrid.com/d/availlink',
			link: 'https://app.real-debrid.com/d/availlink',
			size: 3000,
			filename: 'available.mkv',
		});
		expect(otherStreams[1]).toEqual({
			url: 'https://files.dmm.test/othercast.mkv',
			link: 'https://app.real-debrid.com/d/otherlink',
			size: 2048,
			filename: 'othercast.mkv',
		});
	});

	it('only returns Available streams when Available >= limit', async () => {
		const availableFileItems = Array.from({ length: 5 }, (_, i) => ({
			link: `https://app.real-debrid.com/d/availlink${i}`,
			path: `/movies/available${i}.mkv`,
			bytes: BigInt(3145728000),
		}));

		prismaMock.availableFile.findMany.mockResolvedValueOnce(availableFileItems);

		const otherStreams = await service.getOtherStreams('tt123', 'user1', 5);

		expect(otherStreams).toHaveLength(5);
		expect(prismaMock.available.findMany).not.toHaveBeenCalled();
		expect(prismaMock.cast.groupBy).not.toHaveBeenCalled();
	});

	it('handles TV show imdbId format in getOtherStreams', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([
			{
				link: 'https://app.real-debrid.com/d/packlink',
				path: '/Show/S01E01.mkv',
				bytes: BigInt(1073741824),
			},
		]);

		prismaMock.available.findMany.mockResolvedValueOnce([]);

		const otherStreams = await service.getOtherStreams('tt123:1:1', 'user1', 5);

		expect(prismaMock.availableFile.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					available: expect.objectContaining({
						imdbId: 'tt123',
					}),
				}),
			})
		);
	});

	it('filters available streams that mismatch requested episode', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([
			{
				link: 'https://app.real-debrid.com/d/right',
				path: '/Show/S01E01.mkv',
				bytes: BigInt(1073741824),
			},
		]);

		prismaMock.available.findMany.mockResolvedValueOnce([]);

		const otherStreams = await service.getOtherStreams('tt123:1:1', 'user1', 5);

		expect(otherStreams).toHaveLength(1);
		expect(otherStreams[0].link).toBe('https://app.real-debrid.com/d/right');
	});

	it('keeps season packs for matching season requests', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([
			{
				link: 'https://app.real-debrid.com/d/seasonpack',
				path: '/Show/Season.1.Complete.mkv',
				bytes: BigInt(1073741824),
			},
		]);

		prismaMock.available.findMany.mockResolvedValueOnce([]);

		const otherStreams = await service.getOtherStreams('tt123:1:5', 'user1', 5);

		expect(otherStreams).toHaveLength(1);
		expect(otherStreams[0].link).toBe('https://app.real-debrid.com/d/seasonpack');
	});

	it('filters out season packs from wrong seasons', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([]);
		prismaMock.available.findMany.mockResolvedValueOnce([]);

		const otherStreams = await service.getOtherStreams('tt123:1:5', 'user1', 5);

		expect(otherStreams).toHaveLength(0);
	});

	it('database filters episodes efficiently', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([
			{
				link: 'https://app.real-debrid.com/d/s01e05',
				path: '/Show/S01E05.mkv',
				bytes: BigInt(1073741824),
			},
		]);

		prismaMock.available.findMany.mockResolvedValueOnce([]);

		const otherStreams = await service.getOtherStreams('tt123:1:5', 'user1', 5);

		expect(otherStreams).toHaveLength(1);
		expect(otherStreams[0].link).toBe('https://app.real-debrid.com/d/s01e05');
	});

	it('cast items use full imdbId for filtering', async () => {
		prismaMock.available.findMany.mockResolvedValueOnce([]);

		mockOtherCasts([
			{
				url: 'https://files.dmm.test/Show.S01E01.mkv',
				link: 'https://app.real-debrid.com/d/right',
				size: BigInt(1024),
			},
		]);

		const otherStreams = await service.getOtherStreams('tt123:1:1', 'user1', 5);

		expect(otherStreams).toHaveLength(1);
		expect(otherStreams[0].link).toBe('https://app.real-debrid.com/d/right');
	});

	it('handles various episode format patterns', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([
			{
				link: 'https://app.real-debrid.com/d/1x05',
				path: '/Show/1x05.mkv',
				bytes: BigInt(1073741824),
			},
		]);

		prismaMock.available.findMany.mockResolvedValueOnce([]);

		mockOtherCasts([
			{
				url: 'https://files.dmm.test/Show.Season.1.Episode.5.mkv',
				link: 'https://app.real-debrid.com/d/season1ep5',
				size: BigInt(1024),
			},
		]);

		const otherStreams = await service.getOtherStreams('tt123:1:5', 'user1', 5);

		expect(otherStreams).toHaveLength(2);
		expect(otherStreams.map((s) => s.link)).toContain('https://app.real-debrid.com/d/1x05');
		expect(otherStreams.map((s) => s.link)).toContain(
			'https://app.real-debrid.com/d/season1ep5'
		);
	});

	it('handles single-digit vs double-digit season/episode numbers', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([
			{
				link: 'https://app.real-debrid.com/d/s1e5',
				path: '/Show/S1E5.mkv',
				bytes: BigInt(1073741824),
			},
			{
				link: 'https://app.real-debrid.com/d/s01e05',
				path: '/Show/S01E05.mkv',
				bytes: BigInt(1073741824),
			},
		]);

		prismaMock.available.findMany.mockResolvedValueOnce([]);

		const otherStreams = await service.getOtherStreams('tt123:1:5', 'user1', 5);

		expect(otherStreams).toHaveLength(2);
	});

	it('filters out items without links in getUserCastStreams', async () => {
		prismaMock.cast.findMany.mockResolvedValueOnce([
			{
				url: 'https://files.dmm.test/withlink.mkv',
				link: 'https://app.real-debrid.com/d/validlink',
				size: BigInt(1024),
			},
			{
				url: 'https://files.dmm.test/nolink.mkv',
				link: null,
				size: BigInt(2048),
			},
		]);

		const userStreams = await service.getUserCastStreams('tt123', 'user1', 5);

		expect(userStreams).toHaveLength(1);
		expect(userStreams[0].filename).toBe('withlink.mkv');
	});

	it('filters out available items without files in getOtherStreams', async () => {
		prismaMock.available.findMany.mockResolvedValueOnce([
			{
				filename: 'No Files',
				files: [],
			},
		]);

		const otherStreams = await service.getOtherStreams('tt123', 'user1', 5);

		expect(otherStreams).toHaveLength(0);
	});

	it('respects the limit parameter in getOtherStreams', async () => {
		const castItems = Array.from({ length: 10 }, (_, i) => ({
			url: `https://files.dmm.test/cast${i}.mkv`,
			link: `https://app.real-debrid.com/d/link${i}`,
			size: BigInt(1024),
		}));

		prismaMock.availableFile.findMany.mockResolvedValueOnce([]);
		prismaMock.available.findMany.mockResolvedValueOnce([]);
		prismaMock.cast.findMany.mockResolvedValueOnce(castItems);

		const otherStreams = await service.getOtherStreams('tt123', 'user1', 3);

		expect(otherStreams.length).toBeLessThanOrEqual(3);
	});

	it('sorts streams by size descending', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([
			{
				link: 'https://app.real-debrid.com/d/smalllink',
				path: '/small.mkv',
				bytes: BigInt(1073741824), // 1 GB
			},
		]);

		prismaMock.available.findMany.mockResolvedValueOnce([]);

		mockOtherCasts([
			{
				url: 'https://files.dmm.test/large.mkv',
				link: 'https://app.real-debrid.com/d/largelink',
				size: BigInt(3000), // 3 GB in MB
			},
		]);

		const otherStreams = await service.getOtherStreams('tt123', 'user1', 5);

		expect(otherStreams).toHaveLength(2);
		expect(otherStreams[0].size).toBe(3000);
		expect(otherStreams[0].filename).toBe('large.mkv');
		expect(otherStreams[1].size).toBeCloseTo(1024, 0);
		expect(otherStreams[1].filename).toBe('small.mkv');
	});

	it('filters streams by maxSize in getOtherStreams', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([
			{
				link: 'https://app.real-debrid.com/d/smalllink',
				path: '/small.mkv',
				bytes: BigInt(1073741824), // 1 GB
			},
		]);

		prismaMock.available.findMany.mockResolvedValueOnce([]);

		const maxSizeGb = 3;
		const expectedMb = Math.round(maxSizeGb * 1024);
		const expectedBytes = BigInt(expectedMb) * BigInt(1024 * 1024);

		const otherStreams = await service.getOtherStreams('tt123', 'user1', 5, maxSizeGb);

		expect(prismaMock.availableFile.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					bytes: { lte: expectedBytes },
				}),
			})
		);
		expect(otherStreams).toHaveLength(1);
	});

	it('skips size filter when maxSize is 0 or undefined', async () => {
		prismaMock.availableFile.findMany.mockResolvedValueOnce([
			{
				link: 'https://app.real-debrid.com/d/largelink',
				path: '/large.mkv',
				bytes: BigInt(10737418240), // 10 GB
			},
		]);

		prismaMock.available.findMany.mockResolvedValueOnce([]);

		const otherStreams = await service.getOtherStreams('tt123', 'user1', 5, 0);

		expect(prismaMock.availableFile.findMany).toHaveBeenCalledWith(
			expect.not.objectContaining({
				where: expect.objectContaining({
					bytes: expect.anything(),
				}),
			})
		);
		expect(otherStreams).toHaveLength(1);
	});
});
