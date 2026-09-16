/* eslint-disable @next/next/no-img-element */
import { render, screen, waitFor } from '@testing-library/react';
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
	addRdMock,
	delayMock,
	callLog,
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
		addRdMock: vi.fn(),
		delayMock: vi.fn(),
		callLog: [] as string[],
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
		addRd: addRdMock,
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
	checkAvailabilityDl: vi.fn().mockResolvedValue(0),
	checkAvailabilityOc: vi.fn().mockResolvedValue(0),
	checkAvailabilityPm: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityAd: vi.fn().mockResolvedValue(0),
	// Rows arrive from the search with `rdAvailable: false` and it is this
	// lookup that flips them, so the Instant RD buttons only exist once it has.
	checkDatabaseAvailabilityRd: vi.fn(
		async (
			_token: string,
			_hash: string,
			_imdbId: string,
			hashes: string[],
			setSearchResults: (fn: (prev: any[]) => any[]) => void
		) => {
			setSearchResults((prev) =>
				prev.map((r) => (hashes.includes(r.hash) ? { ...r, rdAvailable: true } : r))
			);
			return hashes.length;
		}
	),
	checkDatabaseAvailabilityTb: vi.fn().mockResolvedValue(0),
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

vi.mock('@/utils/delay', () => ({
	__esModule: true,
	delay: delayMock,
}));

import ShowSeasonPage from '@/pages/show/[imdbid]/[seasonNum]';
import { RD_ADD_MIN_SPACING_MS } from '@/services/realDebrid';

const SHOW = {
	title: 'Example Show',
	description: 'Example description',
	poster: '',
	backdrop: 'https://example.com/backdrop.jpg',
	season_count: 1,
	season_names: ['Season One'],
	imdb_score: 7.2,
	season_episode_counts: { 1: 3 },
};

const episodeRow = (n: number) => ({
	hash: `hash-${n}`,
	title: `Example.Show.S01E0${n}.1080p.WEB.h265-GRP`,
	fileSize: 1000,
	medianFileSize: 1000,
	biggestFileSize: 1000,
	videoCount: 1,
	rdAvailable: true,
	adAvailable: false,
	tbAvailable: false,
	pmAvailable: false,
	ocAvailable: false,
	dlAvailable: false,
	files: [],
});

const mountSeason = async () => {
	axiosGetMock.mockImplementation((url: string) => {
		if (url.startsWith('/api/info/show')) {
			return Promise.resolve({ status: 200, data: SHOW });
		}
		if (url.startsWith('/api/torrents/tv')) {
			return Promise.resolve({
				status: 200,
				headers: {},
				data: { results: [episodeRow(1), episodeRow(2), episodeRow(3)] },
			});
		}
		return Promise.resolve({ status: 200, data: {} });
	});
	render(<ShowSeasonPage />);
	return screen.findByRole('button', { name: /Instant RD \(Every Episode\)/i });
};

// Adding every episode of a season is a burst of `addMagnet` calls against one
// account, and RD's budget for those is about 30 a minute (measured
// 2026-09-17), not the 250/min it publishes for the API as a whole. This loop
// used to run flat out: a season of any length spent the allowance partway
// through and every episode after that was refused, which the user then saw as
// RD refusing their next manual add too.
describe('Instant RD (Every Episode) pacing', () => {
	beforeEach(() => {
		axiosGetMock.mockReset();
		posterMock.mockClear();
		toastMock.mockClear();
		toastMock.success.mockClear();
		toastMock.error.mockClear();
		addRdMock.mockReset();
		addRdMock.mockImplementation(async () => {
			callLog.push('add');
		});
		delayMock.mockReset();
		delayMock.mockImplementation(async (ms: number) => {
			callLog.push(`delay:${ms}`);
		});
		callLog.length = 0;
		keys.rd = 'rd-token';
		keys.tb = null;
	});

	it('waits the add budget between episodes instead of adding flat out', async () => {
		const button = await mountSeason();

		await userEvent.click(button);

		await waitFor(() => expect(addRdMock).toHaveBeenCalledTimes(3));

		// One add, then a gap, for every episode after the first.
		expect(callLog.filter((entry) => entry === 'add')).toHaveLength(3);
		expect(callLog).toEqual([
			'add',
			`delay:${RD_ADD_MIN_SPACING_MS}`,
			'add',
			`delay:${RD_ADD_MIN_SPACING_MS}`,
			'add',
		]);
	});
});
