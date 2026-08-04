/* eslint-disable @next/next/no-img-element */
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosGetMock, toastMock, routerQuery, torrentUrls, torrentManagement } = vi.hoisted(() => {
	const toast = Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		promise: vi.fn(),
	});
	return {
		axiosGetMock: vi.fn(),
		toastMock: toast,
		routerQuery: { imdbid: 'tt1111111' } as { imdbid: string },
		torrentUrls: [] as string[],
		// Stable identities - the real hook memoizes these, and fresh ones per
		// render would retrigger effects that key off them
		torrentManagement: {
			hashAndProgress: {},
			fetchHashAndProgress: vi.fn().mockResolvedValue(undefined),
			addRd: vi.fn(),
			addAd: vi.fn(),
			addTb: vi.fn(),
			deleteRd: vi.fn(),
			deleteAd: vi.fn(),
			deleteTb: vi.fn(),
		},
	};
});

vi.mock('@/components/MediaHeader', () => ({
	__esModule: true,
	default: ({ title }: { title: string }) => <div data-testid="media-header">{title}</div>,
}));

vi.mock('@/components/MovieSearchResults', () => ({
	__esModule: true,
	default: () => <div data-testid="movie-search-results" />,
}));

vi.mock('@/components/SearchControls', () => ({
	__esModule: true,
	default: ({ query }: { query: string }) => <div data-testid="query-value">{query}</div>,
}));

vi.mock('@/components/showInfo', () => ({
	__esModule: true,
	showInfoForRD: vi.fn(),
	showInfoForAD: vi.fn(),
	showInfoForTB: vi.fn(),
}));

vi.mock('@/contexts/LibraryCacheContext', () => ({
	useLibraryCache: () => ({ isFetching: false }),
}));

vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: () => ['rd-token'],
	useAllDebridApiKey: () => null,
	useTorBoxAccessToken: () => null,
}));

vi.mock('@/hooks/useExternalSources', () => ({
	useExternalSources: () => ({
		fetchMovieFromExternalSource: vi.fn().mockResolvedValue([]),
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
	useTorrentManagement: () => torrentManagement,
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
	getLocalStorageBoolean: (_key: string, defaultValue: boolean) => defaultValue,
	getLocalStorageItemOrDefault: (key: string, defaultValue: any) =>
		key === 'settings:movieYearFilter' ? '1' : defaultValue,
}));

vi.mock('@/utils/token', () => ({
	__esModule: true,
	generateTokenAndHash: () => Promise.resolve(['token', 'hash']),
}));

vi.mock('@/utils/instantChecks', () => ({
	checkDatabaseAvailabilityRd: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityAd: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityTb: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/utils/results', () => ({
	sortByBiggest: (results: any[]) => results,
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

vi.mock('@/utils/castApiClient', () => ({ handleCastMovie: vi.fn() }));
vi.mock('@/utils/allDebridCastApiClient', () => ({ handleCastMovieAllDebrid: vi.fn() }));
vi.mock('@/utils/torboxCastApiClient', () => ({ handleCastMovieTorBox: vi.fn() }));
vi.mock('@/utils/copyMagnet', () => ({ handleCopyOrDownloadMagnet: vi.fn() }));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
}));

vi.mock('@/utils/axiosWithRetry', () => ({
	__esModule: true,
	default: { get: axiosGetMock },
}));

vi.mock('next/config', () => ({
	__esModule: true,
	default: () => ({ publicRuntimeConfig: {} }),
}));

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => ({ query: routerQuery, push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
	Toaster: () => null,
}));

import MovieSearchPage from '@/pages/movie/[imdbid]/index';

const movieInfo: Record<string, { title: string; year: string }> = {
	tt1111111: { title: 'First Movie', year: '2019' },
	tt2222222: { title: 'Second Movie', year: '1998' },
};

describe('Movie search page across client-side navigation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routerQuery.imdbid = 'tt1111111';
		torrentUrls.length = 0;

		axiosGetMock.mockImplementation((url: string) => {
			const infoMatch = url.match(/\/api\/info\/movie\?imdbid=(tt\d+)/);
			if (infoMatch) {
				const info = movieInfo[infoMatch[1]];
				return Promise.resolve({
					status: 200,
					data: {
						title: info.title,
						description: '',
						poster: '',
						backdrop: '',
						year: info.year,
						imdb_score: 7,
						trailer: '',
					},
				});
			}

			if (url.includes('/api/torrents/movie')) {
				torrentUrls.push(url);
				return Promise.resolve({ status: 200, headers: {}, data: { results: [] } });
			}

			return Promise.resolve({ status: 200, headers: {}, data: {} });
		});
	});

	it('replaces the year prefilter instead of stacking it on the previous movie', async () => {
		const { rerender } = render(<MovieSearchPage />);

		await waitFor(() =>
			expect(screen.getByTestId('query-value')).toHaveTextContent('2018|2019|2020')
		);

		routerQuery.imdbid = 'tt2222222';
		rerender(<MovieSearchPage />);

		await waitFor(() => expect(screen.getByTestId('media-header')).toHaveTextContent('Second'));
		await waitFor(() =>
			expect(screen.getByTestId('query-value')).toHaveTextContent('1997|1998|1999')
		);

		// The first movie's years must be gone - stacked regexes AND together and
		// filter every result away
		expect(screen.getByTestId('query-value')).not.toHaveTextContent('2019');
	});

	it('searches with the movie its own metadata belongs to', async () => {
		render(<MovieSearchPage />);

		await waitFor(() => expect(torrentUrls).toHaveLength(1));
		expect(torrentUrls[0]).toContain('imdbId=tt1111111');
		expect(torrentUrls[0]).toContain('page=0');
	});
});
