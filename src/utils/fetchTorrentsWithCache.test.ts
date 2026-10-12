import type { UserTorrentResponse, UserTorrentsResult } from '@/services/types';
import { UserTorrentStatus } from '@/torrent/userTorrent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearTorrentCache,
	fetchRealDebridIncremental,
	fetchRealDebridWithCache,
} from './fetchTorrentsWithCache';

vi.mock('@/services/realDebrid', () => ({
	getUserTorrentsList: vi.fn(),
}));

vi.mock('./fetchTorrents', () => ({
	convertToUserTorrent: vi.fn(),
	withOriginalRdNames: vi.fn(async (_key: string, rows: any[]) => rows),
}));

import { getUserTorrentsList } from '@/services/realDebrid';
import { convertToUserTorrent } from './fetchTorrents';

const mockGetUserTorrentsList = vi.mocked(getUserTorrentsList);
const mockConvert = vi.mocked(convertToUserTorrent);

const makeUserTorrent = (id: string) => ({
	id,
	filename: `${id}.mkv`,
	title: id,
	hash: id,
	bytes: 1,
	progress: 0,
	status: UserTorrentStatus.waiting,
	serviceStatus: 'ok',
	added: new Date(0),
	mediaType: 'movie' as const,
	links: [],
	selectedFiles: [],
	seeders: 0,
	speed: 0,
});

const makeApiTorrent = (id: string): UserTorrentResponse => ({
	id,
	filename: `${id}.mkv`,
	hash: `${id}-hash`,
	bytes: 1,
	host: 'real-debrid.com',
	split: 0,
	progress: 100,
	speed: 0,
	status: 'downloaded',
	added: new Date(0).toISOString(),
	links: [`https://example.com/${id}`],
	ended: new Date(0).toISOString(),
	seeders: 1,
});

beforeEach(() => {
	vi.clearAllMocks();
	clearTorrentCache();
	mockConvert.mockImplementation((data: UserTorrentResponse) => makeUserTorrent(data.id));
});

describe('fetchRealDebridWithCache', () => {
	it('returns empty results when no torrents are available', async () => {
		mockGetUserTorrentsList.mockResolvedValueOnce({ data: [], totalCount: 0 });

		const result = await fetchRealDebridWithCache('token');

		expect(result).toEqual({ torrents: [], totalCount: 0, cacheHit: false });
		expect(mockGetUserTorrentsList).toHaveBeenCalledTimes(1);
	});

	it('respects custom limits without hitting cache logic', async () => {
		const items = Array.from({ length: 20 }, (_, i) => makeApiTorrent(`id-${i}`));
		mockGetUserTorrentsList.mockResolvedValueOnce({
			data: items,
			totalCount: items.length,
		});

		const result = await fetchRealDebridWithCache('token', true, 5);

		expect(result.torrents).toHaveLength(5);
		expect(result.cacheHit).toBe(false);
		expect(mockGetUserTorrentsList).toHaveBeenCalledTimes(1);
	});

	it('fetches additional pages when cache misses and reports progress', async () => {
		mockGetUserTorrentsList.mockImplementation(
			async (_token: string, _limit?: number, page = 1): Promise<UserTorrentsResult> => {
				if (page === 1) {
					return {
						data: [makeApiTorrent('first-1'), makeApiTorrent('first-2')],
						totalCount: 3000,
					};
				}
				return {
					data: [makeApiTorrent(`page-${page}-entry`)],
					totalCount: 3000,
				};
			}
		);
		const onProgress = vi.fn();

		const result = await fetchRealDebridWithCache('token', false, undefined, onProgress);

		expect(mockGetUserTorrentsList).toHaveBeenCalledTimes(1 + 1); // first page + second page
		expect(onProgress).toHaveBeenCalledWith(2, 2);
		expect(result.cacheHit).toBe(false);
		expect(result.torrents.map((t) => t.id)).toEqual(['first-1', 'first-2', 'page-2-entry']);
	});

	it('reuses cached torrents when overlap is detected', async () => {
		const pageSize = 1500;
		const buildPage = () =>
			Array.from({ length: pageSize }, (_, i) => makeApiTorrent(`id-${i}`));
		mockGetUserTorrentsList.mockResolvedValue({
			data: buildPage(),
			totalCount: pageSize,
		});

		// Prime cache with full dataset
		await fetchRealDebridWithCache('token', false);

		// Second call should hit cache
		const result = await fetchRealDebridWithCache('token', true);

		expect(result.cacheHit).toBe(true);
		expect(result.torrents).toHaveLength(pageSize);
	});

	it('propagates errors from the API', async () => {
		mockGetUserTorrentsList.mockRejectedValueOnce(new Error('network'));

		await expect(fetchRealDebridWithCache('token')).rejects.toThrow('network');
	});
});

describe('clearTorrentCache', () => {
	it('resets cached torrents and timestamp', async () => {
		mockGetUserTorrentsList.mockResolvedValue({
			data: [makeApiTorrent('id-1')],
			totalCount: 1,
		});
		await fetchRealDebridWithCache('token', false);
		clearTorrentCache();

		mockGetUserTorrentsList.mockResolvedValueOnce({
			data: [makeApiTorrent('id-2')],
			totalCount: 1,
		});
		const result = await fetchRealDebridWithCache('token');

		expect(result.cacheHit).toBe(false);
		expect(result.torrents.map((t) => t.id)).toEqual(['id-2']);
	});
});

describe('fetchRealDebridIncremental', () => {
	it('streams pages incrementally and updates cache', async () => {
		mockGetUserTorrentsList.mockImplementation(
			async (_token: string, _limit?: number, page = 1): Promise<UserTorrentsResult> => {
				if (page === 1) {
					return {
						data: [makeApiTorrent('first-page')],
						totalCount: 3000,
					};
				}
				return {
					data: [makeApiTorrent(`page-${page}`)],
					totalCount: 3000,
				};
			}
		);

		const onPageLoaded = vi.fn();
		const onProgress = vi.fn();

		const result = await fetchRealDebridIncremental('token', onPageLoaded, onProgress);

		expect(onPageLoaded).toHaveBeenCalledTimes(2);
		expect(onProgress).toHaveBeenCalledWith(2, 2);
		expect(result.totalCount).toBe(2);
	});
});
