/* eslint-disable @next/next/no-img-element */
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	axiosGetMock,
	toastMock,
	AxiosErrorMock,
	posterMock,
	checkDatabaseAvailabilityRdMock,
	checkDatabaseAvailabilityAdMock,
	checkDatabaseAvailabilityTbMock,
} = vi.hoisted(() => {
	class AxiosError extends Error {
		response?: { status?: number };
	}
	const toast = Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
	});
	return {
		axiosGetMock: vi.fn(),
		toastMock: toast,
		AxiosErrorMock: AxiosError,
		posterMock: vi.fn(({ title }: { title: string }) => (
			<div data-testid="poster-fallback">{title}</div>
		)),
		checkDatabaseAvailabilityRdMock: vi.fn().mockResolvedValue(0),
		checkDatabaseAvailabilityAdMock: vi.fn().mockResolvedValue(0),
		checkDatabaseAvailabilityTbMock: vi.fn().mockResolvedValue(0),
	};
});

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: posterMock,
}));

vi.mock('@/components/RelatedMedia', () => ({
	__esModule: true,
	default: () => <div data-testid="related-media" />,
}));

vi.mock('@/components/SearchTokens', () => ({
	__esModule: true,
	default: ({ title }: { title: string }) => (
		<div data-testid="search-tokens">tokens:{title}</div>
	),
}));

vi.mock('@/components/TvSearchResults', () => ({
	__esModule: true,
	default: () => <div data-testid="tv-search-results" />,
}));

vi.mock('@/components/showInfo', () => ({
	__esModule: true,
	showInfoForRD: vi.fn(),
}));

vi.mock('@/contexts/LibraryCacheContext', () => ({
	useLibraryCache: () => ({
		libraryItems: [],
		isLoading: false,
		isFetching: false,
		lastFetchTime: null,
		error: null,
		refreshLibrary: vi.fn(),
		setLibraryItems: vi.fn(),
		addTorrent: vi.fn(),
		removeTorrent: vi.fn(),
		updateTorrent: vi.fn(),
	}),
}));

vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: () => ['rd-token'],
	useAllDebridApiKey: () => 'ad-token',
	useTorBoxAccessToken: () => 'tb-token',
}));

vi.mock('@/hooks/useExternalSources', () => ({
	useExternalSources: () => ({
		fetchEpisodeFromExternalSource: vi.fn().mockResolvedValue([]),
		getEnabledSources: () => [],
	}),
}));

vi.mock('@/hooks/useAvailabilityCheck', () => ({
	useAvailabilityCheck: () => ({
		isAnyChecking: false,
		isHashServiceChecking: () => false,
		checkServiceAvailability: vi.fn(),
		checkServiceAvailabilityBulk: vi.fn(),
	}),
}));

vi.mock('@/hooks/useMassReport', () => ({
	useMassReport: () => ({ handleMassReport: vi.fn() }),
}));

vi.mock('@/hooks/useTorrentManagement', () => ({
	useTorrentManagement: () => ({
		hashAndProgress: {},
		fetchHashAndProgress: vi.fn().mockResolvedValue(undefined),
		addRd: vi.fn(),
		addAd: vi.fn(),
		addTb: vi.fn(),
		deleteRd: vi.fn(),
		deleteAd: vi.fn(),
		deleteTb: vi.fn(),
	}),
}));

vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: class {
		async initializeDB() {
			return Promise.resolve();
		}
	},
}));

vi.mock('@/utils/browserStorage', () => ({
	__esModule: true,
	getLocalStorageBoolean: () => false,
	getLocalStorageItemOrDefault: (_key: string, defaultValue: any) => defaultValue,
}));

vi.mock('@/utils/token', () => ({
	__esModule: true,
	generateTokenAndHash: () => Promise.resolve(['token', 'hash']),
}));

vi.mock('@/utils/instantChecks', () => ({
	checkDatabaseAvailabilityRd: checkDatabaseAvailabilityRdMock,
	checkDatabaseAvailabilityAd: checkDatabaseAvailabilityAdMock,
	checkDatabaseAvailabilityTb: checkDatabaseAvailabilityTbMock,
	instantCheckInRd: vi.fn().mockResolvedValue(0),
	instantCheckInTb: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/utils/results', () => ({
	sortByMedian: (results: any[]) => results,
}));

vi.mock('@/utils/quickSearch', () => ({
	quickSearch: (_query: string, results: any[]) => results,
}));

vi.mock('@/utils/selectable', () => ({
	isVideo: () => true,
}));

vi.mock('@/utils/trackerStats', () => ({
	getMultipleTrackerStats: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/utils/castApiClient', () => ({
	handleCastTvShow: vi.fn(),
}));

vi.mock('@/utils/copyMagnet', () => ({
	handleCopyOrDownloadMagnet: vi.fn(),
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
}));

vi.mock('axios', () => ({
	__esModule: true,
	default: {
		get: axiosGetMock,
		create: () => ({
			get: axiosGetMock,
			post: vi.fn(),
			delete: vi.fn(),
			interceptors: {
				request: { use: vi.fn() },
				response: { use: vi.fn() },
			},
		}),
	},
	get: axiosGetMock,
	AxiosError: AxiosErrorMock,
}));

vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ alt, ...props }: any) => <img alt={alt} {...props} />,
}));

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => ({
		query: { imdbid: 'tt1234567', seasonNum: '1' },
		push: vi.fn(),
		prefetch: vi.fn(),
	}),
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children, ...props }: any) => (
		<a href={typeof href === 'string' ? href : String(href)} {...props}>
			{children}
		</a>
	),
}));

vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: {} }),
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
	Toaster: () => null,
}));

import ShowSeasonPage from '@/pages/show/[imdbid]/[seasonNum]';

const showInfoResponse = {
	status: 200,
	data: {
		title: 'Example Show',
		description: 'Example description',
		poster: '',
		backdrop: 'https://example.com/backdrop.jpg',
		season_count: 2,
		season_names: ['Season One', 'Season Two'],
		imdb_score: 7.2,
		season_episode_counts: { 1: 10, 2: 8 },
	},
};

describe('Show page availability checks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('fires availability check after torrent results load', async () => {
		axiosGetMock.mockImplementation((url: string) => {
			if (url.startsWith('/api/info/show')) {
				return Promise.resolve(showInfoResponse);
			}

			if (url.startsWith('/api/torrents/tv')) {
				return Promise.resolve({
					status: 200,
					headers: {},
					data: {
						results: [
							{
								hash: 'a'.repeat(40),
								title: 'Test Show S01E01',
								fileSize: 1024,
								files: [],
							},
							{
								hash: 'b'.repeat(40),
								title: 'Test Show S01E02',
								fileSize: 2048,
								files: [],
							},
						],
					},
				});
			}

			return Promise.resolve({ status: 200, data: {} });
		});

		render(<ShowSeasonPage />);

		await waitFor(() => {
			expect(axiosGetMock).toHaveBeenCalledWith(expect.stringContaining('/api/torrents/tv'));
		});

		await waitFor(() => {
			expect(checkDatabaseAvailabilityRdMock).toHaveBeenCalledWith(
				'token',
				'hash',
				'tt1234567',
				expect.arrayContaining(['a'.repeat(40), 'b'.repeat(40)]),
				expect.any(Function),
				expect.any(Function)
			);
		});
	});

	it('does not fire availability check when no torrents returned', async () => {
		axiosGetMock.mockImplementation((url: string) => {
			if (url.startsWith('/api/info/show')) {
				return Promise.resolve(showInfoResponse);
			}

			if (url.startsWith('/api/torrents/tv')) {
				return Promise.resolve({
					status: 200,
					headers: {},
					data: { results: [] },
				});
			}

			return Promise.resolve({ status: 200, data: {} });
		});

		render(<ShowSeasonPage />);

		await waitFor(() => {
			expect(axiosGetMock).toHaveBeenCalledWith(expect.stringContaining('/api/torrents/tv'));
		});

		// Give some time for any async callbacks to fire
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(checkDatabaseAvailabilityRdMock).not.toHaveBeenCalled();
	});
});
