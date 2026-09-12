/* eslint-disable @next/next/no-img-element */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	axiosGetMock,
	toastMock,
	AxiosErrorMock,
	posterMock,
	discoverMock,
	runMock,
	stopMock,
	modalFireMock,
	keys,
	seasonStateMock,
} = vi.hoisted(() => {
	class AxiosError extends Error {
		response?: { status?: number };
	}
	const toast = Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		loading: vi.fn(() => 'toast-id'),
		dismiss: vi.fn(),
	});
	return {
		axiosGetMock: vi.fn(),
		toastMock: toast,
		AxiosErrorMock: AxiosError,
		posterMock: vi.fn(({ title }: { title: string }) => (
			<div data-testid="poster-fallback">{title}</div>
		)),
		discoverMock: vi.fn(),
		runMock: vi.fn(),
		stopMock: vi.fn(),
		modalFireMock: vi.fn(),
		keys: { rd: 'rd-token' as string | null, ad: null, tb: 'tb-token' as string | null },
		seasonStateMock: {} as Record<number, string>,
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
	useRealDebridAccessToken: () => [keys.rd],
	useAllDebridApiKey: () => keys.ad,
	useTorBoxAccessToken: () => keys.tb,
	usePremiumizeCredential: () => null,
	useOffcloudApiKey: () => null,
	useDebridLinkCredential: () => null,
}));

vi.mock('@/hooks/useSeasonPackAdder', () => ({
	useSeasonPackAdder: () => ({
		discover: discoverMock,
		run: runMock,
		stop: stopMock,
		discovering: false,
		running: false,
		seasonState: seasonStateMock,
	}),
}));

vi.mock('@/components/modals/modal', () => ({
	__esModule: true,
	default: { fire: modalFireMock },
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

vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: toastMock,
	Toaster: () => null,
}));

import ShowSeasonPage from '@/pages/show/[imdbid]/[seasonNum]';

const SHOW = {
	title: 'Example Show',
	description: 'Example description',
	poster: '',
	backdrop: 'https://example.com/backdrop.jpg',
	season_count: 3,
	season_names: ['Season One', 'Season Two', 'Season Three'],
	imdb_score: 7.2,
	season_episode_counts: { 1: 10, 2: 8, 3: 9 },
};

const mountPage = async (show: Record<string, unknown> = SHOW) => {
	axiosGetMock.mockImplementation((url: string) => {
		if (url.startsWith('/api/info/show')) {
			return Promise.resolve({ status: 200, data: show });
		}
		if (url.startsWith('/api/torrents/tv')) {
			return Promise.resolve({ status: 200, headers: {}, data: { results: [] } });
		}
		return Promise.resolve({ status: 200, data: {} });
	});
	render(<ShowSeasonPage />);
	await waitFor(() => expect(screen.getByTestId('media-header-actions')).toBeInTheDocument());
	return within(screen.getByTestId('media-header-actions'));
};

const planFor = (overrides: Record<string, unknown> = {}) => ({
	service: 'rd',
	entries: [],
	summary: {
		held: [],
		packs: [{ season: 1 }, { season: 2 }],
		episodes: [],
		gaps: [],
		episodeAddCount: 0,
		totalAddCount: 2,
		...overrides,
	},
});

describe('All Seasons buttons', () => {
	beforeEach(() => {
		axiosGetMock.mockReset();
		posterMock.mockClear();
		discoverMock.mockReset();
		runMock.mockReset();
		stopMock.mockReset();
		modalFireMock.mockReset();
		toastMock.mockClear();
		toastMock.success.mockClear();
		toastMock.error.mockClear();
		keys.rd = 'rd-token';
		keys.tb = 'tb-token';
		for (const key of Object.keys(seasonStateMock)) delete seasonStateMock[key as never];
		runMock.mockResolvedValue({
			added: 2,
			failed: 0,
			gaps: [],
			abortedByThrottle: false,
			stopped: false,
		});
	});

	it('offers one button per service the user actually holds', async () => {
		const actions = await mountPage();
		expect(
			actions.getByRole('button', { name: /Instant RD \(All Seasons\)/i })
		).toBeInTheDocument();
		expect(
			actions.getByRole('button', { name: /Instant TB \(All Seasons\)/i })
		).toBeInTheDocument();
	});

	it('hides the TorBox button for a user with no TorBox key', async () => {
		keys.tb = null;
		const actions = await mountPage();
		expect(
			actions.getByRole('button', { name: /Instant RD \(All Seasons\)/i })
		).toBeInTheDocument();
		expect(actions.queryByRole('button', { name: /Instant TB \(All Seasons\)/i })).toBeNull();
	});

	it('offers nothing for a single-season show', async () => {
		const actions = await mountPage({ ...SHOW, season_count: 1, season_names: ['Season One'] });
		expect(actions.queryByRole('button', { name: /All Seasons/i })).toBeNull();
	});

	it('stays offered even when this season has no cached pack on screen', async () => {
		// The Whole Season button reads the rows on screen and hides itself when
		// none qualify. A show-wide action must not vanish because season one's
		// first page happens to hold nothing.
		const actions = await mountPage();
		expect(actions.queryByRole('button', { name: /Instant RD \(Whole Season\)/i })).toBeNull();
		expect(
			actions.getByRole('button', { name: /Instant RD \(All Seasons\)/i })
		).toBeInTheDocument();
	});

	it('asks before adding anything, and states the count', async () => {
		discoverMock.mockResolvedValue(planFor());
		modalFireMock.mockResolvedValue({ isConfirmed: false });
		const actions = await mountPage();

		await userEvent.click(actions.getByRole('button', { name: /Instant RD \(All Seasons\)/i }));

		await waitFor(() => expect(modalFireMock).toHaveBeenCalled());
		const options = modalFireMock.mock.calls[0][0];
		expect(options.title).toMatch(/Real-Debrid/);
		expect(options.text).toMatch(/2 torrents in total/);
		// Discovery adds nothing, so a refusal here costs the user nothing.
		expect(runMock).not.toHaveBeenCalled();
	});

	it('runs only once the dialog is confirmed', async () => {
		discoverMock.mockResolvedValue(planFor());
		modalFireMock.mockResolvedValue({ isConfirmed: true });
		const actions = await mountPage();

		await userEvent.click(actions.getByRole('button', { name: /Instant RD \(All Seasons\)/i }));

		await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
	});

	it('says so plainly when every season is already held', async () => {
		discoverMock.mockResolvedValue(
			planFor({
				packs: [],
				held: [{ season: 1 }, { season: 2 }, { season: 3 }],
				totalAddCount: 0,
			})
		);
		const actions = await mountPage();

		await userEvent.click(actions.getByRole('button', { name: /Instant RD \(All Seasons\)/i }));

		await waitFor(() => expect(toastMock).toHaveBeenCalled());
		expect(toastMock.mock.calls.some((call) => /already in your/i.test(String(call[0])))).toBe(
			true
		);
		expect(modalFireMock).not.toHaveBeenCalled();
		expect(runMock).not.toHaveBeenCalled();
	});

	it('names the seasons it could not fill', async () => {
		discoverMock.mockResolvedValue(planFor({ gaps: [{ season: 3 }] }));
		modalFireMock.mockResolvedValue({ isConfirmed: false });
		const actions = await mountPage();

		await userEvent.click(actions.getByRole('button', { name: /Instant RD \(All Seasons\)/i }));

		await waitFor(() => expect(modalFireMock).toHaveBeenCalled());
		expect(modalFireMock.mock.calls[0][0].text).toMatch(/S3/);
	});

	it('reports a throttled run as unfinished rather than as a success', async () => {
		discoverMock.mockResolvedValue(planFor());
		modalFireMock.mockResolvedValue({ isConfirmed: true });
		runMock.mockResolvedValue({
			added: 1,
			failed: 0,
			gaps: [],
			abortedByThrottle: true,
			stopped: false,
		});
		const actions = await mountPage();

		await userEvent.click(actions.getByRole('button', { name: /Instant RD \(All Seasons\)/i }));

		await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
		expect(toastMock.error.mock.calls.some((call) => /throttling/i.test(String(call[0])))).toBe(
			true
		);
	});

	it('marks each season on the nav with what happened to it', async () => {
		Object.assign(seasonStateMock, { 1: 'added', 2: 'held', 3: 'gap' });
		await mountPage();
		const nav = within(screen.getByTestId('media-header-season-nav'));
		expect(nav.getByRole('link', { name: /Season One/ })).toHaveAttribute(
			'title',
			'Added by the last All Seasons run'
		);
		expect(nav.getByRole('link', { name: /Season Two/ })).toHaveAttribute(
			'title',
			'Already in your library'
		);
		expect(nav.getByRole('link', { name: /Season Three/ })).toHaveAttribute(
			'title',
			'Nothing cached for this season'
		);
	});
});
