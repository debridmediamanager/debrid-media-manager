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
vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn().mockImplementation(() => ({
		available: {
			findFirst: findFirstMock,
			upsert: upsertMock,
			findMany: findManyMock,
			delete: deleteMock,
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
			deleteMany: deleteManyFileMock,
			createMany: createManyFileMock,
		},
		cache: {
			findUnique: cacheFindUniqueMock,
			upsert: cacheUpsertMock,
		},
		$disconnect: vi.fn(),
	})),
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
		service = new AvailabilityService();
	});

	it('retrieves imdb id by hash', async () => {
		findFirstMock.mockResolvedValue({ imdbId: 'tt1234567' });
		const imdbId = await service.getIMDBIdByHash('hash');
		expect(imdbId).toBe('tt1234567');
	});

	it('handles downloaded torrents and normalizes payload', async () => {
		const torrentInfo = {
			id: '1',
			filename: 'sample.mkv',
			original_filename: 'Sample Original.mkv',
			bytes: 2048,
			original_bytes: 4096,
			progress: 100,
			status: 'downloaded',
			ended: undefined,
			files: [
				{ id: 1, path: '/video/file1.mkv', bytes: 1024, selected: 1 },
				{ id: 2, path: '/video/file2.mkv', bytes: 1024, selected: 0 },
			],
			links: [],
		};

		await service.handleDownloadedTorrent(torrentInfo as any, 'hash', 'tt1234567');

		expect(upsertMock).toHaveBeenCalledTimes(1);
		const args = upsertMock.mock.calls[0][0];
		expect(args.where).toEqual({ hash: 'hash' });
		expect(args.update.status).toBe('partially_downloaded');
		expect(args.create.files.create).toHaveLength(1);
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

	it('checks availability by imdb id and hashes', async () => {
		findManyMock.mockResolvedValue([
			{
				hash: 'hash',
				files: [{ file_id: 1, path: 'path', bytes: BigInt(100) }],
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
				files: [{ file_id: 1, path: 'path', bytes: BigInt(200) }],
			},
		]);

		const results = await service.checkAvailabilityByHashes(['hash']);
		expect(results[0].files[0].bytes).toBe(200);
	});

	it('removes availability entries', async () => {
		await service.removeAvailability('hash');
		expect(deleteMock).toHaveBeenCalledWith({ where: { hash: 'hash' } });
	});

	// Regression: links are stored in RD's 16-char form but a play request only
	// ever carries the 13-char truncation, so the old exact-match lookup found
	// nothing - 3,938,603 of 3,939,554 rows are the long form.
	it('retrieves hash by the 13-char prefix of an RD link', async () => {
		findFirstFileMock.mockResolvedValue({ hash: 'abc123hash' });
		const hash = await service.getHashByLink('https://real-debrid.com/d/abcdef1234567');
		expect(hash).toBe('abc123hash');
		expect(findFirstFileMock).toHaveBeenCalledWith({
			where: { link: { startsWith: 'https://real-debrid.com/d/abcdef1234567' } },
			select: { hash: true },
		});
	});

	it('returns null when link is not found', async () => {
		findFirstFileMock.mockResolvedValue(null);
		const hash = await service.getHashByLink('https://real-debrid.com/d/nonexistent');
		expect(hash).toBeNull();
	});

	it('removes only the file whose link rotted, not the whole torrent', async () => {
		deleteManyFileMock.mockResolvedValue({ count: 1 });
		const removed = await service.removeAvailableFileByLinkPrefix(
			'https://real-debrid.com/d/abcdef1234567'
		);
		expect(removed).toBe(1);
		expect(deleteManyFileMock).toHaveBeenCalledWith({
			where: { link: { startsWith: 'https://real-debrid.com/d/abcdef1234567' } },
		});
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

	it('skips hashes that already have availability rows', async () => {
		findManyMock.mockResolvedValue([{ hash: 'a'.repeat(40) }]);

		const saved = await service.saveInstantAvailability('tt0903747', [
			{ hash: 'a'.repeat(40), filename: 'already-present.mkv', bytes: 1000 },
		]);

		expect(saved).toBe(0);
		expect(createManyMock).not.toHaveBeenCalled();
		expect(createManyFileMock).not.toHaveBeenCalled();
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

	it('skips alldebrid hashes that already exist', async () => {
		findManyAdMock.mockResolvedValue([{ hash: 'b'.repeat(40) }]);

		const saved = await service.saveInstantAvailabilityAd('tt0111161', [
			{ hash: 'B'.repeat(40), filename: 'present.mkv', bytes: 1 },
		]);

		expect(saved).toBe(0);
		expect(createManyAdMock).not.toHaveBeenCalled();
		expect(createManyAdFileMock).not.toHaveBeenCalled();
	});
});
