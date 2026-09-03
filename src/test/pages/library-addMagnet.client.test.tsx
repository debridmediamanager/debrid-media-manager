import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRouter = {
	pathname: '/library',
	asPath: '/library',
	query: {} as Record<string, string | string[]>,
	push: vi.fn(),
	replace: vi.fn().mockResolvedValue(true),
	events: {
		on: vi.fn(),
		off: vi.fn(),
	},
};

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => mockRouter,
}));

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			traktClientId: 'test-trakt-client-id',
		},
	}),
}));

const mockAddTorrent = vi.fn();
const mockRefreshLibrary = vi.fn();
const mockLibraryCache = {
	libraryItems: [],
	isLoading: false,
	isFetching: false,
	refreshLibrary: mockRefreshLibrary,
	setLibraryItems: vi.fn(),
	addTorrent: mockAddTorrent,
	removeTorrent: vi.fn(),
	updateTorrent: vi.fn(),
	error: null,
	lastFetchTime: null,
};

vi.mock('@/contexts/LibraryCacheContext', () => ({
	__esModule: true,
	useLibraryCache: () => mockLibraryCache,
}));

vi.mock('@/hooks/auth', () => ({
	__esModule: true,
	useRealDebridAccessToken: () => ['test-rd-key'],
	useAllDebridApiKey: () => 'test-ad-key',
	useTorBoxAccessToken: () => 'test-tb-key',
	usePremiumizeCredential: () => null,
	useOffcloudApiKey: () => null,
	useDebridLinkCredential: () => null,
}));

vi.mock('@/hooks/useRelativeTimeLabel', () => ({
	__esModule: true,
	useRelativeTimeLabel: () => 'Just now',
}));

const mockHandleAddAsMagnetInRd = vi.fn();
const mockHandleAddAsMagnetInAd = vi.fn();
const mockHandleAddAsMagnetInTb = vi.fn();

vi.mock('@/utils/addMagnet', () => ({
	__esModule: true,
	handleAddAsMagnetInRd: (...args: any[]) => mockHandleAddAsMagnetInRd(...args),
	handleAddAsMagnetInAd: (...args: any[]) => mockHandleAddAsMagnetInAd(...args),
	handleAddAsMagnetInTb: (...args: any[]) => mockHandleAddAsMagnetInTb(...args),
	handleAddMultipleHashesInRd: vi.fn(),
	handleAddMultipleHashesInAd: vi.fn(),
	handleAddMultipleHashesInTb: vi.fn(),
	handleAddMultipleTorrentFilesInRd: vi.fn(),
	handleAddMultipleTorrentFilesInTb: vi.fn(),
	handleReinsertTorrentinRd: vi.fn(),
	handleRestartTorrent: vi.fn(),
}));

vi.mock('@/services/allDebrid', () => ({
	__esModule: true,
	uploadMagnet: vi.fn().mockResolvedValue({
		magnets: [{ id: 123, hash: 'testhash' }],
	}),
	getMagnetStatus: vi.fn().mockResolvedValue({
		data: {
			magnets: [
				{
					id: 123,
					filename: 'Test.Torrent.mkv',
					hash: 'testhash',
					size: 1000000,
					status: 'Ready',
					statusCode: 4,
					links: [],
				},
			],
		},
	}),
}));

vi.mock('@/services/torbox', () => ({
	__esModule: true,
	createTorrent: vi.fn(),
	getTorrentList: vi.fn(),
	controlTorrent: vi.fn(),
}));

vi.mock('@/utils/extractHashes', () => ({
	__esModule: true,
	extractHashes: (str: string) => [str.includes('btih:') ? str.split('btih:')[1] : str],
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: {
		success: vi.fn(),
		error: vi.fn(),
		loading: vi.fn(),
		dismiss: vi.fn(),
	},
	Toaster: () => null,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

import LibraryPage from '@/pages/library';

describe('Library Page - addMagnet Query Parameter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRouter.query = {};
		mockRouter.push.mockClear();
		mockRouter.replace.mockClear();
	});

	it('should optimistically add RealDebrid torrent to cache when addMagnet query param is present', async () => {
		const authHooks = await import('@/hooks/auth');
		(authHooks as any).useAllDebridApiKey = vi.fn().mockReturnValue(null);
		(authHooks as any).useTorBoxAccessToken = vi.fn().mockReturnValue(null);

		const testHash = 'abc123def456789012345678901234567890abcd';
		mockRouter.query = { addMagnet: testHash };

		const mockTorrentInfo = {
			id: 'rd123',
			filename: 'Test.Movie.2024.mkv',
			hash: testHash,
			bytes: 5000000000,
			status: 'downloaded',
			added: new Date().toISOString(),
			links: ['http://link1.com', 'http://link2.com'],
			progress: 100,
			files: [],
			seeders: 10,
			speed: 0,
		};

		mockHandleAddAsMagnetInRd.mockImplementation((rdKey, hash, callback) => {
			if (callback) {
				callback(mockTorrentInfo);
			}
			return Promise.resolve();
		});

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockRouter.replace).toHaveBeenCalledWith('/library?page=1', undefined, {
				shallow: true,
			});
		});

		await waitFor(
			() => {
				expect(mockHandleAddAsMagnetInRd).toHaveBeenCalledWith(
					'test-rd-key',
					testHash,
					expect.any(Function)
				);
			},
			{ timeout: 3000 }
		);

		await waitFor(
			() => {
				expect(mockAddTorrent).toHaveBeenCalled();
				const rdTorrent = mockAddTorrent.mock.calls.find((call) =>
					call[0].id.startsWith('rd:')
				);
				expect(rdTorrent).toBeDefined();
				if (rdTorrent) {
					expect(rdTorrent[0].hash).toBe(testHash);
				}
			},
			{ timeout: 3000 }
		);

		(authHooks as any).useAllDebridApiKey = vi.fn().mockReturnValue('test-ad-key');
		(authHooks as any).useTorBoxAccessToken = vi.fn().mockReturnValue('test-tb-key');
	});

	it('should optimistically add AllDebrid torrent to cache when addMagnet query param is present', async () => {
		const authHooks = await import('@/hooks/auth');
		(authHooks as any).useRealDebridAccessToken = vi.fn().mockReturnValue([null]);
		(authHooks as any).useTorBoxAccessToken = vi.fn().mockReturnValue(null);

		const testHash = 'abc123def456789012345678901234567890abcd';
		mockRouter.query = { addMagnet: testHash };

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockRouter.replace).toHaveBeenCalledWith('/library?page=1', undefined, {
				shallow: true,
			});
		});

		await waitFor(
			() => {
				expect(mockAddTorrent).toHaveBeenCalled();
				const addedTorrent = mockAddTorrent.mock.calls.find((call) =>
					call[0].id.startsWith('ad:')
				);
				expect(addedTorrent).toBeDefined();
			},
			{ timeout: 5000 }
		);

		(authHooks as any).useRealDebridAccessToken = vi.fn().mockReturnValue(['test-rd-key']);
		(authHooks as any).useTorBoxAccessToken = vi.fn().mockReturnValue('test-tb-key');
	});

	it('should optimistically add TorBox torrent to cache when addMagnet query param is present', async () => {
		const testHash = 'abc123def456789012345678901234567890abcd';
		mockRouter.query = { addMagnet: testHash };

		const mockUserTorrent = {
			id: 'tb:456',
			filename: 'Test.Movie.2024.mkv',
			hash: testHash,
			bytes: 5000000000,
			status: 1,
			added: new Date(),
			links: [],
			title: 'Test Movie 2024',
			mediaType: 'movie' as const,
			progress: 0,
			serviceStatus: 'downloading',
			selectedFiles: [],
			seeders: 10,
			speed: 1000000,
		};

		mockHandleAddAsMagnetInTb.mockImplementation(async (tbKey, hash, callback) => {
			await callback(mockUserTorrent);
		});

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockRouter.replace).toHaveBeenCalledWith('/library?page=1', undefined, {
				shallow: true,
			});
		});

		await waitFor(() => {
			expect(mockHandleAddAsMagnetInTb).toHaveBeenCalledWith(
				'test-tb-key',
				testHash,
				expect.any(Function)
			);
		});

		await waitFor(() => {
			expect(mockAddTorrent).toHaveBeenCalled();
			const addedTorrent = mockAddTorrent.mock.calls.find((call) =>
				call[0].id.startsWith('tb:')
			)?.[0];
			expect(addedTorrent).toBeDefined();
			expect(addedTorrent?.id).toBe('tb:456');
			expect(addedTorrent?.hash).toBe(testHash);
		});
	});

	it('should handle magnet URI format', async () => {
		const testHash = 'abc123def456789012345678901234567890abcd';
		const magnetUri = `magnet:?xt=urn:btih:${testHash}`;
		mockRouter.query = { addMagnet: magnetUri };

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockHandleAddAsMagnetInRd).toHaveBeenCalledWith(
				'test-rd-key',
				testHash,
				expect.any(Function)
			);
		});
	});

	it('should not process if no addMagnet query param', async () => {
		mockRouter.query = { page: '1' };

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockHandleAddAsMagnetInRd).not.toHaveBeenCalled();
			expect(mockAddTorrent).not.toHaveBeenCalled();
		});
	});

	it('should not process if more than one hash extracted', async () => {
		vi.mocked(await import('@/utils/extractHashes')).extractHashes = vi
			.fn()
			.mockReturnValue(['hash1', 'hash2']);

		mockRouter.query = { addMagnet: 'multiple hashes' };

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockHandleAddAsMagnetInRd).not.toHaveBeenCalled();
		});
	});
});
