/* eslint-disable @next/next/no-img-element */
import type { SearchResult } from '@/services/mediasearch';
import {
	addonFixture,
	animeByImdbFixture,
	dmmPagesFixture,
	mergedSeasonRows,
	showInfoFixture,
	usenetFixture,
	type SeasonFixtureId,
} from '@/test/utils/seasonFixtures';
import { quickSearch } from '@/utils/quickSearch';
import { isRdBlockedFilename } from '@/utils/rdFilenameFilter';
import {
	createTvEpisodeReader,
	matchesTvEpisodeFilter,
	summarizeTvEpisodes,
	type TvEpisodeFilter,
} from '@/utils/tvEpisodes';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The season page against what production served for five seasons on
// 2026-09-27: `/api/info/show`, every `/api/torrents/tv` page, Torrentio's and
// Peerflix's answer for each episode, `/api/anime/by-imdb` and the Usenet
// search, all from `src/test/fixtures/seasonEpisodes`. The page's own merge,
// its external-source hook and its text filter run for real.

const { axiosGetMock, pushMock, routerState, resultsProps, fetchMock, parsedNames, settings } =
	vi.hoisted(() => ({
		axiosGetMock: vi.fn(),
		pushMock: vi.fn(),
		routerState: { query: {} as Record<string, string> },
		resultsProps: [] as { filteredResults: SearchResult[] }[],
		fetchMock: vi.fn(),
		parsedNames: [] as string[],
		settings: { hideRdBlocked: false },
	}));

// Counts how often a name is read, to show the chips parse each title once.
vi.mock('@/utils/seasonNaming', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/utils/seasonNaming')>();
	return {
		...actual,
		namedEpisodes: (title: string) => {
			parsedNames.push(title);
			return actual.namedEpisodes(title);
		},
	};
});
vi.mock('@/components/poster', () => ({
	__esModule: true,
	default: ({ title }: { title: string }) => <div data-testid="poster-fallback">{title}</div>,
}));
vi.mock('@/components/RelatedMedia', () => ({
	__esModule: true,
	default: () => <div data-testid="related-media" />,
}));
vi.mock('@/components/SearchTokens', () => ({
	__esModule: true,
	default: () => <div data-testid="search-tokens" />,
}));
vi.mock('@/components/TvSearchResults', () => ({
	__esModule: true,
	default: (props: { filteredResults: SearchResult[] }) => {
		resultsProps.push(props);
		return (
			<ul data-testid="results">
				{props.filteredResults.map((r) => (
					<li key={r.hash}>{r.title}</li>
				))}
			</ul>
		);
	},
}));
vi.mock('@/contexts/LibraryCacheContext', () => ({
	useLibraryCache: () => ({ libraryItems: [], isFetching: false }),
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
vi.mock('@/hooks/useMassReport', () => ({ useMassReport: () => ({ handleMassReport: vi.fn() }) }));
vi.mock('@/hooks/useTorrentManagement', () => ({
	useTorrentManagement: () => ({
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
	}),
}));
vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: class {
		async initializeDB() {}
	},
}));
// The addons' own switches keep their defaults, as for a visitor who never
// opened the settings; every other switch is off.
vi.mock('@/utils/browserStorage', () => ({
	__esModule: true,
	getLocalStorageBoolean: (key: string, fallback: boolean) =>
		key.startsWith('settings:enable') ? fallback : false,
	getLocalStorageItemOrDefault: (key: string, fallback: unknown) =>
		key === 'settings:defaultTorrentsFilter' ? '' : fallback,
	// What a Real-Debrid-only account gets by default, switched per test.
	hideRdBlockedTorrentsDefault: () => settings.hideRdBlocked,
}));
vi.mock('@/utils/token', () => ({
	generateTokenAndHash: () => Promise.resolve(['token', 'hash']),
}));
vi.mock('@/utils/instantChecks', () => ({
	checkDatabaseAvailabilityRd: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityAd: vi.fn().mockResolvedValue(0),
	checkDatabaseAvailabilityTb: vi.fn().mockResolvedValue(0),
	checkAvailabilityPm: vi.fn().mockResolvedValue(0),
	checkAvailabilityOc: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/utils/trackerStats', () => ({ getMultipleTrackerStats: vi.fn().mockResolvedValue([]) }));
vi.mock('@/utils/delay', () => ({ delay: () => Promise.resolve() }));
vi.mock('@/utils/withAuth', () => ({ withAuth: (component: unknown) => component }));
vi.mock('axios', () => ({
	__esModule: true,
	default: {
		get: axiosGetMock,
		post: vi.fn().mockResolvedValue({ data: {} }),
		create: () => ({
			get: axiosGetMock,
			post: vi.fn(),
			interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
		}),
	},
	AxiosError: class extends Error {},
}));
vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ alt, ...props }: any) => <img alt={alt} {...props} />,
}));
vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => ({
		query: routerState.query,
		isReady: true,
		push: pushMock,
		replace: vi.fn(),
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
	default: Object.assign(vi.fn(), {
		success: vi.fn(),
		error: vi.fn(),
		loading: vi.fn(),
		dismiss: vi.fn(),
	}),
	Toaster: () => null,
}));

import { clearAnimeEntriesCache } from '@/hooks/useAnimeEntries';
import ShowSeasonPage from '@/pages/show/[imdbid]/[seasonNum]';

const ADDON_URL = /^https:\/\/(torrentio\.strem\.fun|addon\.peerflix\.mov)\/.*:(\d+):(\d+)\.json$/;

/** Serves the page's requests for one captured season. */
function serve(id: SeasonFixtureId) {
	const imdbId = id.split('-')[0];
	axiosGetMock.mockImplementation(async (url: string) => {
		if (url.startsWith('/api/info/show')) return { status: 200, data: showInfoFixture(id) };
		if (url.startsWith('/api/torrents/tv')) {
			const page = Number(/[?&]page=(\d+)/.exec(url)![1]);
			const results = dmmPagesFixture(id)[page]?.results ?? [];
			return { status: 200, headers: {}, data: { results } };
		}
		const addon = ADDON_URL.exec(url);
		if (addon) {
			const source = addon[1].startsWith('torrentio') ? 'torrentio' : 'peerflix';
			const answer = addonFixture(id)[source]?.[addon[3]];
			if (!answer || answer.status !== 200) throw new Error('addon did not answer');
			return { status: 200, data: answer.body };
		}
		// Comet, MediaFusion and TorrentsDB need a real key and were not captured.
		return { status: 200, data: {} };
	});
	fetchMock.mockImplementation(async (url: string) => {
		const body = url.startsWith('/api/anime/by-imdb')
			? animeByImdbFixture(id)
			: url.startsWith('/api/nzb2rd/search')
				? { results: usenetFixture(id) ?? [], cached: true }
				: { transfers: [] };
		return { ok: true, status: 200, json: async () => body };
	});
	routerState.query = { imdbid: imdbId, seasonNum: id.split('-s')[1] };
}

const readerFor = (id: SeasonFixtureId) => {
	const info = showInfoFixture(id);
	return createTvEpisodeReader({
		season: Number(id.split('-s')[1]),
		episodeCounts: info.season_episode_counts,
		seasonCount: info.season_count,
		anime: Object.values(animeByImdbFixture(id).results).some((v) => v.length > 0),
	});
};

/** The rows the page hands its result list, duplicates included. */
const shownTitles = () => resultsProps.at(-1)!.filteredResults.map((r) => r.title);

const chipRow = () => within(screen.getByTestId('season-episode-nav'));
const chip = (label: string) => chipRow().getByRole('button', { name: new RegExp(`^${label}\\b`) });

const torrentsCalls = () =>
	axiosGetMock.mock.calls.filter(([url]) => String(url).startsWith('/api/torrents/tv')).length;

/** Renders the season and waits until DMM and both addons have landed. */
async function openSeason(id: SeasonFixtureId) {
	serve(id);
	const view = render(<ShowSeasonPage />);
	// Only the first DMM page loads until "Show More Results" is pressed.
	const expected = mergedSeasonRows(id, { dmmPages: 1 }).length;
	await waitFor(() => expect(shownTitles()).toHaveLength(expected), { timeout: 10000 });
	await screen.findByTestId('season-episode-nav');
	return view;
}

/** Simulates the navigation `router.push` asked for, as Next does after a shallow push. */
function navigate(view: ReturnType<typeof render>, query: Record<string, string>) {
	routerState.query = query;
	view.rerender(<ShowSeasonPage />);
}

beforeEach(() => {
	vi.clearAllMocks();
	resultsProps.length = 0;
	parsedNames.length = 0;
	clearAnimeEntriesCache();
	settings.hideRdBlocked = false;
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// Each case replays hundreds of real rows through the page; under a full
// parallel run that takes longer than vitest's five-second default.
describe('episode chips on /show/[imdbid]/[seasonNum]', { timeout: 30000 }, () => {
	it("counts Friends' tenth season over every row the page merged", async () => {
		const id = 'tt0108778-s10';
		await openSeason(id);
		const titles = shownTitles();
		const summary = summarizeTvEpisodes(titles, readerFor(id));

		expect(chip('All')).toHaveAttribute('aria-pressed', 'true');
		expect(chip('Packs')).toHaveTextContent(`Packs (${summary.packs})`);
		expect(chip('Other')).toHaveTextContent(`Other (${summary.other})`);
		for (let episode = 1; episode <= 18; episode++) {
			const label = String(episode).padStart(2, '0');
			expect(chip(label)).toHaveTextContent(
				`${label} (${summary.episodes.get(episode) ?? 0})`
			);
		}
		// Eighteen episodes and no chip past them.
		expect(chipRow().queryByRole('button', { name: /^19\b/ })).not.toBeInTheDocument();
		// The two-part finale counts under both parts.
		const finale = 'Friends S10e17-18 [BDmux 720p - H264 - Ita Eng Aac]';
		expect(titles).toContain(finale);
		expect(readerFor(id)(finale)).toEqual({ kind: 'episodes', episodes: [17, 18] });
	});

	it('filters to an episode through the URL, composes with the text filter, and walks back and forward', async () => {
		const id = 'tt0108778-s10';
		const view = await openSeason(id);
		const read = readerFor(id);
		const all = shownTitles();
		const onlyEpisode = (titles: string[], filter: TvEpisodeFilter) =>
			titles.filter((t) => matchesTvEpisodeFilter(read(t), filter));
		// This test's own reader goes through the same counter; read everything
		// with it first so only the page's reads are left to count.
		all.forEach(read);
		const requestsBefore = torrentsCalls();
		const parsesBefore = parsedNames.length;

		fireEvent.click(chip('17'));
		expect(pushMock).toHaveBeenCalledWith(
			{
				pathname: '/show/[imdbid]/[seasonNum]',
				query: { imdbid: 'tt0108778', seasonNum: '10', episode: '17' },
			},
			undefined,
			{ shallow: true, scroll: false }
		);
		navigate(view, { imdbid: 'tt0108778', seasonNum: '10', episode: '17' });

		const seventeen = onlyEpisode(all, 17);
		expect(seventeen.length).toBeGreaterThan(2);
		expect(shownTitles().sort()).toEqual([...seventeen].sort());
		expect(shownTitles()).toContain('Friends S10e17-18 [BDmux 720p - H264 - Ita Eng Aac]');
		expect(chip('17')).toHaveAttribute('aria-pressed', 'true');

		// The text filter narrows the episode's rows, and the counts stay whole.
		const countsBefore = chip('17').textContent;
		fireEvent.change(screen.getByPlaceholderText(/filter results/), {
			target: { value: '720p' },
		});
		const both = seventeen.filter((t) => /720p/i.test(t));
		expect(both.length).toBeGreaterThan(0);
		expect(both.length).toBeLessThan(seventeen.length);
		await waitFor(() => expect(shownTitles().sort()).toEqual([...both].sort()));
		expect(chip('17').textContent).toBe(countsBefore);

		// Back: no episode in the URL, only the text filter left.
		navigate(view, { imdbid: 'tt0108778', seasonNum: '10' });
		const textOnly = quickSearch(
			'720p',
			all.map((title) => ({ title }) as SearchResult)
		).map((r) => r.title);
		expect(shownTitles().sort()).toEqual([...textOnly].sort());
		expect(chip('All')).toHaveAttribute('aria-pressed', 'true');

		// Forward: the episode again.
		navigate(view, { imdbid: 'tt0108778', seasonNum: '10', episode: '17' });
		expect(shownTitles().sort()).toEqual([...both].sort());

		// Picking the selected chip again clears it.
		fireEvent.click(chip('17'));
		expect(pushMock).toHaveBeenLastCalledWith(
			{
				pathname: '/show/[imdbid]/[seasonNum]',
				query: { imdbid: 'tt0108778', seasonNum: '10' },
			},
			undefined,
			{ shallow: true, scroll: false }
		);

		// None of that fetched the season again or read a title a second time.
		expect(torrentsCalls()).toBe(requestsBefore);
		expect(parsedNames.length).toBe(parsesBefore);
	});

	it('opens on the episode a link names, and on the packs', async () => {
		const id = 'tt0108778-s10';
		routerState.query = {};
		serve(id);
		routerState.query = { imdbid: 'tt0108778', seasonNum: '10', episode: '18' };
		const view = render(<ShowSeasonPage />);
		const read = readerFor(id);
		await screen.findByTestId('season-episode-nav');
		await waitFor(() => expect(chip('18')).toHaveAttribute('aria-pressed', 'true'));
		await waitFor(() =>
			expect(resultsProps.at(-1)!.filteredResults.length).toBe(
				mergedSeasonRows(id, { dmmPages: 1 }).filter((r) =>
					matchesTvEpisodeFilter(read(r.title), 18)
				).length
			)
		);
		expect(shownTitles().every((t) => matchesTvEpisodeFilter(read(t), 18))).toBe(true);

		navigate(view, { imdbid: 'tt0108778', seasonNum: '10', episode: 'packs' });
		expect(chip('Packs')).toHaveAttribute('aria-pressed', 'true');
		expect(shownTitles().length).toBeGreaterThan(50);
		expect(shownTitles().every((t) => read(t).kind === 'pack')).toBe(true);
		expect(shownTitles()).toContain(
			'Friends S01-S10 COMPLETE 1080p BluRay Remux AVC AC3-WhaleHu'
		);
	});

	it('counts only the rows a Real-Debrid-only account is shown, so a chip opens what it says', async () => {
		// Such an account hides the names Real-Debrid refuses unless they can
		// still reach it by transfer; the list never shows them, so a count that
		// included them would promise rows that are not there.
		settings.hideRdBlocked = true;
		const id = 'tt0108778-s10';
		serve(id);
		const view = render(<ShowSeasonPage />);
		await screen.findByTestId('season-episode-nav');
		const read = readerFor(id);
		const merged = mergedSeasonRows(id, { dmmPages: 1 });
		const hidden = 'Friends.S10E01-E17.2160p.NF.WEB-DL.DDP.5.1.DV.H.265-BlackTV';
		expect(merged.map((r) => r.title)).toContain(hidden);
		expect(isRdBlockedFilename(hidden)).toBe(true);
		const shown = merged.filter((r) => !isRdBlockedFilename(r.title));
		await waitFor(() => expect(shownTitles()).toHaveLength(shown.length), { timeout: 10000 });

		const expected = shown.filter((r) => matchesTvEpisodeFilter(read(r.title), 17)).length;
		expect(expected).toBeLessThan(
			merged.filter((r) => matchesTvEpisodeFilter(read(r.title), 17)).length
		);
		expect(chip('17')).toHaveTextContent(`17 (${expected})`);

		navigate(view, { imdbid: 'tt0108778', seasonNum: '10', episode: '17' });
		expect(shownTitles()).toHaveLength(expected);
		expect(shownTitles()).not.toContain(hidden);
	});

	it("marks South Park's episodes that have not aired, with a chip for each", async () => {
		await openSeason('tt0121955-s29');

		expect(chip('01')).toHaveTextContent('01 (55)');
		expect(chip('01')).toBeEnabled();
		for (const label of ['02', '03', '04', '05', '06']) {
			expect(chip(label)).toHaveTextContent(`${label} (0)`);
			expect(chip(label)).toBeDisabled();
			expect(chip(label).className).toContain('border-dashed');
		}
		expect(chip('01').className).not.toContain('border-dashed');
		expect(chip('02')).toHaveAttribute('title', expect.stringMatching(/^Airs /));
		expect(chip('03')).toHaveAttribute('title', 'Not aired yet');
		expect(chip('Packs')).toHaveTextContent('Packs (0)');
		expect(chip('Packs')).toBeDisabled();
		expect(chipRow().queryByRole('button', { name: /^Other/ })).not.toBeInTheDocument();
	});

	it("reads Spy x Family's absolute numbering and counts the Usenet rows once they load", async () => {
		const id = 'tt13706018-s3';
		const view = await openSeason(id);
		const read = readerFor(id);
		const torrents = shownTitles();

		// `- 38` and `S03E42` are the show's 38th and 42nd episodes: the season's
		// first and fifth, since seasons one and two hold 37.
		const absoluteNumber = (t: string) =>
			/(?:S03E|Family - )(3[89]|4\d|50)(?![0-9])/i.exec(t)?.[1];
		const absolute = torrents.filter((t) => absoluteNumber(t) !== undefined);
		expect(absolute.length).toBeGreaterThan(20);
		for (const title of absolute) {
			expect(read(title)).toEqual({
				kind: 'episodes',
				episodes: [Number(absoluteNumber(title)) - 37],
			});
		}

		// More pages land in the same counts.
		for (const page of [1, 2]) {
			fireEvent.click(screen.getByRole('button', { name: 'Show More Results' }));
			await waitFor(() =>
				expect(shownTitles()).toHaveLength(
					mergedSeasonRows(id, { dmmPages: page + 1 }).length
				)
			);
		}
		const deeper = shownTitles();
		expect(deeper).toContain('SPY x FAMILY_S03E42_Operazione mamme-amiche.mp4');
		expect(read('SPY x FAMILY_S03E42_Operazione mamme-amiche.mp4')).toEqual({
			kind: 'episodes',
			episodes: [5],
		});
		expect(chip('05')).toHaveTextContent(
			`05 (${summarizeTvEpisodes(deeper, read).episodes.get(5)})`
		);

		const before = summarizeTvEpisodes(deeper, read);
		expect(chip('13')).toHaveTextContent(`13 (${before.episodes.get(13)})`);

		fireEvent.click(screen.getByRole('button', { name: /Send NZBs from Usenet/ }));
		await screen.findByRole('columnheader', { name: /Release/ });
		const usenet = usenetFixture(id)!.map((r) => r.title);
		const after = summarizeTvEpisodes([...deeper, ...usenet], read);
		await waitFor(() => expect(chip('13')).toHaveTextContent(`13 (${after.episodes.get(13)})`));
		expect(after.episodes.get(13)).toBeGreaterThan(before.episodes.get(13)!);

		// The chip filters the Usenet table too.
		await act(async () => {
			navigate(view, { imdbid: 'tt13706018', seasonNum: '3', episode: '13' });
		});
		const usenetThirteen = usenet.filter((t) => matchesTvEpisodeFilter(read(t), 13));
		const table = screen.getByRole('table');
		const rows = within(table).getAllByRole('row').slice(1);
		expect(rows).toHaveLength(usenetThirteen.length);
		expect(
			screen.getByText(`(${usenetThirteen.length} of ${usenet.length})`)
		).toBeInTheDocument();
	});
});
