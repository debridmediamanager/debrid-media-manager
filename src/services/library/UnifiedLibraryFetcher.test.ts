import { getMagnetStatus } from '@/services/allDebrid';
import { getUserTorrentsList } from '@/services/realDebrid';
import { getTorrentList, getWebDownloadList } from '@/services/torbox';
import {
	convertToAllDebridUserTorrent,
	convertToTbUserTorrent,
	convertToTbWebDownloadUserTorrent,
	convertToUserTorrent,
} from '@/utils/fetchTorrents';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheManager } from '../cache/CacheManager';
import type { UnifiedRateLimiter } from '../rateLimit/UnifiedRateLimiter';
import { UnifiedLibraryFetcher } from './UnifiedLibraryFetcher';

const makeApiTorrent = (id: string) => ({
	id,
	filename: `${id}.mkv`,
	hash: `${id}-hash`,
	bytes: 1,
	host: 'rd',
	split: 0,
	progress: 100,
	speed: 0,
	status: 'downloaded',
	added: new Date(0).toISOString(),
	links: [],
	ended: new Date(0).toISOString(),
	seeders: 0,
});

vi.mock('@/services/realDebrid', () => ({
	getUserTorrentsList: vi.fn(),
}));

vi.mock('@/services/allDebrid', () => ({
	getMagnetStatus: vi.fn(),
}));

vi.mock('@/services/torbox', () => ({
	getTorrentList: vi.fn(),
	getWebDownloadList: vi.fn(),
}));

vi.mock('@/utils/fetchTorrents', () => ({
	convertToUserTorrent: vi.fn((data: any) => ({ id: `rd:${data.id ?? 'unknown'}` }) as any),
	convertToAllDebridUserTorrent: vi.fn(
		(data: any) => ({ id: `ad:${data.id ?? 'unknown'}` }) as any
	),
	convertToTbUserTorrent: vi.fn((data: any) => ({ id: `tb:${data.id ?? 'unknown'}` }) as any),
	convertToTbWebDownloadUserTorrent: vi.fn(
		(data: any) => ({ id: `tb:w${data.id ?? 'unknown'}` }) as any
	),
}));

const mockGetUserTorrentsList = vi.mocked(getUserTorrentsList);
const mockGetMagnetStatus = vi.mocked(getMagnetStatus);
const mockGetTorrentList = vi.mocked(getTorrentList);
const mockGetWebDownloadList = vi.mocked(getWebDownloadList);
const mockConvertToUserTorrent = vi.mocked(convertToUserTorrent);
const mockConvertToAllDebridUserTorrent = vi.mocked(convertToAllDebridUserTorrent);
const mockConvertToTbUserTorrent = vi.mocked(convertToTbUserTorrent);
const mockConvertToTbWebDownloadUserTorrent = vi.mocked(convertToTbWebDownloadUserTorrent);

describe('UnifiedLibraryFetcher', () => {
	const createFetcher = () => {
		const cache = {
			get: vi.fn(),
			set: vi.fn(),
			clear: vi.fn(),
		};
		const limiter = {
			execute: vi.fn(async (_service: string, _key: string, action: () => Promise<any>) =>
				action()
			),
		};
		return {
			fetcher: new UnifiedLibraryFetcher(
				cache as unknown as CacheManager,
				limiter as unknown as UnifiedRateLimiter
			),
			cache,
			limiter,
		};
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns cached RealDebrid data when present', async () => {
		const { fetcher, cache } = createFetcher();
		const cached = [{ id: 'rd:cached' }];
		cache.get.mockResolvedValueOnce(cached);

		const result = await fetcher.fetchLibrary('realdebrid', 'token');

		expect(result).toEqual(cached);
		expect(cache.get).toHaveBeenCalledWith('rd:library:token');
		expect(mockGetUserTorrentsList).not.toHaveBeenCalled();
	});

	it('fetches RealDebrid data, converts it, and caches the result', async () => {
		const { fetcher, cache } = createFetcher();
		cache.get.mockResolvedValueOnce(null);
		mockGetUserTorrentsList
			.mockResolvedValueOnce({ data: [makeApiTorrent('seed')], totalCount: 1 })
			.mockResolvedValueOnce({ data: [makeApiTorrent('seed')], totalCount: 1 });

		const result = await fetcher.fetchLibrary('realdebrid', 'token', {
			maxItems: 1,
			concurrency: 1,
		});

		expect(mockGetUserTorrentsList).toHaveBeenCalledTimes(2);
		expect(mockConvertToUserTorrent).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'seed' })
		);
		expect(result).toEqual([{ id: 'rd:seed' }]);
		expect(cache.set).toHaveBeenCalledWith(
			'rd:library:token',
			result,
			undefined,
			5 * 60 * 1000
		);
	});

	it('reuses in-flight fetches for the same service/token pair', async () => {
		const { fetcher, cache } = createFetcher();
		cache.get.mockResolvedValue(null);
		mockGetUserTorrentsList
			.mockResolvedValueOnce({ data: [makeApiTorrent('seed')], totalCount: 1 })
			.mockResolvedValueOnce({ data: [makeApiTorrent('seed')], totalCount: 1 });

		const [first, second] = await Promise.all([
			fetcher.fetchLibrary('realdebrid', 'token', { maxItems: 1 }),
			fetcher.fetchLibrary('realdebrid', 'token', { maxItems: 1 }),
		]);

		expect(first).toEqual(second);
		expect(mockGetUserTorrentsList).toHaveBeenCalledTimes(2);
	});

	it('processes AllDebrid magnets and caches the output', async () => {
		const { fetcher, cache } = createFetcher();
		cache.get.mockResolvedValueOnce(null);
		mockGetMagnetStatus.mockResolvedValue({
			data: { magnets: [{ id: 'mag-1' }] },
		} as any);

		const result = await fetcher.fetchLibrary('alldebrid', 'ad-token');

		expect(mockGetMagnetStatus).toHaveBeenCalledWith('ad-token');
		expect(mockConvertToAllDebridUserTorrent).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'mag-1' })
		);
		expect(cache.set).toHaveBeenCalledWith(
			'ad:library:ad-token',
			result,
			undefined,
			5 * 60 * 1000
		);
		expect(result).toEqual([{ id: 'ad:mag-1' }]);
	});

	it('paginates Torbox results until an incomplete page is received', async () => {
		const { fetcher, cache } = createFetcher();
		cache.get.mockResolvedValueOnce(null);
		mockGetTorrentList
			.mockResolvedValueOnce({ success: true, data: [{ id: 'tb1' }] } as any)
			.mockResolvedValueOnce({ success: true, data: [] } as any);
		mockGetWebDownloadList.mockResolvedValue({ success: true, data: [] } as any);

		const result = await fetcher.fetchLibrary('torbox', 'tb-token', { maxItems: 150 });

		expect(mockGetTorrentList).toHaveBeenCalledTimes(1);
		expect(mockConvertToTbUserTorrent).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'tb1' })
		);
		expect(cache.set).toHaveBeenCalledWith(
			'tb:library:tb-token',
			result,
			undefined,
			5 * 60 * 1000
		);
		expect(result).toEqual([{ id: 'tb:tb1' }]);
	});

	it('appends Torbox web downloads to the library', async () => {
		const { fetcher, cache } = createFetcher();
		mockGetTorrentList.mockReset();
		mockGetWebDownloadList.mockReset();
		cache.get.mockResolvedValueOnce(null);
		mockGetTorrentList.mockResolvedValueOnce({ success: true, data: [{ id: 'tb1' }] } as any);
		mockGetWebDownloadList.mockResolvedValueOnce({
			success: true,
			data: [{ id: 77 }],
		} as any);

		const result = await fetcher.fetchLibrary('torbox', 'tb-token', { maxItems: 150 });

		expect(mockConvertToTbWebDownloadUserTorrent).toHaveBeenCalledWith(
			expect.objectContaining({ id: 77 })
		);
		expect(result).toEqual([{ id: 'tb:tb1' }, { id: 'tb:w77' }]);
	});

	it('keeps Torbox torrents when the web download list fails', async () => {
		const { fetcher, cache } = createFetcher();
		mockGetTorrentList.mockReset();
		mockGetWebDownloadList.mockReset();
		cache.get.mockResolvedValueOnce(null);
		mockGetTorrentList.mockResolvedValueOnce({ success: true, data: [{ id: 'tb1' }] } as any);
		mockGetWebDownloadList.mockRejectedValueOnce(new Error('webdl down'));

		const result = await fetcher.fetchLibrary('torbox', 'tb-token', { maxItems: 150 });

		expect(result).toEqual([{ id: 'tb:tb1' }]);
	});

	it('does not fetch web downloads once maxItems is already reached', async () => {
		const { fetcher, cache } = createFetcher();
		mockGetTorrentList.mockReset();
		mockGetWebDownloadList.mockReset();
		cache.get.mockResolvedValueOnce(null);
		mockGetTorrentList.mockResolvedValueOnce({ success: true, data: [{ id: 'tb1' }] } as any);

		await fetcher.fetchLibrary('torbox', 'tb-token', { maxItems: 1 });

		expect(mockGetWebDownloadList).not.toHaveBeenCalled();
	});

	it('clears cache for a specific service key when provided', async () => {
		const { fetcher, cache } = createFetcher();
		cache.clear.mockResolvedValue(undefined);

		await fetcher.clearCache('rd', 'token');

		expect(cache.clear).toHaveBeenCalledWith(['rd:library:token']);
	});

	it('clears all caches when no arguments are provided', async () => {
		const { fetcher, cache } = createFetcher();
		cache.clear.mockResolvedValue(undefined);

		await fetcher.clearCache();

		expect(cache.clear).toHaveBeenCalledWith();
	});
});
