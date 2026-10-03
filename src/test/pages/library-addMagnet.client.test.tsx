import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const mockCredentials = vi.hoisted(
	(): { rd: string | null; ad: string | null; tb: string | null } => ({
		rd: 'test-rd-key',
		ad: 'test-ad-key',
		tb: 'test-tb-key',
	})
);

vi.mock('@/hooks/auth', () => ({
	__esModule: true,
	useRealDebridAccessToken: () => [mockCredentials.rd],
	useAllDebridApiKey: () => mockCredentials.ad,
	useTorBoxAccessToken: () => mockCredentials.tb,
	usePremiumizeCredential: () => null,
	useOffcloudApiKey: () => null,
	useDebridLinkCredential: () => null,
}));

vi.mock('@/hooks/useRelativeTimeLabel', () => ({
	__esModule: true,
	useRelativeTimeLabel: () => 'Just now',
}));

const mockHandleAddAsMagnetInRd = vi.fn();

const mockAddFilesInRd = vi.fn();
const mockAddHashesInRd = vi.fn();
const mockModalFire = vi.fn();

vi.mock('@/components/modals/modal', () => ({
	default: {
		fire: (...args: unknown[]) => mockModalFire(...args),
		DismissReason: { cancel: 'cancel' },
	},
}));
vi.mock('@/utils/addMagnet', () => ({
	__esModule: true,
	handleAddAsMagnetInRd: (...args: unknown[]) => mockHandleAddAsMagnetInRd(...args),
	handleAddAsMagnetInAd: vi.fn(),
	handleAddAsMagnetInTb: vi.fn(),
	handleAddMultipleHashesInRd: (...args: unknown[]) => mockAddHashesInRd(...args),
	handleAddMultipleHashesInAd: vi.fn(),
	handleAddMultipleHashesInTb: vi.fn(),
	handleAddMultipleHashesInPm: vi.fn(),
	handleAddMultipleHashesInOc: vi.fn(),
	handleAddMultipleHashesInDl: vi.fn(),
	handleAddMultipleTorrentFilesInRd: (...args: unknown[]) => mockAddFilesInRd(...args),
	handleAddMultipleTorrentFilesInAd: vi.fn(),
	handleAddMultipleTorrentFilesInPm: vi.fn(),
	handleAddMultipleTorrentFilesInOc: vi.fn(),
	handleAddMultipleTorrentFilesInDl: vi.fn(),
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
		mockCredentials.rd = 'test-rd-key';
		mockCredentials.ad = 'test-ad-key';
		mockCredentials.tb = 'test-tb-key';
	});

	it('should optimistically add RealDebrid torrent to cache when addMagnet query param is present', async () => {
		mockCredentials.ad = null;
		mockCredentials.tb = null;

		const testHash = '08ada5a7a6183aae1e09d831df6748d566095a10';
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

		mockCredentials.ad = 'test-ad-key';
		mockCredentials.tb = 'test-tb-key';
	});

	it('should optimistically add AllDebrid torrent to cache when addMagnet query param is present', async () => {
		mockCredentials.rd = null;
		mockCredentials.tb = null;

		const testHash = '08ada5a7a6183aae1e09d831df6748d566095a10';
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

		mockCredentials.rd = 'test-rd-key';
		mockCredentials.tb = 'test-tb-key';
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
		mockRouter.query = {
			addMagnet:
				'08ada5a7a6183aae1e09d831df6748d566095a10 dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
		};

		render(<LibraryPage />);

		await waitFor(() => {
			expect(mockHandleAddAsMagnetInRd).not.toHaveBeenCalled();
		});
	});
});

describe('Library mixed torrent submissions', () => {
	it('finishes native uploads before starting magnets on the same account', async () => {
		mockRouter.query = {};
		const operations: string[] = [];
		let finishUpload!: () => void;
		const uploading = new Promise<void>((resolve) => {
			finishUpload = resolve;
		});
		mockAddFilesInRd.mockImplementation(async () => {
			operations.push('upload:start');
			await uploading;
			operations.push('upload:end');
		});
		mockAddHashesInRd.mockImplementation(async () => {
			operations.push('magnet:start');
		});
		mockModalFire.mockResolvedValue({
			value: {
				torrentInputs: [
					{
						kind: 'hash',
						source: '08ada5a7a6183aae1e09d831df6748d566095a10',
						hash: '08ada5a7a6183aae1e09d831df6748d566095a10',
					},
				],
				torrentFiles: [new File(['torrent bytes'], 'sintel.torrent')],
				webDownloadLinks: [],
			},
		});
		render(<LibraryPage />);
		await act(async () => {
			fireEvent.click(await screen.findByRole('button', { name: /RD\s+Add/ }));
		});
		expect(operations).toEqual(['upload:start']);
		await act(async () => {
			finishUpload();
			await uploading;
		});
		await waitFor(() => {
			expect(operations).toEqual(['upload:start', 'upload:end', 'magnet:start']);
		});
	});
});
