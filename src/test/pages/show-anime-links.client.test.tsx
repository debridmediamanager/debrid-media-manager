/* eslint-disable @next/next/no-img-element */
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
	usePremiumizeCredential: () => null,
	useOffcloudApiKey: () => null,
	useDebridLinkCredential: () => null,
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
	hideRdBlockedTorrentsDefault: (fallback: boolean) => fallback,
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
	sortByMean: (results: any[]) => results,
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
		query: { imdbid: 'tt10885406', seasonNum: '4' },
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

// `/api/anime/by-imdb` runs for real over production's anime data.
vi.mock('@/services/repository', async () => ({
	repository: {
		getAnimeEntryRows: (await import('@/test/utils/animeFixtures')).fixtureAnimeEntryRows,
	},
}));
vi.mock('@/services/anime/animeFranchise', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/anime/animeFranchise')>();
	const f = await import('@/test/utils/animeFixtures');
	return {
		...actual,
		getFranchiseIndex: async () => actual.buildFranchiseIndex(f.fixtureFribbEntries()),
	};
});
vi.mock('@/services/anime/kitsuLabels', async () => ({
	getKitsuLabel: (await import('@/test/utils/animeFixtures')).fixtureKitsuLabel,
}));

vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: {} }),
}));

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
	Toaster: () => null,
}));

import byImdbRoute from '@/pages/api/anime/by-imdb';
import ShowSeasonPage from '@/pages/show/[imdbid]/[seasonNum]';
import { callAnimeRoute } from '@/test/utils/animeFixtures';

// Bookworm's show page, tt10885406. IMDb files every season under that id and
// AniDB has five entries, so the show page's season numbering is a mapping
// that can fail: its season 4 counted 0 episodes while `tv:tt10885406:4` held
// 509 releases. Each AniDB entry is one season and needs no mapping.
describe('Show page links to its AniDB entries', () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
		axiosGetMock.mockImplementation((url: string) => {
			if (url.startsWith('/api/info/show')) {
				return Promise.resolve({
					status: 200,
					data: {
						title: 'Ascendance of a Bookworm',
						description: '',
						poster: '',
						backdrop: '',
						season_count: 4,
						season_names: [],
						imdb_score: 7.8,
						season_episode_counts: { 1: 14, 2: 12, 3: 10, 4: 0 },
					},
				});
			}
			return Promise.resolve({ status: 200, headers: {}, data: { results: [] } });
		});
		global.fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (!url.startsWith('/api/anime/by-imdb')) throw new Error(`unexpected ${url}`);
			const { status, data } = await callAnimeRoute(byImdbRoute, url);
			return { ok: status === 200, status, json: async () => data } as Response;
		}) as typeof fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('lists every AniDB entry, labelled by title and type', async () => {
		render(<ShowSeasonPage />);

		const links = await screen.findByTestId('anime-entry-links');
		const anchors = within(links).getAllByRole('link');
		expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
			'/anime/14727',
			'/anime/15293',
			'/anime/15300',
			'/anime/15634',
			'/anime/18302',
		]);
		expect(anchors[2]).toHaveTextContent(/Eustachius.*OVA$/);
		expect(anchors[4]).toHaveTextContent(/Ryoushu no Youjo\s*TV$/);
		expect(anchors[4]).toHaveAttribute(
			'title',
			expect.stringMatching(/Ryoushu no Youjo \(TV\)$/)
		);
		expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
			'/api/anime/by-imdb?imdbids=tt10885406'
		);
	});
});
