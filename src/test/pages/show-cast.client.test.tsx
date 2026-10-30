/* oxlint-disable nextjs/no-img-element */
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const { axiosGetMock, toastMock, AxiosErrorMock, posterMock, resultsProps } = vi.hoisted(() => {
	class AxiosError extends Error {
		response?: { status?: number };
	}
	const toast = Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		promise: vi.fn(),
	});
	return {
		axiosGetMock: vi.fn(),
		toastMock: toast,
		AxiosErrorMock: AxiosError,
		posterMock: vi.fn(({ title }: { title: string }) => (
			<div data-testid="poster-fallback">{title}</div>
		)),
		resultsProps: { current: null as any },
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
	default: (props: any) => {
		resultsProps.current = props;
		return <div data-testid="tv-search-results" />;
	},
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
	usePremiumizeCredential: () => 'pm-token',
	useOffcloudApiKey: () => 'oc-token',
	useDebridLinkCredential: () => 'dl-token',
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

vi.mock('@/utils/castApiClient', () => ({ handleCastTvShow: vi.fn() }));
vi.mock('@/utils/torboxCastApiClient', () => ({ handleCastTvShowTorBox: vi.fn() }));
vi.mock('@/utils/allDebridCastApiClient', () => ({ handleCastTvShowAllDebrid: vi.fn() }));
vi.mock('@/utils/premiumizeCastApiClient', () => ({ handleCastTvShowPremiumize: vi.fn() }));
vi.mock('@/utils/offcloudCastApiClient', () => ({ handleCastTvShowOffcloud: vi.fn() }));
vi.mock('@/utils/debridLinkCastApiClient', () => ({ handleCastTvShowDebridLink: vi.fn() }));

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
import castFailures from '@/test/fixtures/castMovieFailures/production-2026-10-14.json';
import { handleCastTvShowAllDebrid } from '@/utils/allDebridCastApiClient';
import { handleCastTvShow } from '@/utils/castApiClient';
import { handleCastTvShowDebridLink } from '@/utils/debridLinkCastApiClient';
import { handleCastTvShowOffcloud } from '@/utils/offcloudCastApiClient';
import { handleCastTvShowPremiumize } from '@/utils/premiumizeCastApiClient';
import { RD_NAME_REFUSED_MESSAGE } from '@/utils/rdAddPause';
import { handleCastTvShowTorBox } from '@/utils/torboxCastApiClient';

const HASH = 'a'.repeat(40);

// Each cast button's handler, with what the page hands it.
const casts = {
	rd: { prop: 'handleCast', helper: handleCastTvShow, args: [HASH, ['1', '2']] },
	tb: { prop: 'handleCastTorBox', helper: handleCastTvShowTorBox, args: [HASH, ['1', '2']] },
	ad: {
		prop: 'handleCastAllDebrid',
		helper: handleCastTvShowAllDebrid,
		args: [HASH, [{ filename: 'Show.S01E01.mkv' }]],
	},
	pm: { prop: 'handleCastPremiumize', helper: handleCastTvShowPremiumize, args: [HASH] },
	oc: { prop: 'handleCastOffcloud', helper: handleCastTvShowOffcloud, args: [HASH] },
	dl: { prop: 'handleCastDebridLink', helper: handleCastTvShowDebridLink, args: [HASH] },
} as const;
type Service = keyof typeof casts;

// Every provider's cast button showed "Casting succeeded." and opened Stremio
// when no episode was cast. The helpers now reject with the reason.
describe('Show page cast buttons', () => {
	let openSpy: MockInstance<typeof window.open>;
	const realLocation = window.location;

	beforeEach(() => {
		vi.clearAllMocks();
		resultsProps.current = null;
		// react-hot-toast's promise() hands back the promise it was given.
		toastMock.promise.mockImplementation((p: Promise<unknown>) => p);
		openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
		// iOS Safari blocks a window.open made after the cast's await (#472)
		Object.defineProperty(window, 'location', {
			configurable: true,
			writable: true,
			value: { ...realLocation, href: 'http://localhost/' },
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
						imdb_score: 7,
						season_count: 1,
						season_names: ['Season 1'],
						season_episode_counts: { 1: 2 },
					},
				});
			}
			return Promise.resolve({ status: 200, headers: {}, data: { results: [] } });
		});
	});

	afterEach(() => {
		openSpy.mockRestore();
		Object.defineProperty(window, 'location', {
			configurable: true,
			writable: true,
			value: realLocation,
		});
	});

	const castWith = async (service: Service) => {
		const { prop, args } = casts[service];
		render(<ShowSeasonPage />);
		await waitFor(() => expect(resultsProps.current?.[prop]).toBeInstanceOf(Function));
		await resultsProps.current[prop](...args);
		return toastMock.promise.mock.calls[0][1];
	};

	it.each(Object.entries(castFailures.responses))(
		'%s: a cast that failed toasts the reason and opens nothing',
		async (service, { body }) => {
			const reason = new Error(body.errorMessage);
			vi.mocked(casts[service as Service].helper).mockRejectedValue(reason);

			const messages = await castWith(service as Service);

			expect(messages.error(reason)).toBe(body.errorMessage);
			expect(openSpy).not.toHaveBeenCalled();
			expect(window.location.href).toBe('http://localhost/');
		}
	);

	it('rd: every episode refused by name toasts the refusal', async () => {
		const reason = new Error(RD_NAME_REFUSED_MESSAGE);
		vi.mocked(handleCastTvShow).mockRejectedValue(reason);

		const messages = await castWith('rd');

		expect(messages.error(reason)).toBe(RD_NAME_REFUSED_MESSAGE);
		expect(openSpy).not.toHaveBeenCalled();
	});

	it.each(Object.keys(casts))('%s: a cast that worked opens Stremio', async (service) => {
		vi.mocked(casts[service as Service].helper).mockResolvedValue(undefined);

		const messages = await castWith(service as Service);

		expect(messages.success).toBe('Casting succeeded.');
		expect(window.location.href).toContain('stremio://');
		expect(window.location.href).toContain('tt1234567');
		expect(openSpy).not.toHaveBeenCalled();
	});
});
