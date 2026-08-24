import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability';

const findFirstMock = vi.fn();
const upsertMock = vi.fn();
const findManyMock = vi.fn();
const deleteMock = vi.fn();
const findUniqueMock = vi.fn();
const findFirstFileMock = vi.fn();
const deleteManyFileMock = vi.fn();

vi.mock('@prisma/client', () => ({
	PrismaClient: vi.fn().mockImplementation(() => ({
		available: {
			findFirst: findFirstMock,
			upsert: upsertMock,
			findMany: findManyMock,
			delete: deleteMock,
		},
		availableFile: {
			findUnique: findUniqueMock,
			findFirst: findFirstFileMock,
			deleteMany: deleteManyFileMock,
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
});
