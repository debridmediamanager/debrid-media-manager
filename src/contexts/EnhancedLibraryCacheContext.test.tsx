import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import {
	EnhancedLibraryCacheProvider,
	useEnhancedLibraryCache,
} from './EnhancedLibraryCacheContext';

vi.mock('react-hot-toast', () => {
	const mock = {
		success: vi.fn(),
		error: vi.fn(),
	};
	return {
		...mock,
		default: mock,
	};
});

const { fetchLibraryMock, clearLibraryCacheMock, cacheClearMock, torrentDbMocks } = vi.hoisted(
	() => {
		const resolved = () => vi.fn().mockResolvedValue(undefined);
		return {
			fetchLibraryMock: vi.fn(),
			clearLibraryCacheMock: vi.fn(),
			cacheClearMock: vi.fn(),
			torrentDbMocks: {
				all: vi.fn().mockResolvedValue([]),
				replaceAll: resolved(),
				upsert: resolved(),
				addAll: resolved(),
				deleteById: resolved(),
				deleteMany: resolved(),
				add: resolved(),
			},
		};
	}
);

const buildTorrent = (id: string): UserTorrent => ({
	id,
	filename: `${id}.mkv`,
	title: id,
	hash: `${id}-hash`,
	bytes: 1,
	progress: 1,
	status: UserTorrentStatus.finished,
	serviceStatus: 'done',
	added: new Date('2023-01-01T00:00:00Z'),
	mediaType: 'movie',
	info: undefined,
	links: [],
	selectedFiles: [],
	seeders: 0,
	speed: 0,
});

vi.mock('@/services/library/UnifiedLibraryFetcher', () => {
	class MockUnifiedLibraryFetcher {
		fetchLibrary = fetchLibraryMock;
		clearCache = clearLibraryCacheMock;
	}

	return {
		UnifiedLibraryFetcher: MockUnifiedLibraryFetcher,
		fetchLibraryMock,
	};
});

vi.mock('@/services/cache/CacheManager', () => {
	class MockCacheManager {
		clear = cacheClearMock;
	}

	return {
		CacheManager: MockCacheManager,
		getGlobalCache: vi.fn(() => new MockCacheManager()),
	};
});

class MockUnifiedRateLimiter {}

vi.mock('@/services/rateLimit/UnifiedRateLimiter', () => {
	class MockUnifiedRateLimiter {}

	return {
		UnifiedRateLimiter: MockUnifiedRateLimiter,
		getGlobalRateLimiter: vi.fn(() => new MockUnifiedRateLimiter()),
	};
});

vi.mock('@/torrent/db', () => ({
	default: class MockUserTorrentDB {
		all = torrentDbMocks.all;
		replaceAll = torrentDbMocks.replaceAll;
		upsert = torrentDbMocks.upsert;
		addAll = torrentDbMocks.addAll;
		deleteById = torrentDbMocks.deleteById;
		deleteMany = torrentDbMocks.deleteMany;
		add = torrentDbMocks.add;
	},
}));

vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: vi.fn(),
	useAllDebridApiKey: vi.fn(),
	useTorBoxAccessToken: vi.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
	<EnhancedLibraryCacheProvider>{children}</EnhancedLibraryCacheProvider>
);

const mockedUseRealDebridAccessToken = vi.mocked(useRealDebridAccessToken);
const mockedUseAllDebridApiKey = vi.mocked(useAllDebridApiKey);
const mockedUseTorBoxAccessToken = vi.mocked(useTorBoxAccessToken);

describe('EnhancedLibraryCacheContext refreshLibrary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fetchLibraryMock.mockReset();
		clearLibraryCacheMock.mockReset();
		cacheClearMock.mockReset();
		for (const mockFn of Object.values(torrentDbMocks)) {
			mockFn.mockClear();
		}
		mockedUseRealDebridAccessToken.mockReturnValue([null, false, false]);
		mockedUseAllDebridApiKey.mockReturnValue(null);
		mockedUseTorBoxAccessToken.mockReturnValue(null);
	});

	afterEach(() => {});

	it('refreshes every authenticated service when called without an explicit target', async () => {
		mockedUseRealDebridAccessToken.mockReturnValue(['rd-token', false, false]);
		mockedUseAllDebridApiKey.mockReturnValue('ad-token');
		fetchLibraryMock.mockImplementation((service) => {
			if (service === 'realdebrid') {
				return Promise.resolve([{ id: 'rd:1' }] as any);
			}
			if (service === 'alldebrid') {
				return Promise.resolve([{ id: 'ad:1' }] as any);
			}
			return Promise.resolve([]);
		});

		const { result } = renderHook(() => useEnhancedLibraryCache(), { wrapper });

		await waitFor(() => expect(result.current.refreshLibrary).toBeDefined());
		await waitFor(() => expect(fetchLibraryMock).toHaveBeenCalledTimes(2));

		await act(async () => {
			await result.current.refreshLibrary(undefined, true);
		});

		expect(fetchLibraryMock).toHaveBeenCalledTimes(4);
		expect(fetchLibraryMock).toHaveBeenNthCalledWith(
			1,
			'realdebrid',
			'rd-token',
			expect.objectContaining({ forceRefresh: true })
		);
		expect(fetchLibraryMock).toHaveBeenNthCalledWith(
			2,
			'alldebrid',
			'ad-token',
			expect.objectContaining({ forceRefresh: true })
		);
		expect(fetchLibraryMock).toHaveBeenNthCalledWith(
			3,
			'realdebrid',
			'rd-token',
			expect.objectContaining({ forceRefresh: true })
		);
		expect(fetchLibraryMock).toHaveBeenNthCalledWith(
			4,
			'alldebrid',
			'ad-token',
			expect.objectContaining({ forceRefresh: true })
		);
	});

	it('throws when a specific service is requested without a token', async () => {
		const { result } = renderHook(() => useEnhancedLibraryCache(), { wrapper });

		await waitFor(() => expect(result.current.refreshLibrary).toBeDefined());

		await expect(
			act(async () => {
				await result.current.refreshLibrary('alldebrid', false);
			})
		).rejects.toThrow('No token for alldebrid');
	});

	it('auto refreshes AllDebrid when api key becomes available', async () => {
		fetchLibraryMock.mockResolvedValue([]);
		mockedUseAllDebridApiKey.mockReturnValueOnce(null);
		mockedUseAllDebridApiKey.mockReturnValue('ad-token');

		const { rerender } = renderHook(() => useEnhancedLibraryCache(), { wrapper });

		await act(async () => {
			rerender();
		});

		await waitFor(() =>
			expect(fetchLibraryMock).toHaveBeenCalledWith(
				'alldebrid',
				'ad-token',
				expect.objectContaining({ forceRefresh: true })
			)
		);
	});

	it('auto refreshes RealDebrid when access token becomes available', async () => {
		fetchLibraryMock.mockResolvedValue([]);
		mockedUseRealDebridAccessToken
			.mockReturnValueOnce([null, false, false])
			.mockReturnValue(['rd-token', false, false]);

		const { rerender } = renderHook(() => useEnhancedLibraryCache(), { wrapper });

		await act(async () => {
			rerender();
		});

		await waitFor(() =>
			expect(fetchLibraryMock).toHaveBeenCalledWith(
				'realdebrid',
				'rd-token',
				expect.objectContaining({ forceRefresh: true })
			)
		);
	});

	it('auto refreshes AllDebrid when api key changes to a different value', async () => {
		fetchLibraryMock.mockResolvedValue([]);
		mockedUseAllDebridApiKey.mockReturnValue('first-token');

		const { rerender } = renderHook(() => useEnhancedLibraryCache(), { wrapper });

		await act(async () => {
			await Promise.resolve();
		});

		fetchLibraryMock.mockClear();
		mockedUseAllDebridApiKey.mockReturnValue('second-token');

		await act(async () => {
			rerender();
		});

		await waitFor(() =>
			expect(fetchLibraryMock).toHaveBeenCalledWith(
				'alldebrid',
				'second-token',
				expect.objectContaining({ forceRefresh: true })
			)
		);
	});

	it('auto refreshes RealDebrid when access token changes to a different value', async () => {
		fetchLibraryMock.mockResolvedValue([]);
		mockedUseRealDebridAccessToken.mockReturnValue(['first-token', false, false]);

		const { rerender } = renderHook(() => useEnhancedLibraryCache(), { wrapper });

		await act(async () => {
			await Promise.resolve();
		});

		fetchLibraryMock.mockClear();
		mockedUseRealDebridAccessToken.mockReturnValue(['second-token', false, false]);

		await act(async () => {
			rerender();
		});

		await waitFor(() =>
			expect(fetchLibraryMock).toHaveBeenCalledWith(
				'realdebrid',
				'second-token',
				expect.objectContaining({ forceRefresh: true })
			)
		);
	});

	it('refreshes new services once and skips re-fetching after cache hydration', async () => {
		const cachedRd = buildTorrent('rd:cached');
		const cachedAd = buildTorrent('ad:cached');
		const cachedTb = buildTorrent('tb:cached');

		let rdToken: [string | null, boolean, boolean] = [null, false, false];
		let adToken: string | null = null;
		let tbToken: string | null = null;

		mockedUseRealDebridAccessToken.mockImplementation(() => rdToken);
		mockedUseAllDebridApiKey.mockImplementation(() => adToken);
		mockedUseTorBoxAccessToken.mockImplementation(() => tbToken);

		const callsFor = (service: 'realdebrid' | 'alldebrid' | 'torbox') =>
			fetchLibraryMock.mock.calls.filter(([svc]) => svc === service).length;

		fetchLibraryMock.mockImplementation((service) => {
			if (service === 'realdebrid') {
				return Promise.resolve([buildTorrent('rd:fetched')] as UserTorrent[]);
			}
			if (service === 'alldebrid') {
				return Promise.resolve([buildTorrent('ad:fetched')] as UserTorrent[]);
			}
			return Promise.resolve([buildTorrent('tb:fetched')] as UserTorrent[]);
		});

		const render = () => renderHook(() => useEnhancedLibraryCache(), { wrapper });

		torrentDbMocks.all.mockResolvedValueOnce([]);
		let hook = render();

		await waitFor(() => expect(hook.result.current.syncStatus.isLoading).toBe(false));
		expect(callsFor('realdebrid')).toBe(0);
		expect(callsFor('alldebrid')).toBe(0);
		expect(callsFor('torbox')).toBe(0);

		rdToken = ['rd-token', false, false];
		await act(async () => {
			hook.rerender();
		});
		await waitFor(() => expect(hook.result.current.rdLibrary).toHaveLength(1));
		expect(callsFor('realdebrid')).toBe(1);

		const rdCallsAfterLogin = callsFor('realdebrid');

		hook.unmount();
		torrentDbMocks.all.mockResolvedValueOnce([cachedRd]);
		hook = render();
		await waitFor(() => expect(hook.result.current.syncStatus.isLoading).toBe(false));
		expect(hook.result.current.rdLibrary).toHaveLength(1);
		expect(hook.result.current.rdLibrary[0]?.id).toBe(cachedRd.id);
		expect(callsFor('realdebrid')).toBe(rdCallsAfterLogin);

		adToken = 'ad-token';
		await act(async () => {
			hook.rerender();
		});
		await waitFor(() => expect(hook.result.current.adLibrary).toHaveLength(1));
		expect(callsFor('alldebrid')).toBe(1);

		const rdCallsAfterAdLogin = callsFor('realdebrid');
		const adCallsAfterLogin = callsFor('alldebrid');

		hook.unmount();
		torrentDbMocks.all.mockResolvedValueOnce([cachedRd, cachedAd]);
		hook = render();
		await waitFor(() => expect(hook.result.current.syncStatus.isLoading).toBe(false));
		expect(hook.result.current.rdLibrary[0]?.id).toBe(cachedRd.id);
		expect(hook.result.current.adLibrary[0]?.id).toBe(cachedAd.id);
		expect(callsFor('realdebrid')).toBe(rdCallsAfterAdLogin);
		expect(callsFor('alldebrid')).toBe(adCallsAfterLogin);

		tbToken = 'tb-token';
		await act(async () => {
			hook.rerender();
		});
		await waitFor(() => expect(hook.result.current.tbLibrary).toHaveLength(1));
		expect(callsFor('torbox')).toBe(1);

		const rdCallsAfterTbLogin = callsFor('realdebrid');
		const adCallsAfterTbLogin = callsFor('alldebrid');
		const tbCallsAfterLogin = callsFor('torbox');

		hook.unmount();
		torrentDbMocks.all.mockResolvedValueOnce([cachedRd, cachedAd, cachedTb]);
		hook = render();
		await waitFor(() => expect(hook.result.current.syncStatus.isLoading).toBe(false));
		expect(hook.result.current.rdLibrary[0]?.id).toBe(cachedRd.id);
		expect(hook.result.current.adLibrary[0]?.id).toBe(cachedAd.id);
		expect(hook.result.current.tbLibrary[0]?.id).toBe(cachedTb.id);
		expect(callsFor('realdebrid')).toBe(rdCallsAfterTbLogin);
		expect(callsFor('alldebrid')).toBe(adCallsAfterTbLogin);
		expect(callsFor('torbox')).toBe(tbCallsAfterLogin);

		hook.unmount();
	});

	it('upserts manually added torrents instead of duplicating service entries', async () => {
		const { result } = renderHook(() => useEnhancedLibraryCache(), { wrapper });

		await waitFor(() => expect(result.current.syncStatus.isLoading).toBe(false));

		const original = buildTorrent('rd:manual');
		const updated = { ...original, title: 'updated title' };

		act(() => {
			result.current.addTorrent(original);
			result.current.addTorrent(updated);
		});

		await waitFor(() => expect(result.current.rdLibrary).toHaveLength(1));
		expect(result.current.libraryItems).toHaveLength(1);
		expect(result.current.rdLibrary[0]?.title).toBe('updated title');
		expect(result.current.libraryItems[0]?.title).toBe('updated title');
	});
});
