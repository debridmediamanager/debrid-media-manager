/* eslint-disable @next/next/no-img-element */
import {
	callAnimeRoute,
	animeFixture as fixture,
	hasAnimeFixture as hasFixture,
} from '@/test/utils/animeFixtures';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The anime page against what production held on 2026-09-27.
//
// `/api/info/anime` answers with production's own responses, captured before
// this page existed (so without `type` and `episodeCount`, which the page must
// cope with). `/api/anime/franchise` and `/api/torrents/anime` are the real
// route handlers, run over the stored `anime:anidb-*` rows, the `Anime` rows,
// the Fribb dataset entries and kitsu.io's answers in the fixtures directory.

const {
	axiosGetMock,
	routerState,
	replaceMock,
	resultsProps,
	torrentManagementArgs,
	checkRdMock,
	toastMock,
} = vi.hoisted(() => {
	const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn() });
	return {
		axiosGetMock: vi.fn(),
		routerState: { query: {} as Record<string, string> },
		replaceMock: vi.fn(),
		resultsProps: [] as any[],
		torrentManagementArgs: [] as any[][],
		checkRdMock: vi.fn(),
		toastMock: toast,
	};
});

vi.mock('@/services/repository', async () => {
	const f = await import('@/test/utils/animeFixtures');
	return {
		repository: {
			getAllScrapedTrueResults: f.fixtureScrapedTrue,
			getAnimeEntryRows: f.fixtureAnimeEntryRows,
		},
	};
});
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
vi.mock('@/utils/problemToken', () => ({ validateProblemToken: () => true }));

vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ title }: { title: string }) => <div data-testid="poster-fallback">{title}</div>,
}));
vi.mock('@/components/SearchTokens', () => ({
	__esModule: true,
	default: ({ title }: { title: string }) => <div data-testid="search-tokens">{title}</div>,
}));
vi.mock('@/components/TvSearchResults', () => ({
	__esModule: true,
	default: (props: any) => {
		resultsProps.push(props);
		return (
			<ul data-testid="results">
				{props.filteredResults.map((r: any) => (
					<li key={r.hash}>{r.title}</li>
				))}
			</ul>
		);
	},
}));
vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: () => ['rd-token'],
	useAllDebridApiKey: () => null,
	useTorBoxAccessToken: () => null,
	usePremiumizeCredential: () => null,
	useOffcloudApiKey: () => null,
	useDebridLinkCredential: () => null,
}));
vi.mock('@/hooks/useAvailabilityCheck', () => ({
	useAvailabilityCheck: () => ({
		isAnyChecking: false,
		isHashServiceChecking: () => false,
		checkServiceAvailability: vi.fn(),
		checkServiceAvailabilityBulk: vi.fn(),
	}),
}));
vi.mock('@/hooks/useTorrentManagement', () => ({
	useTorrentManagement: (...args: any[]) => {
		torrentManagementArgs.push(args);
		return {
			hashAndProgress: {},
			fetchHashAndProgress: vi.fn().mockResolvedValue(undefined),
			addRd: vi.fn(),
			addAd: vi.fn(),
			addTb: vi.fn(),
			addPm: vi.fn(),
			addOc: vi.fn(),
			addDl: vi.fn(),
			sendTbToRd: vi.fn(),
			deleteRd: vi.fn(),
			deleteAd: vi.fn(),
			deleteTb: vi.fn(),
			deletePm: vi.fn(),
			deleteOc: vi.fn(),
			deleteDl: vi.fn(),
		};
	},
}));
vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: class {
		async initializeDB() {}
	},
}));
vi.mock('@/utils/browserStorage', () => ({
	__esModule: true,
	getLocalStorageBoolean: () => false,
	getLocalStorageItemOrDefault: (_key: string, defaultValue: any) =>
		_key === 'settings:defaultTorrentsFilter' ? '' : defaultValue,
	hideRdBlockedTorrentsDefault: (fallback: boolean) => fallback,
}));
vi.mock('@/utils/token', () => ({
	generateTokenAndHash: () => Promise.resolve(['token', 'hash']),
}));
vi.mock('@/utils/instantChecks', () => ({
	checkDatabaseAvailabilityRd: checkRdMock,
	checkDatabaseAvailabilityAd: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityTb: vi.fn().mockResolvedValue(0),
	checkAvailabilityPm: vi.fn().mockResolvedValue(0),
	checkAvailabilityOc: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/utils/trackerStats', () => ({
	getMultipleTrackerStats: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/utils/withAuth', () => ({ withAuth: (component: any) => component }));
vi.mock('axios', () => ({
	__esModule: true,
	default: {
		get: axiosGetMock,
		create: () => ({
			get: axiosGetMock,
			interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
		}),
	},
	AxiosError: class extends Error {},
}));
vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ alt, fill: _fill, ...props }: any) => <img alt={alt} {...props} />,
}));
vi.mock('next/router', () => ({
	useRouter: () => ({
		query: routerState.query,
		isReady: true,
		replace: replaceMock,
		push: vi.fn(),
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
vi.mock('react-hot-toast', () => ({ __esModule: true, default: toastMock, Toaster: () => null }));

import AnimePage from '@/pages/anime/[anidbid]';
import franchiseRoute from '@/pages/api/anime/franchise';
import torrentsRoute from '@/pages/api/torrents/anime';

/** A route's answer as axios hands it over, throwing on an error status. */
async function callRoute(handler: any, url: string) {
	const { status, data } = await callAnimeRoute(handler, url);
	if (status >= 400) throw Object.assign(new Error(`HTTP ${status}`), { response: { status } });
	return { status, data, headers: {} };
}

const torrentCalls = () =>
	axiosGetMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/torrents'));

async function openEntry(anidbid: string) {
	routerState.query = { anidbid };
	const view = render(<AnimePage />);
	await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
	return view;
}

describe('/anime/[anidbid]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resultsProps.length = 0;
		torrentManagementArgs.length = 0;
		checkRdMock.mockResolvedValue(0);
		axiosGetMock.mockImplementation(async (url: string) => {
			if (url.startsWith('/api/info/anime')) {
				const aid = /anidb-(\d+)/.exec(url)![1];
				const name = `api-info-anime-anidb-${aid}.json`;
				return {
					status: 200,
					data: fixture(hasFixture(name) ? name : 'api-info-anime-anidb-99999999.json'),
				};
			}
			if (url.startsWith('/api/anime/franchise')) return callRoute(franchiseRoute, url);
			if (url.startsWith('/api/torrents/anime')) return callRoute(torrentsRoute, url);
			throw new Error(`unexpected request ${url}`);
		});
	});

	it("renders Frieren with its seasons, its IMDb show page and every episode's releases", async () => {
		await openEntry('17617');

		expect(
			await screen.findByRole('heading', { name: 'Sousou no Frieren' })
		).toBeInTheDocument();
		// Production's info answer has no type yet; the franchise entry supplies it.
		expect(within(screen.getByTestId('anime-entry-facts')).getByText('TV')).toBeInTheDocument();
		expect(screen.getByTestId('anime-imdb-link')).toHaveAttribute('href', '/show/tt22248376');
		expect(screen.getByRole('link', { name: /AniDB 17617/ })).toHaveAttribute(
			'href',
			'https://anidb.net/anime/17617'
		);

		const franchise = screen.getByTestId('anime-franchise');
		expect(within(franchise).getByRole('link', { name: 'Next entry →' })).toHaveAttribute(
			'href',
			'/anime/18886'
		);
		expect(within(franchise).queryByText(/Previous entry/)).not.toBeInTheDocument();
		expect(
			within(franchise)
				.getByText('Sousou no Frieren', { selector: 'span' })
				.closest('[aria-current]')
		).not.toBeNull();
		expect(
			within(franchise).getByRole('link', { name: /Sousou no Frieren 2nd Season/ })
		).toHaveAttribute('href', '/anime/18886');

		await waitFor(() => expect(screen.getByTestId('results').children).toHaveLength(50));
		const nav = screen.getByTestId('anime-episode-nav');
		expect(within(nav).getByRole('button', { name: /Packs \(39\)/ })).toBeInTheDocument();
		for (const ep of ['01', '14', '28']) {
			expect(
				within(nav).getByRole('button', { name: new RegExp(`^${ep} \\(`) })
			).toBeInTheDocument();
		}
		expect(within(nav).queryByRole('button', { name: /^29 / })).not.toBeInTheDocument();

		// Availability goes by hash: the same releases are filed under show pages.
		await waitFor(() => expect(checkRdMock).toHaveBeenCalled());
		expect(checkRdMock.mock.calls[0][2]).toBe('');
		// Adds file availability under the show's IMDb id, as its show page does.
		expect(torrentManagementArgs.at(-1)![6]).toBe('tt22248376');
		// No Stremio cast: casts are keyed by IMDb season and episode.
		expect(resultsProps.at(-1).handleCast).toBeUndefined();
		expect(resultsProps.at(-1).imdbId).toBe('anime:anidb-17617');
	});

	it('filters to one episode across the whole entry', async () => {
		const view = await openEntry('17617');
		await waitFor(() => expect(screen.getByTestId('results').children).toHaveLength(50));

		fireEvent.click(
			within(screen.getByTestId('anime-episode-nav')).getByRole('button', {
				name: /^05 \(26\)/,
			})
		);
		expect(replaceMock).toHaveBeenCalledWith(
			{ pathname: '/anime/[anidbid]', query: { anidbid: '17617', episode: '5' } },
			undefined,
			{ shallow: true }
		);

		routerState.query = { anidbid: '17617', episode: '5' };
		view.rerender(<AnimePage />);

		await waitFor(() => expect(torrentCalls().at(-1)).toContain('episode=5'));
		await waitFor(() => expect(screen.getByTestId('results').children).toHaveLength(26));
		const titles = [...screen.getByTestId('results').children].map((li) => li.textContent);
		expect(titles).toContain('[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv');
		expect(titles.every((t) => /\b0?5\b|E05/.test(t!))).toBe(true);
		expect(
			within(screen.getByTestId('anime-episode-nav')).getByRole('button', { name: /^05/ })
		).toHaveAttribute('aria-pressed', 'true');
	});

	it("puts Bookworm's fourth season after the three seasons and the OVA before it", async () => {
		await openEntry('18302');

		expect(
			await screen.findByRole('heading', { name: /Erandeiraremasen 4th Season$/ })
		).toBeInTheDocument();
		// The row calls it a SPECIAL; the dataset says TV, and the page follows it.
		expect(within(screen.getByTestId('anime-entry-facts')).getByText('TV')).toBeInTheDocument();
		expect(screen.getByTestId('anime-imdb-link')).toHaveAttribute('href', '/show/tt10885406');

		const franchise = screen.getByTestId('anime-franchise');
		expect(within(franchise).getByRole('link', { name: '← Previous entry' })).toHaveAttribute(
			'href',
			'/anime/15634'
		);
		expect(within(franchise).queryByText(/Next entry/)).not.toBeInTheDocument();
		expect(
			within(franchise)
				.getAllByRole('link', { name: /Honzuki/ })
				.map((a) => a.getAttribute('href'))
		).toEqual(['/anime/14727', '/anime/15293', '/anime/15300', '/anime/15634']);
		expect(within(franchise).getByText('OVA')).toBeInTheDocument();

		await waitFor(() => expect(screen.getByTestId('results').children).toHaveLength(50));
		const nav = screen.getByTestId('anime-episode-nav');
		expect(within(nav).getByRole('button', { name: /^23 \(12\)/ })).toBeInTheDocument();
		expect(within(nav).queryByRole('button', { name: /^10 / })).not.toBeInTheDocument();
	});

	it('serves an ONA with no IMDb id from its AniDB key alone', async () => {
		await openEntry('17052');

		expect(
			await screen.findByRole('heading', { name: 'Dou Po Cangqiong: Nian Fan' })
		).toBeInTheDocument();
		expect(screen.queryByTestId('anime-imdb-link')).not.toBeInTheDocument();
		expect(screen.queryByTestId('anime-franchise')).not.toBeInTheDocument();
		expect(
			within(screen.getByTestId('anime-entry-facts')).getByText('ONA')
		).toBeInTheDocument();

		await waitFor(() => expect(screen.getByTestId('results').children).toHaveLength(50));
		// Nothing to file availability under, and no IMDb id to hand the uploader.
		expect(torrentManagementArgs.at(-1)![6]).toBe('');
		expect(resultsProps.at(-1).sendTbToRd).toBeUndefined();
	});

	it('shows an empty state for a known entry nothing has been scraped for', async () => {
		await openEntry('18886');

		// Production's info route answered this one with its placeholder; the
		// franchise route labels it from Kitsu.
		expect(
			await screen.findByRole('heading', { name: 'Sousou no Frieren 2nd Season' })
		).toBeInTheDocument();
		expect(await screen.findByTestId('anime-no-torrents')).toHaveTextContent(
			'Nothing has been scraped for this entry yet.'
		);
		expect(screen.getByTestId('anime-franchise')).toBeInTheDocument();
	});

	it('says so for an AniDB id nothing knows', async () => {
		await openEntry('999999');

		expect(await screen.findByTestId('anime-unknown')).toHaveTextContent(
			'DMM has no anime entry with this id'
		);
		expect(screen.getByRole('link', { name: 'Look it up on AniDB' })).toHaveAttribute(
			'href',
			'https://anidb.net/anime/999999'
		);
	});

	it('refuses a path that is not an AniDB id without asking anything', async () => {
		routerState.query = { anidbid: 'frieren' };
		render(<AnimePage />);

		expect(await screen.findByText('That is not an AniDB id.')).toBeInTheDocument();
		expect(axiosGetMock).not.toHaveBeenCalled();
	});

	it('moves the old /anime/anidb-N address to /anime/N', async () => {
		routerState.query = { anidbid: 'anidb-17617' };
		await act(async () => {
			render(<AnimePage />);
		});

		expect(replaceMock).toHaveBeenCalledWith({
			pathname: '/anime/[anidbid]',
			query: { anidbid: '17617' },
		});
	});
});
