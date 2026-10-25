/* oxlint-disable nextjs/no-img-element */
import { render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { axiosGetMock, toastMock, AxiosErrorMock, posterMock } = vi.hoisted(() => {
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
	usePremiumizeCredential: () => null,
	useOffcloudApiKey: () => null,
	useDebridLinkCredential: () => null,
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
	hideRdBlockedTorrentsDefault: (fallback: boolean) => fallback,
}));

vi.mock('@/utils/token', () => ({
	__esModule: true,
	generateTokenAndHash: () => Promise.resolve(['token', 'hash']),
}));

vi.mock('@/utils/instantChecks', () => ({
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

const routerMock = vi.hoisted(() => ({
	query: { imdbid: 'tt1234567', seasonNum: '1' },
	push: vi.fn(),
	replace: vi.fn(),
	prefetch: vi.fn(),
}));

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => routerMock,
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

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
	Toaster: () => null,
}));

import ShowSeasonPage from '@/pages/show/[imdbid]/[seasonNum]';

describe('TV show page header', () => {
	beforeEach(() => {
		axiosGetMock.mockReset();
		posterMock.mockClear();
		routerMock.replace.mockClear();
	});

	// tt21958588 is an episode on IMDb that Trakt files as a show with ten
	// seasons; the API names its series and the page moves there.
	it('moves an episode id to the series it belongs to', async () => {
		axiosGetMock.mockImplementation((url: string) => {
			if (url.startsWith('/api/info/show')) {
				return Promise.resolve({
					status: 200,
					data: {
						title: 'Cake Week',
						season_count: 10,
						season_names: [],
						season_episode_counts: {},
						series_imdbid: 'tt1877368',
					},
				});
			}
			return Promise.resolve({ status: 200, headers: {}, data: { results: [] } });
		});

		render(<ShowSeasonPage />);

		await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/show/tt1877368/1'));
		expect(screen.queryByRole('heading', { name: /Cake Week/ })).not.toBeInTheDocument();
		expect(
			axiosGetMock.mock.calls.some(([url]) => String(url).startsWith('/api/torrents/tv'))
		).toBe(false);
	});

	// Fizzy #221. tt1046922 is a TV film; production's show page for it listed
	// another programme's episodes from `tv:tt1046922:1`. The API now says it is
	// a movie (see /api/info/show's test on the captured answers).
	it("moves a film's id to the movie page without loading the show's releases", async () => {
		axiosGetMock.mockImplementation((url: string) => {
			if (url.startsWith('/api/info/show')) {
				return Promise.resolve({
					status: 200,
					data: {
						title: 'Filth: The Mary Whitehouse Story',
						season_count: 1,
						season_names: ['Season 1'],
						season_episode_counts: {},
						is_movie: true,
					},
				});
			}
			return Promise.resolve({ status: 200, headers: {}, data: { results: [] } });
		});

		render(<ShowSeasonPage />);

		await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/movie/tt1234567'));
		expect(
			axiosGetMock.mock.calls.some(([url]) => String(url).startsWith('/api/torrents/tv'))
		).toBe(false);
	});

	it('delegates header rendering to MediaHeader with show context', async () => {
		axiosGetMock.mockImplementation((url: string) => {
			if (url.startsWith('/api/info/show')) {
				return Promise.resolve({
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
				});
			}

			if (url.startsWith('/api/torrents/tv')) {
				return Promise.resolve({ status: 200, headers: {}, data: { results: [] } });
			}

			return Promise.resolve({ status: 200, data: {} });
		});

		render(<ShowSeasonPage />);

		await waitFor(() =>
			expect(
				screen.getByRole('heading', { name: 'Example Show - Season 1' })
			).toBeInTheDocument()
		);

		expect(screen.getByRole('link', { name: /Go Home/i })).toHaveAttribute('href', '/');
		expect(screen.getByRole('link', { name: /IMDB Score:/i })).toHaveAttribute(
			'href',
			'https://www.imdb.com/title/tt1234567/'
		);

		const seasonLinks = within(screen.getByTestId('media-header-season-nav'));
		expect(seasonLinks.getByRole('link', { name: /Season Two/ })).toHaveAttribute(
			'href',
			'/show/tt1234567/2'
		);
		expect(seasonLinks.getByRole('link', { name: /Season One/ })).toHaveAttribute(
			'href',
			'/show/tt1234567/1'
		);

		const actionRegion = within(screen.getByTestId('media-header-actions'));
		expect(actionRegion.getByRole('button', { name: /Stremio/i })).toBeInTheDocument();

		expect(posterMock).toHaveBeenCalled();
		const posterCall = posterMock.mock.calls[posterMock.mock.calls.length - 1]?.[0];
		expect(posterCall).toMatchObject({
			imdbId: 'tt1234567',
			title: 'Example Show',
		});
		expect(screen.getByTestId('poster-fallback')).toHaveTextContent('Example Show');
		expect(screen.getByTestId('related-media')).toBeInTheDocument();
	});

	describe('compact header', () => {
		const mountShow = async (info: Record<string, unknown>) => {
			axiosGetMock.mockImplementation((url: string) => {
				if (url.startsWith('/api/info/show')) {
					return Promise.resolve({
						status: 200,
						data: {
							title: 'Example Show',
							description: 'Example description',
							poster: '',
							backdrop: '',
							imdb_score: 7.2,
							season_episode_counts: { 1: 8 },
							...info,
						},
					});
				}
				return Promise.resolve({ status: 200, headers: {}, data: { results: [] } });
			});
			render(<ShowSeasonPage />);
			await screen.findByRole('heading', { name: /Example Show - Season 1/ });
		};

		it('names generic seasons S1.. and keeps a real name', async () => {
			await mountShow({
				season_count: 3,
				season_names: ['Season 1', 'The Middle Years', 'Season 3'],
				has_specials: true,
				season_episode_counts: { 1: 8, 2: 8, 3: 8 },
			});
			const nav = within(screen.getByTestId('media-header-season-nav'));
			expect(nav.getAllByRole('link').map((a) => a.textContent)).toEqual([
				'Specials',
				'S3',
				'The Middle Years',
				'S1',
			]);
		});

		it('drops the season row and the season Want for an ended one-season show', async () => {
			await mountShow({ season_count: 1, season_names: ['Season 1'], status: 'Ended' });
			expect(screen.queryByTestId('media-header-season-nav')).not.toBeInTheDocument();
			expect(screen.getByTestId('media-description')).toHaveTextContent(
				/IMDB Score: 7.2 · Ended$/
			);
			expect(screen.queryByText(/Series Ended/)).not.toBeInTheDocument();
			// A non-sponsor's Want buttons all lead to /wanted: one of them.
			const actions = within(screen.getByTestId('media-header-actions'));
			expect(actions.getAllByRole('link', { name: /Want/ })).toHaveLength(1);
		});

		it('folds an airing show with nothing scheduled into the description', async () => {
			await mountShow({
				season_count: 1,
				season_names: ['Season 1'],
				status: 'Returning Series',
				last_episode_to_air: {
					first_aired: '2026-10-15T02:00:00Z',
					season_number: 1,
					episode_number: 8,
					name: 'Eight',
				},
			});
			expect(screen.getByTestId('media-description')).toHaveTextContent(
				/· Airing \(last S01E08\)$/
			);
			expect(screen.queryByText(/Last aired/)).not.toBeInTheDocument();
		});

		it('keeps only the Next chip for an airing show with an episode scheduled', async () => {
			await mountShow({
				season_count: 1,
				season_names: ['Season 1'],
				status: 'Returning Series',
				next_episode_to_air: {
					first_aired: '2026-10-29T02:00:00Z',
					season_number: 1,
					episode_number: 9,
					name: 'Nine',
				},
			});
			expect(screen.getByText(/Next: S01E09/)).toBeInTheDocument();
			expect(screen.queryByText(/^Airing$/)).not.toBeInTheDocument();
			expect(screen.getByTestId('media-description')).not.toHaveTextContent(/Airing/);
		});

		it('swaps the filter row for a pointer to Want and Usenet when nothing is found', async () => {
			await mountShow({ season_count: 1, season_names: ['Season 1'] });
			const empty = await screen.findByTestId('no-torrents');
			expect(within(empty).getByRole('link', { name: 'Usenet tab' })).toHaveAttribute(
				'href',
				'/show/tt1234567/1/usenet'
			);
			expect(document.getElementById('query')).toBeNull();
		});
	});
});
