/* oxlint-disable nextjs/no-img-element */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const {
	axiosGetMock,
	toastMock,
	routerQuery,
	routerPath,
	torrentUrls,
	torrentManagement,
	authKeys,
	torrentResults,
	searchResultsProps,
	sortByBiggestMock,
} = vi.hoisted(() => {
	const toast = Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		promise: vi.fn(),
	});
	return {
		axiosGetMock: vi.fn(),
		toastMock: toast,
		routerQuery: { imdbid: 'tt1111111' } as { imdbid: string },
		routerPath: { current: '/movie/[imdbid]' },
		torrentUrls: [] as string[],
		// Mutable so a test can hand the page a different combination of keys
		authKeys: { rd: 'rd-token', ad: null, tb: null, pm: null, oc: null, dl: null } as {
			rd: string | null;
			ad: string | null;
			tb: string | null;
			pm: string | null;
			oc: string | null;
			dl: string | null;
		},
		torrentResults: [] as any[],
		searchResultsProps: { current: null as any },
		// The page's own sort, swapped in where the order on screen is the point
		sortByBiggestMock: vi.fn((results: any[]) => results),
		// Stable identities - the real hook memoizes these, and fresh ones per
		// render would retrigger effects that key off them
		torrentManagement: {
			hashAndProgress: {},
			fetchHashAndProgress: vi.fn().mockResolvedValue(undefined),
			addRd: vi.fn(),
			addAd: vi.fn(),
			addTb: vi.fn(),
			addPm: vi.fn(),
			addOc: vi.fn(),
			addDl: vi.fn(),
			deleteRd: vi.fn(),
			deleteAd: vi.fn(),
			deleteTb: vi.fn(),
			deletePm: vi.fn(),
			deleteOc: vi.fn(),
			deleteDl: vi.fn(),
		},
	};
});

vi.mock('@/components/UsenetResults', () => ({
	__esModule: true,
	default: ({ imdbId }: { imdbId: string }) => <div data-testid="usenet-results">{imdbId}</div>,
}));

vi.mock('@/components/MediaHeader', () => ({
	__esModule: true,
	default: ({ title, actionButtons }: { title: string; actionButtons?: ReactNode }) => (
		<>
			<div data-testid="media-header">{title}</div>
			{actionButtons}
		</>
	),
}));

vi.mock('@/components/MovieSearchResults', () => ({
	__esModule: true,
	default: (props: any) => {
		searchResultsProps.current = props;
		return <div data-testid="movie-search-results" />;
	},
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
	useRealDebridAccessToken: () => [authKeys.rd],
	useAllDebridApiKey: () => authKeys.ad,
	useTorBoxAccessToken: () => authKeys.tb,
	usePremiumizeCredential: () => authKeys.pm,
	useOffcloudApiKey: () => authKeys.oc,
	useDebridLinkCredential: () => authKeys.dl,
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
	hideRdBlockedTorrentsDefault: (fallback: boolean) => fallback,
}));

const { generateTokenAndHashMock } = vi.hoisted(() => ({
	generateTokenAndHashMock: vi.fn(),
}));

vi.mock('@/utils/token', () => ({
	__esModule: true,
	generateTokenAndHash: (...args: any[]) => generateTokenAndHashMock(...args),
}));

vi.mock('@/utils/instantChecks', () => ({
	checkDatabaseAvailabilityRd: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityAd: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityTb: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/utils/results', () => ({
	sortByBiggest: (results: any[]) => sortByBiggestMock(results),
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
vi.mock('@/utils/premiumizeCastApiClient', () => ({ handleCastMoviePremiumize: vi.fn() }));
vi.mock('@/utils/offcloudCastApiClient', () => ({ handleCastMovieOffcloud: vi.fn() }));
vi.mock('@/utils/debridLinkCastApiClient', () => ({ handleCastMovieDebridLink: vi.fn() }));
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
	useRouter: () => ({
		query: routerQuery,
		pathname: routerPath.current,
		push: vi.fn(),
		prefetch: vi.fn(),
	}),
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

import { showInfoForAD, showInfoForRD, showInfoForTB } from '@/components/showInfo';
import MovieSearchPage from '@/pages/movie/[imdbid]/index';
import castFailures from '@/test/fixtures/castMovieFailures/production-2026-10-14.json';
import recorded from '@/test/fixtures/scraped/cyrillic-led-pages-2026-10-07.json';
import { handleCastMovieAllDebrid } from '@/utils/allDebridCastApiClient';
import { handleCastMovie } from '@/utils/castApiClient';
import { handleCastMovieDebridLink } from '@/utils/debridLinkCastApiClient';
import { checkDatabaseAvailabilityRd } from '@/utils/instantChecks';
import { handleCastMovieOffcloud } from '@/utils/offcloudCastApiClient';
import { handleCastMoviePremiumize } from '@/utils/premiumizeCastApiClient';
import { handleCastMovieTorBox } from '@/utils/torboxCastApiClient';

const movieInfo: Record<string, { title: string; year: string }> = {
	tt1111111: { title: 'First Movie', year: '2019' },
	tt2222222: { title: 'Second Movie', year: '1998' },
	tt0446009: { title: 'The Vexxer', year: '2007' },
};

describe('Movie search page across client-side navigation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		generateTokenAndHashMock.mockReset();
		generateTokenAndHashMock.mockResolvedValue(['token', 'hash']);
		routerQuery.imdbid = 'tt1111111';
		torrentUrls.length = 0;
		torrentResults.length = 0;
		searchResultsProps.current = null;
		authKeys.rd = 'rd-token';
		authKeys.ad = null;
		authKeys.tb = null;
		authKeys.pm = null;
		authKeys.oc = null;
		authKeys.dl = null;

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
				return Promise.resolve({
					status: 200,
					headers: {},
					data: { results: torrentResults.slice() },
				});
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

	// The Usenet tab is its own route: it shows the Usenet search and never the torrents.
	it('shows the Usenet search on /usenet without searching torrents', async () => {
		routerPath.current = '/movie/[imdbid]/usenet';
		try {
			render(<MovieSearchPage />);

			expect(await screen.findByTestId('usenet-results')).toHaveTextContent('tt1111111');
			await waitFor(() => expect(screen.getByTestId('media-header')).toBeInTheDocument());
			expect(torrentUrls).toHaveLength(0);
			expect(screen.getByRole('link', { name: /Usenet/ })).toHaveAttribute(
				'aria-current',
				'page'
			);
		} finally {
			routerPath.current = '/movie/[imdbid]';
		}
	});

	it('keeps the Usenet search off the torrent tab', async () => {
		render(<MovieSearchPage />);

		await waitFor(() => expect(torrentUrls).toHaveLength(1));
		expect(screen.queryByTestId('usenet-results')).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Usenet/ })).toHaveAttribute(
			'href',
			'/movie/tt1111111/usenet'
		);
	});

	it('searches with the movie its own metadata belongs to', async () => {
		render(<MovieSearchPage />);

		await waitFor(() => expect(torrentUrls).toHaveLength(1));
		expect(torrentUrls[0]).toContain('imdbId=tt1111111');
		expect(torrentUrls[0]).toContain('page=0');
	});

	describe('info modal service selection', () => {
		const result = (availability: Partial<Record<'rd' | 'ad' | 'tb', boolean>>) => ({
			title: 'First Movie 2019 1080p',
			fileSize: 2048,
			hash: 'a'.repeat(40),
			noVideos: false,
			rdAvailable: Boolean(availability.rd),
			adAvailable: Boolean(availability.ad),
			tbAvailable: Boolean(availability.tb),
			files: [{ fileId: 1, filename: 'First.Movie.2019.1080p.mkv', filesize: 2048 }],
		});

		const openInfoFor = async (r: any) => {
			render(<MovieSearchPage />);
			await waitFor(() => expect(searchResultsProps.current).not.toBeNull());
			await waitFor(() =>
				expect(searchResultsProps.current.handleShowInfo).toBeInstanceOf(Function)
			);
			searchResultsProps.current.handleShowInfo(r);
		};

		beforeEach(() => {
			torrentResults.push(result({ rd: true }));
		});

		// The Watch rows inside the modal target whichever service the modal was
		// opened for, so opening the wrong one hands them a service that does not
		// have the torrent cached.
		it('opens the TorBox modal when only TorBox has it cached', async () => {
			authKeys.rd = 'rd-token';
			authKeys.tb = 'tb-token';

			await openInfoFor(result({ tb: true }));

			expect(showInfoForTB).toHaveBeenCalledTimes(1);
			expect(showInfoForRD).not.toHaveBeenCalled();
		});

		it('opens the AllDebrid modal when only AllDebrid has it cached', async () => {
			authKeys.rd = 'rd-token';
			authKeys.ad = 'ad-token';

			await openInfoFor(result({ ad: true }));

			expect(showInfoForAD).toHaveBeenCalledTimes(1);
			expect(showInfoForRD).not.toHaveBeenCalled();
		});

		it('prefers Real-Debrid when more than one service has it cached', async () => {
			authKeys.rd = 'rd-token';
			authKeys.ad = 'ad-token';
			authKeys.tb = 'tb-token';

			await openInfoFor(result({ rd: true, ad: true, tb: true }));

			expect(showInfoForRD).toHaveBeenCalledTimes(1);
		});

		// Nothing cached anywhere is still worth opening - the modal is the file
		// list and the add-to-library surface, not only a watch surface.
		it('falls back to key order when no service has it cached', async () => {
			authKeys.rd = 'rd-token';
			authKeys.tb = 'tb-token';

			await openInfoFor(result({}));

			expect(showInfoForRD).toHaveBeenCalledTimes(1);
			expect(showInfoForTB).not.toHaveBeenCalled();
		});

		it('skips a cached service the user has no key for', async () => {
			authKeys.rd = null;
			authKeys.ad = 'ad-token';

			await openInfoFor(result({ tb: true }));

			expect(showInfoForAD).toHaveBeenCalledTimes(1);
			expect(showInfoForTB).not.toHaveBeenCalled();
		});
	});

	// Every provider's cast button showed "Cast started in Stremio" and opened
	// Stremio after a failed cast. What production answered on 2026-10-14 is the
	// reason the toast must show instead.
	describe('cast buttons', () => {
		const casts = {
			rd: { key: 'rd', prop: 'handleCast', helper: handleCastMovie },
			tb: { key: 'tb', prop: 'handleCastTorBox', helper: handleCastMovieTorBox },
			ad: { key: 'ad', prop: 'handleCastAllDebrid', helper: handleCastMovieAllDebrid },
			pm: { key: 'pm', prop: 'handleCastPremiumize', helper: handleCastMoviePremiumize },
			oc: { key: 'oc', prop: 'handleCastOffcloud', helper: handleCastMovieOffcloud },
			dl: { key: 'dl', prop: 'handleCastDebridLink', helper: handleCastMovieDebridLink },
		} as const;
		let openSpy: MockInstance<typeof window.open>;

		beforeEach(() => {
			// react-hot-toast's promise() hands back the promise it was given.
			toastMock.promise.mockImplementation((p: Promise<unknown>) => p);
			openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
		});

		afterEach(() => openSpy.mockRestore());

		const castWith = async (service: keyof typeof casts) => {
			const { key, prop } = casts[service];
			authKeys[key] = `${key}-token`;
			torrentResults.push({
				title: 'First Movie 2019 1080p',
				fileSize: 2048,
				hash: 'a'.repeat(40),
				noVideos: false,
				files: [],
			});
			render(<MovieSearchPage />);
			await waitFor(() =>
				expect(searchResultsProps.current?.[prop]).toBeInstanceOf(Function)
			);
			await searchResultsProps.current[prop]('a'.repeat(40));
			return toastMock.promise.mock.calls[0][1];
		};

		it.each(Object.entries(castFailures.responses))(
			'%s: a failed cast toasts the reason and opens nothing',
			async (service, { body }) => {
				const reason = new Error(body.errorMessage);
				vi.mocked(casts[service as keyof typeof casts].helper).mockRejectedValue(reason);

				const messages = await castWith(service as keyof typeof casts);

				expect(messages.error(reason)).toBe(body.errorMessage);
				expect(openSpy).not.toHaveBeenCalled();
			}
		);

		it.each(Object.keys(casts))('%s: a cast that worked opens Stremio', async (service) => {
			vi.mocked(casts[service as keyof typeof casts].helper).mockResolvedValue(undefined);

			const messages = await castWith(service as keyof typeof casts);

			expect(messages.success).toBe('Cast started in Stremio');
			expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('tt1111111'));
		});
	});

	// The search token is minted over the network now. It is the first await in
	// fetchData and the effect that calls it has no catch, so an unguarded
	// rejection escaped as an unhandled promise and left the page blank — no
	// results, no spinner, no message. Any /api/challenge hiccup does this, not
	// just an unprovisioned secret.
	it('surfaces an error instead of blanking the page when the token cannot be minted', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		generateTokenAndHashMock.mockRejectedValue(new Error('challenge unavailable'));

		render(<MovieSearchPage />);

		await waitFor(() =>
			expect(screen.getByText(/error searching for the query/i)).toBeInTheDocument()
		);

		// The search itself must not have been attempted without a token.
		expect(torrentUrls).toHaveLength(0);

		consoleError.mockRestore();
	});

	// Card 248: the page lists trusted releases named in Russian, but its one-click
	// buttons pick for the viewer. The Vexxer as production held it on 2026-10-07:
	// its largest RD-cached release is the Russian-dub BDRemux, and before the page
	// listed it Instant RD took the German x265 encode.
	describe('one-click picks next to a release named in Russian', () => {
		const vexxer = recorded.pages.find((p) => p.key === 'movie:tt0446009')!;
		const RUSSIAN_DUB = '751970318000a45e5d8e2b49ce49ae8bcd72d101';
		const GERMAN_X265 = 'fb1d2b7ada72260ac12502523b828bcae3090d6c';

		beforeEach(() => {
			routerQuery.imdbid = 'tt0446009';
			// The route's order: biggest first.
			torrentResults.push(
				...[...(vexxer.value as { hash: string; title: string; fileSize: number }[])].sort(
					(a, b) => b.fileSize - a.fileSize
				)
			);
			const cached = new Set(vexxer.rdCached);
			// As the RD lookup answers: each cached release is one video file, and
			// the page re-sorts with what it learned.
			vi.mocked(checkDatabaseAvailabilityRd).mockImplementation(
				async (_key, _solution, _imdbId, hashes, setTorrentList, sortFn) => {
					setTorrentList((prev) =>
						sortFn(
							prev.map((r) =>
								cached.has(r.hash)
									? { ...r, rdAvailable: true, biggestFileSize: r.fileSize }
									: r
							)
						)
					);
					return hashes.filter((h) => cached.has(h)).length;
				}
			);
		});

		afterEach(() => {
			sortByBiggestMock.mockImplementation((results: any[]) => results);
		});

		// Cached first, then biggest, put the Russian-dub BDRemux at the top of the
		// list. The Cyrillic-led releases now follow the rest, each group in the
		// page's own order.
		it('lists the releases named in Russian after the rest', async () => {
			const actual =
				await vi.importActual<typeof import('@/utils/results')>('@/utils/results');
			sortByBiggestMock.mockImplementation(actual.sortByBiggest);

			render(<MovieSearchPage />);
			await screen.findByRole('button', { name: /Instant RD/i });

			expect(
				searchResultsProps.current.filteredResults.map((r: { hash: string }) =>
					r.hash.slice(0, 8)
				)
			).toEqual([
				// cached, then uncached, biggest first
				'453bb1ca',
				'fb1d2b7a',
				'3e00e70c',
				'9e3a5ffc',
				'99ff6a2d',
				'c847f15e',
				'51cda441',
				'7688ea77',
				// named in Russian: the cached BDRemux, then the two DVDRips
				'75197031',
				'8c997e30',
				'e61e15e5',
			]);
		});

		it('lists the Russian-dub release and leaves it out of Instant RD and Cast (RD)', async () => {
			render(<MovieSearchPage />);

			const instant = await screen.findByRole('button', { name: /Instant RD/i });
			const listed = searchResultsProps.current.filteredResults;
			expect(listed.map((r: { hash: string }) => r.hash)).toContain(RUSSIAN_DUB);
			expect(listed.find((r: { hash: string }) => r.hash === RUSSIAN_DUB).rdAvailable).toBe(
				true
			);

			fireEvent.click(instant);
			expect(torrentManagement.addRd).toHaveBeenCalledWith(GERMAN_X265);
			expect(torrentManagement.addRd).not.toHaveBeenCalledWith(RUSSIAN_DUB);

			fireEvent.click(screen.getByRole('button', { name: /Cast \(RD\)/i }));
			expect(handleCastMovie).toHaveBeenCalledWith('tt0446009', 'rd-token', GERMAN_X265);
		});
	});
});
