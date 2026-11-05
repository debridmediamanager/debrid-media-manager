import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability';

const findFirstMock = vi.fn();
const upsertMock = vi.fn();
const findManyMock = vi.fn();
const deleteMock = vi.fn();
const findUniqueMock = vi.fn();
const findFirstFileMock = vi.fn();
const deleteManyFileMock = vi.fn();
const createManyMock = vi.fn();
const createManyFileMock = vi.fn();
const cacheFindUniqueMock = vi.fn();
const cacheUpsertMock = vi.fn();
const findManyAdMock = vi.fn();
const createManyAdMock = vi.fn();
const createManyAdFileMock = vi.fn();
const deleteManyRowMock = vi.fn();
const countFileMock = vi.fn();
const cacheFindManyMock = vi.fn();
const transactionMock = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn().mockImplementation(function () {
		return {
			available: {
				findFirst: findFirstMock,
				upsert: upsertMock,
				findMany: findManyMock,
				delete: deleteMock,
				deleteMany: deleteManyRowMock,
				createMany: createManyMock,
			},
			availableAd: {
				findMany: findManyAdMock,
				createMany: createManyAdMock,
			},
			availableAdFile: {
				createMany: createManyAdFileMock,
			},
			availableFile: {
				findUnique: findUniqueMock,
				findFirst: findFirstFileMock,
				findMany: findManyMock,
				deleteMany: deleteManyFileMock,
				count: countFileMock,
				createMany: createManyFileMock,
			},
			cache: {
				findUnique: cacheFindUniqueMock,
				findMany: cacheFindManyMock,
				upsert: cacheUpsertMock,
			},
			$transaction: transactionMock,
			$disconnect: vi.fn(),
		};
	}),
}));

describe('AvailabilityService', () => {
	let service: AvailabilityService;

	beforeEach(() => {
		findFirstMock.mockReset();
		upsertMock.mockReset();
		findManyMock.mockReset();
		deleteMock.mockReset();
		findUniqueMock.mockReset();
		findFirstFileMock.mockReset();
		deleteManyFileMock.mockReset();
		createManyMock.mockReset();
		createManyFileMock.mockReset();
		cacheFindUniqueMock.mockReset();
		cacheUpsertMock.mockReset();
		findManyAdMock.mockReset();
		createManyAdMock.mockReset();
		createManyAdFileMock.mockReset();
		deleteManyRowMock.mockReset();
		countFileMock.mockReset();
		cacheFindManyMock.mockReset();
		cacheFindManyMock.mockResolvedValue([]);
		transactionMock.mockClear();
		service = new AvailabilityService();
	});

	it('retrieves imdb id by hash', async () => {
		findFirstMock.mockResolvedValue({ imdbId: 'tt1234567' });
		const imdbId = await service.getIMDBIdByHash('hash');
		expect(imdbId).toBe('tt1234567');
	});

	it('upserts availability entries with links', async () => {
		await service.upsertAvailability({
			hash: 'hash',
			imdbId: 'tt1',
			filename: 'file.mkv',
			originalFilename: 'orig.mkv',
			bytes: 100,
			originalBytes: 200,
			host: 'real-debrid.com',
			progress: 100,
			status: 'downloaded',
			ended: '2024-01-01T00:00:00Z',
			selectedFiles: [{ id: 1, path: 'path', bytes: 50, selected: 1 }],
			links: ['https://rd/link'],
		});
		expect(upsertMock).toHaveBeenCalled();
	});

	// Both columns are varchar(191): a longer name failed the whole insert with
	// "The provided value for the column is too long for the column's type".
	it('cuts both names to their columns and still reads the episode past the cut', async () => {
		const name = `${'Show.Name.'.repeat(20)}S01E02.1080p.WEB.mkv`;
		const row = {
			hash: 'hash',
			imdbId: 'tt1',
			filename: name,
			originalFilename: `${name}.original`,
			bytes: 100,
			originalBytes: 200,
			host: 'real-debrid.com',
			progress: 100,
			status: 'downloaded',
			ended: '2024-01-01T00:00:00Z',
			selectedFiles: [{ id: 1, path: 'path', bytes: 50, selected: 1 }],
			links: ['https://rd/link'],
		};

		await service.upsertAvailability(row);

		const args = upsertMock.mock.calls[0][0];
		expect(args.create.filename).toBe(name.slice(0, 191));
		expect(args.create.originalFilename).toBe(name.slice(0, 191));
		expect(args.update.originalFilename).toBe(name.slice(0, 191));
		expect(args.create).toMatchObject({ season: 1, episode: 2 });
	});

	it('writes through the transaction it is handed', async () => {
		const tx = { available: { upsert: vi.fn() } };

		await service.upsertAvailability(
			{
				hash: 'hash',
				imdbId: 'tt1',
				filename: 'file.mkv',
				originalFilename: 'orig.mkv',
				bytes: 100,
				originalBytes: 200,
				host: 'real-debrid.com',
				progress: 100,
				status: 'downloaded',
				ended: '2024-01-01T00:00:00Z',
				selectedFiles: [{ id: 1, path: 'path', bytes: 50, selected: 1 }],
				links: ['https://rd/link'],
			},
			tx as any
		);

		expect(tx.available.upsert).toHaveBeenCalledTimes(1);
		expect(upsertMock).not.toHaveBeenCalled();
	});

	it('checks availability by imdb id and hashes', async () => {
		findManyMock.mockResolvedValue([
			{
				hash: 'hash',
				files: [
					{
						file_id: 1,
						path: 'path',
						bytes: BigInt(100),
						link: 'https://real-debrid.com/d/A',
					},
				],
			},
		]);

		const results = await service.checkAvailability('tt1', ['hash']);
		expect(results).toEqual([
			{ hash: 'hash', files: [{ file_id: 1, path: 'path', bytes: 100 }] },
		]);
	});

	it('checks availability by hashes', async () => {
		findManyMock.mockResolvedValue([
			{
				hash: 'hash',
				filename: 'Sinners.2025.2160p.WEB-DL.mkv',
				originalFilename: 'Sinners 2025 2160p iT WEB-DL DDP5 1 Atmos DV HDR H 265-BYNDR',
				files: [
					{
						file_id: 1,
						path: 'path',
						bytes: BigInt(200),
						link: 'https://real-debrid.com/d/B',
					},
				],
			},
		]);

		const results = await service.checkAvailabilityByHashes(['hash']);
		expect(results[0].files[0].bytes).toBe(200);
		// RD's names ride along, so an add that has only the hash can tell RD
		// refusing the release by name from the account's pause.
		expect(results[0]).toMatchObject({
			filename: 'Sinners.2025.2160p.WEB-DL.mkv',
			originalFilename: 'Sinners 2025 2160p iT WEB-DL DDP5 1 Atmos DV HDR H 265-BYNDR',
		});
		expect(findManyMock.mock.calls[0][0].select).toMatchObject({
			filename: true,
			originalFilename: true,
		});
	});

	// `delete` threw P2025 when another user had removed the row first, failing the add
	it('removes a release and its files, and a release already gone is no error', async () => {
		deleteManyFileMock.mockResolvedValue({ count: 0 });
		deleteManyRowMock.mockResolvedValue({ count: 0 });
		await expect(service.removeAvailability('hash')).resolves.toBeUndefined();
		expect(deleteManyFileMock).toHaveBeenCalledWith({ where: { hash: 'hash' } });
		expect(deleteManyRowMock).toHaveBeenCalledWith({ where: { hash: 'hash' } });
		expect(deleteMock).not.toHaveBeenCalled();
		// the tombstone that keeps the reconcile cron from filing it straight back
		expect(cacheUpsertMock.mock.calls[0][0].where).toEqual({ key: 'avevicted:hash' });
	});

	// Regression: links are stored in RD's 16-char form but a play request only
	// ever carries the 13-char truncation, so the old exact-match lookup found
	// nothing - 3,938,603 of 3,939,554 rows are the long form.
	it('retrieves hash by the 13-char prefix of an RD link', async () => {
		findManyMock.mockResolvedValue([
			{ hash: 'abc123hash', link: 'https://real-debrid.com/d/abcdef1234567abc' },
		]);
		const hash = await service.getHashByLink('https://real-debrid.com/d/abcdef1234567');
		expect(hash).toBe('abc123hash');
		expect(findManyMock).toHaveBeenCalledWith({
			where: { link: { startsWith: 'https://real-debrid.com/d/abcdef1234567' } },
			select: { hash: true, link: true },
		});
	});

	it('returns null when link is not found', async () => {
		findFirstFileMock.mockResolvedValue(null);
		const hash = await service.getHashByLink('https://real-debrid.com/d/nonexistent');
		expect(hash).toBeNull();
	});

	it('refuses ambiguous RD link attribution rather than choosing the first hash', async () => {
		findFirstFileMock.mockResolvedValue({ hash: 'allowed' });
		findManyMock.mockResolvedValue([
			{ hash: 'allowed', link: 'https://real-debrid.com/d/ABCDEFGHIJKLMabc' },
			{ hash: 'blocked', link: 'https://real-debrid.com/d/ABCDEFGHIJKLMxyz' },
		]);
		expect(await service.getHashByLink('https://real-debrid.com/d/ABCDEFGHIJKLM')).toBeNull();
	});

	it('does not use a longer malformed prefix match as attribution', async () => {
		findFirstFileMock.mockResolvedValue({ hash: 'allowed' });
		findManyMock.mockResolvedValue([
			{ hash: 'allowed', link: 'https://real-debrid.com/d/ABCDEFGHIJKLMspoof' },
		]);
		expect(await service.getHashByLink('https://real-debrid.com/d/ABCDEFGHIJKLM')).toBeNull();
	});

	it('removes only the file whose link rotted, not the whole torrent', async () => {
		findManyMock.mockResolvedValue([{ hash: 'h1' }]);
		deleteManyFileMock.mockResolvedValue({ count: 1 });
		countFileMock.mockResolvedValue(3);
		const removed = await service.removeAvailableFileByLinkPrefix(
			'https://real-debrid.com/d/abcdef1234567'
		);
		expect(removed).toBe(1);
		expect(deleteManyFileMock).toHaveBeenCalledWith({
			where: { link: { startsWith: 'https://real-debrid.com/d/abcdef1234567' } },
		});
		expect(deleteManyRowMock).not.toHaveBeenCalled();
	});

	// A release whose every link died stayed `downloaded` with no file: Torznab /cached,
	// zurg search and the sponsor API, which only ask whether a row exists, kept saying cached.
	it('removes the release once its last file is gone', async () => {
		findManyMock.mockResolvedValue([{ hash: 'h1' }]);
		deleteManyFileMock.mockResolvedValue({ count: 1 });
		countFileMock.mockResolvedValue(0);
		await service.removeAvailableFileByLinkPrefix('https://real-debrid.com/d/abcdef1234567');
		expect(deleteManyRowMock).toHaveBeenCalledWith({ where: { hash: 'h1' } });
	});

	// Re-adding a release from another title's page, or a forged post, moved a shared row to
	// that title for everybody; and a `user_mapped` placeholder never became cached.
	it('keeps a recorded release on its title, and takes Real-Debrid state on an update', async () => {
		upsertMock.mockResolvedValue({});
		await service.upsertAvailability({
			hash: 'a'.repeat(40),
			imdbId: 'tt0119099',
			filename: 'Angel.Has.Fallen.2019.mkv',
			originalFilename: 'Angel.Has.Fallen.2019',
			bytes: 10,
			originalBytes: 10,
			host: 'real-debrid.com',
			progress: 100,
			status: 'downloaded',
			ended: '2026-01-01T00:00:00Z',
			selectedFiles: [{ id: 1, path: '/Angel.Has.Fallen.2019.mkv', bytes: 10, selected: 1 }],
			links: ['https://real-debrid.com/d/ABCDEFGHIJKLM'],
		});
		const { update, create } = upsertMock.mock.calls[0][0];
		expect(update.imdbId).toBeUndefined();
		expect(update).toMatchObject({ status: 'downloaded', progress: 100, bytes: BigInt(10) });
		expect(create.imdbId).toBe('tt0119099');
	});

	it('never moves an existing row to a title typed in a cast', async () => {
		upsertMock.mockResolvedValue({});
		await service.saveIMDBIdMapping('a'.repeat(40), 'tt0068646');
		expect(upsertMock.mock.calls[0][0].update).toEqual({});
	});

	it('saves instant availability with a synthetic marker file', async () => {
		findManyMock.mockResolvedValue([]);
		createManyMock.mockResolvedValue({ count: 1 });
		createManyFileMock.mockResolvedValue({ count: 1 });

		const saved = await service.saveInstantAvailability('tt0903747', [
			{
				hash: 'a'.repeat(40),
				filename: 'Breaking.Bad.S01E01.Pilot.1080p.mkv',
				bytes: 3811783475,
			},
		]);

		expect(saved).toBe(1);
		const availableRow = createManyMock.mock.calls[0][0].data[0];
		expect(availableRow).toMatchObject({
			hash: 'a'.repeat(40),
			imdbId: 'tt0903747',
			status: 'downloaded',
			host: 'real-debrid.com',
			progress: 100,
			season: 1,
			episode: 1,
		});
		const fileRow = createManyFileMock.mock.calls[0][0].data[0];
		expect(fileRow).toMatchObject({
			link: `debridio:${'a'.repeat(40)}`,
			file_id: 0,
			path: 'Breaking.Bad.S01E01.Pilot.1080p.mkv',
			season: 1,
			episode: 1,
		});
	});

	// filename is VARCHAR(191): one longer debridio name failed the createMany for the title
	it('fits a long debridio name to its column', async () => {
		findManyMock.mockResolvedValue([]);
		createManyMock.mockResolvedValue({ count: 1 });
		createManyFileMock.mockResolvedValue({ count: 1 });
		const long = `Show.S01E01.${'Very.Long.Title.'.repeat(20)}1080p.mkv`;

		await service.saveInstantAvailability('tt0903747', [
			{ hash: 'b'.repeat(40), filename: long, bytes: 1 },
		]);

		const row = createManyMock.mock.calls[0][0].data[0];
		expect(row.filename.length).toBeLessThanOrEqual(191);
		expect(row.originalFilename.length).toBeLessThanOrEqual(191);
	});

	it('skips hashes that already have availability rows', async () => {
		findManyMock.mockResolvedValue([{ hash: 'a'.repeat(40) }]);

		const saved = await service.saveInstantAvailability('tt0903747', [
			{ hash: 'a'.repeat(40), filename: 'already-present.mkv', bytes: 1000 },
		]);

		expect(saved).toBe(0);
		expect(createManyMock).not.toHaveBeenCalled();
		expect(createManyFileMock).not.toHaveBeenCalled();
	});

	// A release removed as uncached or dead leaves a tombstone so nothing files it back; the
	// Debridio scrape, a third party's word, never read it and could put it back for everyone.
	it('skips a Debridio hash removed as uncached or dead', async () => {
		const evicted = 'c'.repeat(40);
		findManyMock.mockResolvedValue([]);
		cacheFindManyMock.mockResolvedValue([{ key: `avevicted:${evicted}` }]);
		createManyMock.mockResolvedValue({ count: 1 });
		createManyFileMock.mockResolvedValue({ count: 1 });

		const saved = await service.saveInstantAvailability('tt0903747', [
			{ hash: evicted.toUpperCase(), filename: 'Evicted.S01E01.mkv', bytes: 1 },
			{ hash: 'd'.repeat(40), filename: 'Fresh.S01E01.mkv', bytes: 1 },
		]);

		expect(saved).toBe(1);
		expect(createManyMock.mock.calls[0][0].data.map((r: any) => r.hash)).toEqual([
			'd'.repeat(40),
		]);
	});

	// Two separate inserts: a failed file insert left a release with no file, which every
	// later scrape skipped as already present.
	it('writes a Debridio release and its marker file in one transaction', async () => {
		findManyMock.mockResolvedValue([]);
		createManyMock.mockResolvedValue({ count: 1 });
		createManyFileMock.mockResolvedValue({ count: 1 });
		await service.saveInstantAvailability('tt0903747', [
			{ hash: 'd'.repeat(40), filename: 'Fresh.S01E01.mkv', bytes: 1 },
		]);
		expect(transactionMock).toHaveBeenCalledTimes(1);
		expect(transactionMock.mock.calls[0][0]).toHaveLength(2);
	});

	it('reads the debridio refresh gate from its cache row', async () => {
		cacheFindUniqueMock.mockResolvedValue({ updatedAt: new Date('2026-08-01') });

		await expect(service.getDebridioRefreshedAt('movie:tt1')).resolves.toEqual(
			new Date('2026-08-01')
		);
		expect(cacheFindUniqueMock).toHaveBeenCalledWith({
			where: { key: 'debridio:refresh:movie:tt1' },
			select: { updatedAt: true },
		});

		cacheFindUniqueMock.mockResolvedValue(null);
		await expect(service.getDebridioRefreshedAt('movie:tt1')).resolves.toBeNull();
	});

	it('upserts the debridio refresh gate row', async () => {
		await service.markDebridioRefreshed('tv:tt2:1');
		expect(cacheUpsertMock).toHaveBeenCalledWith({
			where: { key: 'debridio:refresh:tv:tt2:1' },
			update: { value: {} },
			create: { key: 'debridio:refresh:tv:tt2:1', value: {} },
		});
	});

	it('saves instant availability for alldebrid with Ready statuses and marker files', async () => {
		findManyAdMock.mockResolvedValue([]);
		createManyAdMock.mockResolvedValue({ count: 1 });
		createManyAdFileMock.mockResolvedValue({ count: 1 });

		const saved = await service.saveInstantAvailabilityAd('tt0111161', [
			{
				hash: 'B'.repeat(40),
				filename: 'The.Shawshank.Redemption.1994.MULTI.1080p.BluRay.x265',
				bytes: 5368709120,
			},
		]);

		expect(saved).toBe(1);
		const adRow = createManyAdMock.mock.calls[0][0].data[0];
		expect(adRow).toMatchObject({
			hash: 'b'.repeat(40),
			imdbId: 'tt0111161',
			status: 'Ready',
			statusCode: 4,
			host: 'alldebrid.com',
		});
		const adFile = createManyAdFileMock.mock.calls[0][0].data[0];
		expect(adFile).toMatchObject({
			link: `debridio:${'b'.repeat(40)}`,
			file_id: 0,
			path: 'The.Shawshank.Redemption.1994.MULTI.1080p.BluRay.x265',
		});
	});

	it('skips an AllDebrid Debridio hash whose release was removed as dead', async () => {
		const evicted = 'e'.repeat(40);
		findManyAdMock.mockResolvedValue([]);
		cacheFindManyMock.mockResolvedValue([{ key: `adevicted:${evicted}` }]);
		const saved = await service.saveInstantAvailabilityAd('tt0111161', [
			{ hash: evicted, filename: 'Dead.mkv', bytes: 1 },
		]);
		expect(saved).toBe(0);
		expect(createManyAdMock).not.toHaveBeenCalled();
	});

	it('skips alldebrid hashes that already exist', async () => {
		findManyAdMock.mockResolvedValue([{ hash: 'b'.repeat(40) }]);

		const saved = await service.saveInstantAvailabilityAd('tt0111161', [
			{ hash: 'B'.repeat(40), filename: 'present.mkv', bytes: 1 },
		]);

		expect(saved).toBe(0);
		expect(createManyAdMock).not.toHaveBeenCalled();
		expect(createManyAdFileMock).not.toHaveBeenCalled();
	});

	// Production, 2026-11-05: 8,204 RD and 4,432 AD rows hold one Debridio marker named after
	// the release, with no extension (Debridio gave a stream title, not a file name). Torznab
	// offered them as cached; title pages and the hashlist filter hid them.
	describe('a Debridio marker without an extension', () => {
		const marker = {
			hash: 'f'.repeat(40),
			files: [
				{
					file_id: 0,
					path: 'Lost S05 1080p BluRay REMUX AVC DTS-HD MA 5.1-FraMeSToR',
					bytes: BigInt(1),
					link: `debridio:${'f'.repeat(40)}`,
				},
			],
		};

		it('counts as playable', async () => {
			findManyMock.mockResolvedValue([marker]);
			expect(await service.filterPlayableCachedHashes([marker.hash])).toEqual(
				new Set([marker.hash])
			);
		});

		it('is flagged to the page, without its link', async () => {
			findManyMock.mockResolvedValue([marker]);
			const [row] = await service.checkAvailability('tt0411008', [marker.hash]);
			expect(row.files).toEqual([
				{ file_id: 0, path: marker.files[0].path, bytes: 1, marker: true },
			]);
		});
	});

	describe('filterPlayableCachedHashes', () => {
		const rows = [
			{
				hash: 'AAAA',
				files: [{ path: '/Show/Episode.mkv', link: 'https://real-debrid.com/d/A' }],
			},
			// cached, but nothing in it plays
			{
				hash: 'bbbb',
				files: [
					{ path: '/Show/Episode.nfo', link: 'https://real-debrid.com/d/B' },
					{ path: '/Sample/sample.mkv', link: 'https://real-debrid.com/d/C' },
				],
			},
			{ hash: 'cccc', files: [] },
		];

		it('answers only the cached hashes holding a video, lower-cased', async () => {
			findManyMock.mockResolvedValue(rows);
			const cached = await service.filterPlayableCachedHashes(['AAAA', 'bbbb', 'cccc']);
			expect(cached).toEqual(new Set(['aaaa']));
			expect(findManyMock).toHaveBeenCalledWith({
				where: { hash: { in: ['AAAA', 'bbbb', 'cccc'] }, status: 'downloaded' },
				select: { hash: true, files: { select: { path: true, link: true } } },
			});
		});

		it("reads AllDebrid's own ready rows, by lower-cased hash", async () => {
			findManyAdMock.mockResolvedValue(rows);
			const cached = await service.filterPlayableCachedHashesAd(['AAAA', 'bbbb']);
			expect(cached).toEqual(new Set(['aaaa']));
			expect(findManyAdMock).toHaveBeenCalledWith({
				where: { hash: { in: ['aaaa', 'bbbb'] }, status: 'Ready', statusCode: 4 },
				select: { hash: true, files: { select: { path: true, link: true } } },
			});
		});

		it('asks the database nothing for an empty list', async () => {
			expect(await service.filterPlayableCachedHashes([])).toEqual(new Set());
			expect(findManyMock).not.toHaveBeenCalled();
		});
	});

	describe('getNewlyCached', () => {
		const since = new Date('2026-10-30T00:00:00Z');
		const select = {
			hash: true,
			imdbId: true,
			season: true,
			createdAt: true,
			filename: true,
			originalFilename: true,
		};
		const row = {
			hash: 'ABCD',
			imdbId: 'tt1',
			season: 2,
			createdAt: new Date('2026-11-05T10:00:00Z'),
			filename: 'f',
			originalFilename: 'o',
		};

		it("reads Real-Debrid's downloaded rows, newest first and within the window", async () => {
			findManyMock.mockResolvedValue([row]);
			expect(await service.getNewlyCached('rd', since, 3000)).toEqual([
				{ ...row, hash: 'abcd' },
			]);
			expect(findManyMock).toHaveBeenCalledWith({
				where: { status: 'downloaded', createdAt: { gte: since } },
				orderBy: { createdAt: 'desc' },
				take: 3000,
				select,
			});
		});

		it("reads AllDebrid's own ready rows the same way", async () => {
			findManyAdMock.mockResolvedValue([row]);
			await service.getNewlyCached('ad', since, 3000);
			expect(findManyAdMock).toHaveBeenCalledWith({
				where: { status: 'Ready', statusCode: 4, createdAt: { gte: since } },
				orderBy: { createdAt: 'desc' },
				take: 3000,
				select,
			});
		});

		it('never returns a row older than the column', async () => {
			findManyMock.mockResolvedValue([{ ...row, createdAt: null }]);
			expect(await service.getNewlyCached('rd', since, 3000)).toEqual([]);
		});
	});
});
