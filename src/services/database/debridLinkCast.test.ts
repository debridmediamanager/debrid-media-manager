import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DebridLinkCastService } from './debridLinkCast';

const prismaMock = vi.hoisted(() => ({
	debridLinkCastProfile: {
		upsert: vi.fn(),
		findUnique: vi.fn(),
		updateMany: vi.fn(),
	},
	debridLinkCast: {
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

describe('DebridLinkCastService', () => {
	let service: DebridLinkCastService;

	beforeEach(() => {
		service = new DebridLinkCastService();
		Object.values(prismaMock.debridLinkCastProfile).forEach((fn) => (fn as Mock).mockReset());
		Object.values(prismaMock.debridLinkCast).forEach((fn) => (fn as Mock).mockReset());
		prismaMock.debridLinkCast.groupBy.mockResolvedValue([]);
		prismaMock.debridLinkCast.findFirst.mockResolvedValue(null);
	});

	it('stores a hash, a path and the keyless URL', async () => {
		await service.saveCast(
			'tt123',
			'user-1',
			'hash',
			'Movie.mkv',
			700,
			'Release/Movie.mkv',
			'https://seed41.debrid.link/dl/abc-1/Movie.mkv'
		);

		const call = prismaMock.debridLinkCast.upsert.mock.calls[0][0];
		expect(call.create).toMatchObject({
			hash: 'hash',
			path: 'Release/Movie.mkv',
			url: 'Movie.mkv',
			downloadUrl: 'https://seed41.debrid.link/dl/abc-1/Movie.mkv',
		});
	});

	// A re-cast that could not reach Debrid-Link must not throw away a working
	// fallback URL an earlier one stored.
	it('leaves a stored URL alone when the resolve produced none', async () => {
		await service.saveCast('tt123', 'user-1', 'hash', 'Movie.mkv', 700, 'Movie.mkv');
		const call = prismaMock.debridLinkCast.upsert.mock.calls[0][0];
		expect(call.update).not.toHaveProperty('downloadUrl');
		expect(call.create.downloadUrl).toBeNull();
	});

	it('keeps a cast keyed on (imdbId, userId, hash)', async () => {
		await service.saveCast('tt123', 'user-1', 'hash', 'Movie.mkv', 700);
		expect(prismaMock.debridLinkCast.upsert.mock.calls[0][0].where).toEqual({
			imdbId_userId_hash: { imdbId: 'tt123', userId: 'user-1', hash: 'hash' },
		});
	});

	it('returns a user their own casts, newest first', async () => {
		prismaMock.debridLinkCast.findMany.mockResolvedValue([
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
		expect(prismaMock.debridLinkCast.findMany.mock.calls[0][0].orderBy).toEqual({
			updatedAt: 'desc',
		});
	});

	// The URL is a permanent unauthenticated capability, so it must not travel to
	// a browser with the manage page's listing.
	it('never returns the stored URL in the casted-links listing', async () => {
		prismaMock.debridLinkCast.findMany.mockResolvedValue([]);
		await service.fetchAllCastedLinks('user-1');
		expect(prismaMock.debridLinkCast.findMany.mock.calls[0][0].select).not.toHaveProperty(
			'downloadUrl'
		);
	});

	it('never returns the stored URL with a cast stream', async () => {
		prismaMock.debridLinkCast.findMany.mockResolvedValue([]);
		await service.getUserCastStreams('tt123', 'user-1');
		expect(prismaMock.debridLinkCast.findMany.mock.calls[0][0].select).not.toHaveProperty(
			'downloadUrl'
		);
	});

	it('does not age-bound other users casts', async () => {
		await service.getOtherStreams('tt123', 'user-1', 5);
		expect(prismaMock.debridLinkCast.groupBy.mock.calls[0][0].where).not.toHaveProperty(
			'updatedAt'
		);
	});

	it('excludes the viewer own rows from the other pool', async () => {
		await service.getOtherStreams('tt123', 'user-1', 5);
		expect(prismaMock.debridLinkCast.groupBy.mock.calls[0][0].where.userId).toEqual({
			not: 'user-1',
		});
	});

	it('applies the caller size cap in MB', async () => {
		await service.getOtherStreams('tt123', 'user-1', 5, 2);
		expect(prismaMock.debridLinkCast.groupBy.mock.calls[0][0].where.size).toEqual({
			gt: 10,
			lte: BigInt(2048),
		});
	});

	it('asks for nothing when the other-streams limit is zero', async () => {
		expect(await service.getOtherStreams('tt123', 'user-1', 0)).toEqual([]);
		expect(prismaMock.debridLinkCast.groupBy).not.toHaveBeenCalled();
	});

	it('reports a delete that matched nothing so callers can answer 404', async () => {
		prismaMock.debridLinkCast.deleteMany.mockResolvedValue({ count: 0 });
		expect(await service.deleteCastedLink('tt123', 'user-1', 'hash')).toBe(false);

		prismaMock.debridLinkCast.deleteMany.mockResolvedValue({ count: 1 });
		expect(await service.deleteCastedLink('tt123', 'user-1', 'hash')).toBe(true);
	});

	it('splits casted movies from shows on the episode suffix', async () => {
		prismaMock.debridLinkCast.findMany.mockResolvedValue([
			{ imdbId: 'tt1:1:1' },
			{ imdbId: 'tt1:1:2' },
			{ imdbId: 'tt2:2:1' },
		]);
		expect(await service.fetchCastedShows('user-1')).toEqual(['tt1', 'tt2']);
	});

	it('reports a settings update that found no profile', async () => {
		prismaMock.debridLinkCastProfile.updateMany.mockResolvedValue({ count: 0 });
		expect(await service.updateCastSettings('user-1', 5)).toBe(false);
	});

	it('never touches the stored credential on a settings-only update', async () => {
		prismaMock.debridLinkCastProfile.updateMany.mockResolvedValue({ count: 1 });
		await service.updateCastSettings('user-1', 5);
		const data = prismaMock.debridLinkCastProfile.updateMany.mock.calls[0][0].data;
		expect(data).not.toHaveProperty('apiKey');
		expect(data).not.toHaveProperty('refreshToken');
	});

	// A browser holding only a pasted API token has no refresh token to send, and
	// that must not wipe one an earlier device-flow enrolment saved.
	it('leaves a stored refresh token alone when none is supplied', async () => {
		await service.saveCastProfile('user-1', 'token');
		expect(prismaMock.debridLinkCastProfile.upsert.mock.calls[0][0].update).not.toHaveProperty(
			'refreshToken'
		);
	});

	it('stores a refresh token when the browser has one', async () => {
		await service.saveCastProfile('user-1', 'token', 5, 1, 5, false, 'refresh-1');
		const call = prismaMock.debridLinkCastProfile.upsert.mock.calls[0][0];
		expect(call.update.refreshToken).toBe('refresh-1');
		expect(call.create.refreshToken).toBe('refresh-1');
	});

	it('reads a profile through a select list rather than returning the row', async () => {
		prismaMock.debridLinkCastProfile.findUnique.mockResolvedValue({ apiKey: 'k' });
		await service.getCastProfile('user-1');
		expect(prismaMock.debridLinkCastProfile.findUnique.mock.calls[0][0].select).toEqual({
			apiKey: true,
			refreshToken: true,
			movieMaxSize: true,
			episodeMaxSize: true,
			otherStreamsLimit: true,
			hideCastOption: true,
		});
	});

	describe('getStoredDownloadUrl', () => {
		it('prefers the row whose path matches', async () => {
			prismaMock.debridLinkCast.findFirst.mockResolvedValue({ downloadUrl: 'https://a/1' });

			expect(await service.getStoredDownloadUrl('hash', 'Show/S01E02.mkv')).toBe(
				'https://a/1'
			);
			expect(prismaMock.debridLinkCast.findFirst.mock.calls[0][0].where).toMatchObject({
				hash: 'hash',
				path: 'Show/S01E02.mkv',
			});
		});

		// Handing back some other file of a season pack would play the wrong
		// episode, which is worse than reporting the stream as unavailable.
		it('returns nothing when a path was asked for and no row carries it', async () => {
			prismaMock.debridLinkCast.findFirst.mockResolvedValue(null);
			expect(await service.getStoredDownloadUrl('hash', 'Show/S01E02.mkv')).toBeNull();
			expect(prismaMock.debridLinkCast.findFirst).toHaveBeenCalledTimes(1);
		});

		it('falls back to any row for the hash when no path was asked for', async () => {
			prismaMock.debridLinkCast.findFirst.mockResolvedValue({ downloadUrl: 'https://a/2' });
			expect(await service.getStoredDownloadUrl('hash')).toBe('https://a/2');
			expect(prismaMock.debridLinkCast.findFirst.mock.calls[0][0].where).not.toHaveProperty(
				'path'
			);
		});

		// A row written before the column existed has no URL, and a null must not
		// be handed to `res.redirect`.
		it('never returns a row with no stored URL', async () => {
			prismaMock.debridLinkCast.findFirst.mockResolvedValue({ downloadUrl: null });
			expect(await service.getStoredDownloadUrl('hash')).toBeNull();
			expect(prismaMock.debridLinkCast.findFirst.mock.calls[0][0].where.downloadUrl).toEqual({
				not: null,
			});
		});
	});
});
