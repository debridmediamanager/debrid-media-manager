import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/torbox', () => ({
	checkCachedStatus: vi.fn(),
	createTorrent: vi.fn(),
	deleteTorrent: vi.fn(),
	getTorrentList: vi.fn(),
	requestDownloadLink: vi.fn(),
}));

vi.mock('@/utils/delay', () => ({
	delay: vi.fn().mockResolvedValue(undefined),
}));

import {
	checkCachedStatus,
	createTorrent,
	deleteTorrent,
	getTorrentList,
	requestDownloadLink,
} from '@/services/torbox';
import {
	getBiggestFileTorBoxStreamUrl,
	getFileByNameTorBoxStreamUrl,
	getTorBoxStreamUrl,
	getTorBoxStreamUrlKeepTorrent,
} from './getTorBoxStreamUrl';

const mockCheckCached = vi.mocked(checkCachedStatus);
const mockCreateTorrent = vi.mocked(createTorrent);
const mockDeleteTorrent = vi.mocked(deleteTorrent);
const mockGetTorrentList = vi.mocked(getTorrentList);
const mockRequestDownloadLink = vi.mocked(requestDownloadLink);

const API_KEY = 'test-api-key';
const HASH = 'abc123hash';

function makeTorrent(overrides: Record<string, any> = {}) {
	return {
		id: 42,
		hash: HASH,
		download_finished: true,
		download_state: 'completed',
		files: [
			{ id: 1, name: 'Movie.S01E03.mkv', short_name: 'Movie.S01E03.mkv', size: 1073741824 },
			{ id: 2, name: 'Sample.txt', short_name: 'Sample.txt', size: 1024 },
		],
		...overrides,
	};
}

function setupCached(cached = true) {
	mockCheckCached.mockResolvedValue({
		success: true,
		data: cached ? { [HASH]: { name: 'test', size: 100 } } : {},
	} as any);
}

function setupExistingTorrent(torrent: any = makeTorrent()) {
	mockGetTorrentList.mockResolvedValue({
		success: true,
		data: [torrent],
	} as any);
}

function setupNoExistingTorrent() {
	mockGetTorrentList.mockResolvedValue({
		success: true,
		data: [],
	} as any);
}

function setupCreateTorrent(torrentId = 42) {
	mockCreateTorrent.mockResolvedValue({
		success: true,
		data: { torrent_id: torrentId },
	} as any);
}

function setupDownloadLink(url = 'https://torbox.app/download/stream123') {
	mockRequestDownloadLink.mockResolvedValue({
		success: true,
		data: url,
	} as any);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockDeleteTorrent.mockResolvedValue(undefined as any);
});

describe('getTorBoxStreamUrl', () => {
	it('returns stream URL for cached torrent with existing user torrent', async () => {
		setupCached();
		setupExistingTorrent();
		setupDownloadLink();

		const result = await getTorBoxStreamUrl(API_KEY, HASH, 1, 'movie');

		expect(result[0]).toBe('https://torbox.app/download/stream123');
		expect(result[4]).toBe(42);
		expect(result[5]).toBe(1);
		expect(mockCreateTorrent).not.toHaveBeenCalled();
	});

	it('creates new torrent when none exists', async () => {
		setupCached();
		setupNoExistingTorrent();
		setupCreateTorrent(99);
		mockGetTorrentList.mockResolvedValueOnce({ success: true, data: [] } as any);
		mockGetTorrentList.mockResolvedValueOnce({
			success: true,
			data: [makeTorrent({ id: 99 })],
		} as any);
		setupDownloadLink();

		const result = await getTorBoxStreamUrl(API_KEY, HASH, 1, 'movie');

		expect(mockCreateTorrent).toHaveBeenCalledWith(API_KEY, {
			magnet: `magnet:?xt=urn:btih:${HASH}`,
		});
		expect(result[4]).toBe(99);
	});

	it('parses season/episode for TV media type', async () => {
		setupCached();
		setupExistingTorrent();
		setupDownloadLink();

		const result = await getTorBoxStreamUrl(API_KEY, HASH, 1, 'tv');

		expect(result[1]).toBe(1);
		expect(result[2]).toBe(3);
	});

	it('returns -1 for season/episode for movie type', async () => {
		setupCached();
		setupExistingTorrent();
		setupDownloadLink();

		const result = await getTorBoxStreamUrl(API_KEY, HASH, 1, 'movie');

		expect(result[1]).toBe(-1);
		expect(result[2]).toBe(-1);
	});

	it('throws when not cached', async () => {
		setupCached(false);

		await expect(getTorBoxStreamUrl(API_KEY, HASH, 1, 'movie')).rejects.toThrow(
			'Torrent not cached on TorBox'
		);
	});

	it('throws when file not found', async () => {
		setupCached();
		setupExistingTorrent();

		await expect(getTorBoxStreamUrl(API_KEY, HASH, 999, 'movie')).rejects.toThrow(
			'File with ID 999 not found in torrent'
		);
	});

	it('cleans up torrent on error if added this call', async () => {
		setupCached();
		setupNoExistingTorrent();
		setupCreateTorrent(99);
		mockGetTorrentList.mockResolvedValueOnce({ success: true, data: [] } as any);
		mockGetTorrentList.mockResolvedValueOnce({
			success: true,
			data: [makeTorrent({ id: 99, files: [] })],
		} as any);

		await expect(getTorBoxStreamUrl(API_KEY, HASH, 1, 'movie')).rejects.toThrow(
			'File with ID 1 not found in torrent'
		);
		expect(mockDeleteTorrent).toHaveBeenCalledWith(API_KEY, 99);
	});

	it('does not clean up if torrent was pre-existing', async () => {
		setupCached();
		setupExistingTorrent(makeTorrent({ files: [] }));

		await expect(getTorBoxStreamUrl(API_KEY, HASH, 1, 'movie')).rejects.toThrow();
		expect(mockDeleteTorrent).not.toHaveBeenCalled();
	});
});

describe('getFileByNameTorBoxStreamUrl', () => {
	it('finds file by exact name match', async () => {
		setupCached();
		setupExistingTorrent();
		setupDownloadLink('https://torbox.app/download/byname');

		const result = await getFileByNameTorBoxStreamUrl(API_KEY, HASH, 'Movie.S01E03.mkv');

		expect(result[0]).toBe('https://torbox.app/download/byname');
		expect(result[4]).toBe('Movie.S01E03.mkv');
	});

	it('falls back to case-insensitive match', async () => {
		setupCached();
		setupExistingTorrent();
		setupDownloadLink('https://torbox.app/download/ci');

		const result = await getFileByNameTorBoxStreamUrl(API_KEY, HASH, 'movie.s01e03.mkv');

		expect(result[0]).toBe('https://torbox.app/download/ci');
	});

	it('throws when file not found', async () => {
		setupCached();
		setupExistingTorrent();

		await expect(
			getFileByNameTorBoxStreamUrl(API_KEY, HASH, 'nonexistent.mkv')
		).rejects.toThrow('File "nonexistent.mkv" not found in torrent');
	});
});

describe('getBiggestFileTorBoxStreamUrl', () => {
	it('finds largest file', async () => {
		setupCached();
		setupExistingTorrent();
		setupDownloadLink('https://torbox.app/download/biggest');

		const result = await getBiggestFileTorBoxStreamUrl(API_KEY, HASH);

		expect(result[0]).toBe('https://torbox.app/download/biggest');
		expect(result[3]).toBe(1);
		expect(result[4]).toBe('Movie.S01E03.mkv');
		expect(result[1]).toBe(1024);
	});
});

describe('getTorBoxStreamUrlKeepTorrent', () => {
	it('does not delete torrent on error', async () => {
		setupCached();
		setupNoExistingTorrent();
		setupCreateTorrent(99);
		mockGetTorrentList.mockResolvedValueOnce({ success: true, data: [] } as any);
		mockGetTorrentList.mockResolvedValueOnce({
			success: true,
			data: [makeTorrent({ id: 99, files: [] })],
		} as any);

		await expect(getTorBoxStreamUrlKeepTorrent(API_KEY, HASH, 1, 'movie')).rejects.toThrow(
			'File with ID 1 not found in torrent'
		);

		expect(mockDeleteTorrent).not.toHaveBeenCalled();
	});
});
