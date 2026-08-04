/* eslint-disable @next/next/no-img-element */
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosGetMock, toastMock, AxiosErrorMock, posterMock, fetchEpisodeMock } = vi.hoisted(() => {
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
		fetchEpisodeMock: vi.fn(),
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
	useAllDebridApiKey: () => null,
	useTorBoxAccessToken: () => null,
}));

vi.mock('@/hooks/useExternalSources', () => ({
	useExternalSources: () => ({
		fetchEpisodeFromExternalSource: fetchEpisodeMock,
		getEnabledSources: () => ['torrentio'],
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

vi.mock('@/utils/delay', () => ({
	delay: () => Promise.resolve(),
}));

vi.mock('@/utils/instantChecks', () => ({
	checkDatabaseAvailabilityRd: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityAd: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityTb: vi.fn().mockResolvedValue(0),
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

const externalResult = (letter: string, episode: number) => ({
	hash: letter.repeat(40),
	title: `Example Show S01E0${episode}`,
	fileSize: 1024,
	files: [],
	rdAvailable: false,
	adAvailable: false,
	tbAvailable: false,
	noVideos: false,
	videoCount: 1,
	medianFileSize: 1024,
	biggestFileSize: 1024,
	imdbId: 'tt1234567',
});

describe('Show page source completion', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		axiosGetMock.mockImplementation((url: string) => {
			if (url.startsWith('/api/info/show')) {
				return Promise.resolve({
					status: 200,
					data: {
						title: 'Example Show',
						description: 'Example description',
						poster: '',
						backdrop: '',
						season_count: 1,
						season_names: ['Season One'],
						imdb_score: 7.2,
						season_episode_counts: { 1: 3 },
					},
				});
			}

			if (url.startsWith('/api/torrents/tv')) {
				return Promise.resolve({
					status: 200,
					headers: {},
					data: {
						results: [
							{ hash: 'a'.repeat(40), title: 'Example Show S01', fileSize: 4096 },
							{ hash: 'b'.repeat(40), title: 'Example Show S01E01', fileSize: 2048 },
						],
					},
				});
			}

			return Promise.resolve({ status: 200, data: {} });
		});
	});

	it('waits for every external episode batch before reporting the total', async () => {
		// One external source that streams results across several episode batches -
		// each batch used to count as a finished source and ended the search early
		fetchEpisodeMock.mockImplementation((_imdbId: string, _season: number, episode: number) => {
			if (episode === 1) return Promise.resolve([externalResult('c', 1)]);
			if (episode === 2) return Promise.resolve([externalResult('d', 2)]);
			if (episode === 3) return Promise.resolve([externalResult('e', 3)]);
			return Promise.resolve([]);
		});

		render(<ShowSeasonPage />);

		await waitFor(() =>
			expect(toastMock).toHaveBeenCalledWith('5 unique torrents found', expect.anything())
		);

		// The count is reported once, after the last source finishes
		const searchToasts = toastMock.mock.calls.filter((call) =>
			String(call[0]).includes('unique torrents found')
		);
		expect(searchToasts).toHaveLength(1);
	});

	it('names every source it is waiting on in the loading indicator', async () => {
		// hold DMM open so the indicator stays mounted for the assertions
		let releaseDmm: (value: unknown) => void = () => {};
		const dmmPending = new Promise((resolve) => {
			releaseDmm = resolve;
		});
		axiosGetMock.mockImplementation((url: string) => {
			if (url.startsWith('/api/info/show')) {
				return Promise.resolve({
					status: 200,
					data: {
						title: 'Example Show',
						description: '',
						poster: '',
						backdrop: '',
						season_count: 1,
						season_names: ['Season One'],
						imdb_score: 7.2,
						season_episode_counts: { 1: 3 },
					},
				});
			}
			if (url.startsWith('/api/torrents/tv')) {
				return dmmPending;
			}
			return Promise.resolve({ status: 200, data: {} });
		});

		fetchEpisodeMock.mockImplementation((_imdbId: string, _season: number, episode: number) =>
			Promise.resolve(episode === 1 ? [externalResult('c', 1)] : [])
		);

		render(<ShowSeasonPage />);

		const indicator = await screen.findByTestId('search-source-progress');
		expect(indicator).toHaveTextContent('DMM');
		expect(indicator).toHaveTextContent('Torrentio');
		expect(screen.getByTestId('search-source-DMM')).toBeInTheDocument();
		expect(screen.getByTestId('search-source-torrentio')).toBeInTheDocument();

		// the external source finishes first and reports what it contributed
		await waitFor(() =>
			expect(screen.getByTestId('search-source-torrentio')).toHaveAttribute(
				'title',
				'Torrentio: 1 unique result'
			)
		);
		// DMM is still outstanding, so the indicator is still up
		expect(screen.getByTestId('search-source-progress')).toHaveTextContent('Searching 1/2');

		releaseDmm({ status: 200, headers: {}, data: { results: [] } });

		// once every source is done the indicator goes away
		await waitFor(() =>
			expect(screen.queryByTestId('search-source-progress')).not.toBeInTheDocument()
		);
	});
});
