import AnimeEntryLinks, { animeTypeLabel } from '@/components/AnimeEntryLinks';
import AvailabilityTokens from '@/components/AvailabilityTokens';
import MediaHeader from '@/components/MediaHeader';
import SearchSourceProgress from '@/components/SearchSourceProgress';
import SearchTokens from '@/components/SearchTokens';
import TvSearchResults from '@/components/TvSearchResults';
import {
	useAllDebridApiKey,
	useDebridLinkCredential,
	useOffcloudApiKey,
	usePremiumizeCredential,
	useRealDebridAccessToken,
	useTorBoxAccessToken,
} from '@/hooks/auth';
import { useAvailabilityCheck } from '@/hooks/useAvailabilityCheck';
import { useTorrentManagement } from '@/hooks/useTorrentManagement';
import type { AnimeFranchise } from '@/services/anime/animeEntries';
import { SearchResult, hasSubstantialTitle } from '@/services/mediasearch';
import UserTorrentDB from '@/torrent/db';
import { parseAnimePageId } from '@/utils/anidbId';
import {
	AnimeEpisodeFilter,
	AnimeEpisodeSummary,
	parseAnimeEpisodeFilter,
} from '@/utils/animeEpisodes';
import axiosWithRetry from '@/utils/axiosWithRetry';
import { getLocalStorageItemOrDefault, hideRdBlockedTorrentsDefault } from '@/utils/browserStorage';
import { handleCopyOrDownloadMagnet } from '@/utils/copyMagnet';
import { markTransferredHashes } from '@/utils/debridUploader';
import { getColorScale, getQueryForEpisodeCount } from '@/utils/episodeUtils';
import {
	checkAvailabilityOc,
	checkAvailabilityPm,
	checkDatabaseAvailabilityAd,
	checkDatabaseAvailabilityRd,
	checkDatabaseAvailabilityTb,
} from '@/utils/instantChecks';
import { quickSearch } from '@/utils/quickSearch';
import { isRdBlockedFilename } from '@/utils/rdFilenameFilter';
import { sortByMean } from '@/utils/results';
import { showInfoForSearchResult } from '@/utils/searchResultInfo';
import {
	DMM_SOURCE,
	SearchSourceStates,
	initSourceStates,
	markSourceResults,
	markSourceStatus,
} from '@/utils/searchSources';
import {
	defaultEpisodeSize,
	defaultTorrentsFilter as defaultFilterSetting,
	defaultPlayer,
} from '@/utils/settings';
import { searchToastOptions } from '@/utils/toastOptions';
import { generateTokenAndHash } from '@/utils/token';
import { getMultipleTrackerStats } from '@/utils/trackerStats';
import { withAuth } from '@/utils/withAuth';
import { AxiosError } from 'axios';
import { ExternalLink, Film, Loader2, RotateCcw, Search, Tv } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import toast, { Toaster } from 'react-hot-toast';

/** What `/api/info/anime` answers. */
type AnimeInfo = {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	imdbid: string;
	imdbRating: number;
	type?: string;
	episodeCount?: number;
};

type AnimeTorrentsResponse = {
	results?: SearchResult[];
	episodes?: AnimeEpisodeSummary;
};

/** The route's placeholder for an id no source resolved. */
const UNKNOWN_TITLE = 'Unknown';
const PLACEHOLDER_POSTER = 'https://picsum.photos/200/300';
/** What a season is assumed to hold when nothing says; the show page's default too. */
const FALLBACK_EPISODE_COUNT = 13;
/** `/api/torrents/anime` pages 50 at a time; a shorter page is the last one. */
const PAGE_SIZE = 50;

const torrentDB = new UserTorrentDB();

const unavailable = (r: SearchResult) =>
	!r.rdAvailable && !r.adAvailable && !r.tbAvailable && !r.pmAvailable && !r.ocAvailable;

/**
 * An AniDB entry's page: the anime equivalent of `/show/[imdbid]/[seasonNum]`.
 *
 * One AniDB entry is one season, cour, OVA or film, so there is no season to
 * choose; the torrents are the ones the scrapers filed under
 * `anime:anidb-<aid>`. Episode numbers come from the release names, which
 * number an entry's episodes from 1.
 */
const AnimePage: FunctionComponent = () => {
	const router = useRouter();
	const pageId = parseAnimePageId(router.query.anidbid);
	/** Null for an entry addressed by its MAL id, which has no AniDB relations. */
	const anidbId = pageId?.source === 'anidb' ? pageId.id : null;
	const pageSlug = pageId?.slug ?? null;
	const pagePath = pageId?.path ?? null;
	const isMounted = useRef(true);
	const hasLoadedTrackerStats = useRef(false);

	const player = getLocalStorageItemOrDefault('settings:player', defaultPlayer);
	const episodeMaxSize = getLocalStorageItemOrDefault(
		'settings:episodeMaxSize',
		defaultEpisodeSize
	);
	const hideRdBlockedTorrents = hideRdBlockedTorrentsDefault(false);
	const storedTorrentsFilter = useMemo(
		() => getLocalStorageItemOrDefault('settings:defaultTorrentsFilter', defaultFilterSetting),
		[]
	);
	const [shouldDownloadMagnets] = useState(
		() =>
			typeof window !== 'undefined' &&
			window.localStorage.getItem('settings:downloadMagnets') === 'true'
	);

	const [info, setInfo] = useState<AnimeInfo | null>(null);
	const [franchise, setFranchise] = useState<AnimeFranchise | null>(null);
	const [isInfoLoading, setIsInfoLoading] = useState(true);
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const [query, setQuery] = useState(storedTorrentsFilter);
	const [descLimit, setDescLimit] = useState(100);
	const [currentPage, setCurrentPage] = useState(0);
	const [hasMoreResults, setHasMoreResults] = useState(true);
	const [sourceStates, setSourceStates] = useState<SearchSourceStates>({});
	const [episodeSummary, setEpisodeSummary] = useState<AnimeEpisodeSummary | null>(null);
	const episodeFilter = parseAnimeEpisodeFilter(router.query.episode);

	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const torboxKey = useTorBoxAccessToken();
	const premiumizeKey = usePremiumizeCredential();
	const offcloudKey = useOffcloudApiKey();
	const debridLinkKey = useDebridLinkCredential();

	// A bare `/anime/anidb-17617` from the old page or a search id: one address.
	useEffect(() => {
		const raw = router.query.anidbid;
		if (pagePath !== null && typeof raw === 'string' && raw !== pagePath) {
			router.replace({ pathname: '/anime/[anidbid]', query: { anidbid: pagePath } });
		}
	}, [pagePath, router]);

	/**
	 * The IMDb id availability is filed under, when the entry has one.
	 *
	 * The same releases sit on the show page under `tv:<imdb>:<season>`, and an
	 * availability row is keyed by hash with one IMDb id: filing it under the
	 * franchise's id keeps both pages agreeing. With none, the hooks skip the
	 * write and read by hash alone (see `useTorrentManagement`, `instantChecks`).
	 */
	const imdbId = useMemo(() => {
		const fromFranchise = franchise?.imdbIds?.[0];
		if (fromFranchise) return fromFranchise;
		return info?.imdbid && /^tt\d+$/.test(info.imdbid) ? info.imdbid : '';
	}, [franchise, info]);
	/** What reports and tracker stats are filed under; an anime key, never a guessed IMDb id. */
	const mediaKey = pageSlug !== null ? `anime:${pageSlug}` : '';

	const {
		hashAndProgress,
		fetchHashAndProgress,
		addRd,
		addAd,
		addTb,
		addPm,
		addOc,
		addDl,
		sendTbToRd,
		deleteRd,
		deleteAd,
		deleteTb,
		deletePm,
		deleteOc,
		deleteDl,
	} = useTorrentManagement(
		rdKey,
		adKey,
		torboxKey,
		premiumizeKey,
		offcloudKey,
		debridLinkKey,
		imdbId,
		searchResults,
		setSearchResults
	);

	const {
		isAnyChecking,
		isHashServiceChecking,
		checkServiceAvailability,
		checkServiceAvailabilityBulk,
	} = useAvailabilityCheck(
		rdKey,
		adKey,
		torboxKey,
		premiumizeKey,
		offcloudKey,
		debridLinkKey,
		imdbId,
		searchResults,
		setSearchResults,
		hashAndProgress,
		addRd,
		addAd,
		deleteRd,
		deleteAd,
		sortByMean
	);

	useEffect(() => {
		return () => {
			isMounted.current = false;
		};
	}, []);

	// Metadata and relations, keyed on the entry alone.
	useEffect(() => {
		if (pageSlug === null) {
			setIsInfoLoading(false);
			return;
		}
		let cancelled = false;
		setInfo(null);
		setFranchise(null);
		setIsInfoLoading(true);

		Promise.allSettled([
			axiosWithRetry.get<AnimeInfo>(`/api/info/anime?animeid=${pageSlug}`),
			// Relations are between AniDB entries; a MAL-only row has none to ask for.
			anidbId !== null
				? axiosWithRetry.get<AnimeFranchise>(`/api/anime/franchise?anidbid=${anidbId}`)
				: Promise.reject(new Error('no AniDB id')),
		]).then(([infoResult, franchiseResult]) => {
			if (cancelled) return;
			if (infoResult.status === 'fulfilled') setInfo(infoResult.value.data);
			if (franchiseResult.status === 'fulfilled') setFranchise(franchiseResult.value.data);
			setIsInfoLoading(false);
		});

		return () => {
			cancelled = true;
		};
	}, [pageSlug, anidbId]);

	async function fetchData(slug: string, episode: AnimeEpisodeFilter | null, page: number) {
		let tokenWithTimestamp: string;
		let tokenHash: string;
		try {
			[tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
		} catch (error) {
			console.error(
				'Could not obtain a search token:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			setErrorMessage('There was an error searching for the query. Please try again later.');
			setSearchState('loaded');
			setHasMoreResults(false);
			return;
		}
		if (page === 0) setSearchResults([]);
		setErrorMessage('');
		setSearchState('loading');
		hasLoadedTrackerStats.current = false;
		// The anime rows are DMM's own; the external addons are keyed by IMDb
		// season and episode, which an AniDB entry does not have.
		setSourceStates(initSourceStates([]));

		let pendingChecks = 0;
		let resultCount = 0;
		const cached = { rd: 0, ad: 0, tb: 0, pm: 0, oc: 0 };
		const finish = () => {
			if (pendingChecks > 0 || !isMounted.current) return;
			const total = cached.rd + cached.ad + cached.tb + cached.pm + cached.oc;
			if (total > 0) {
				const parts = (
					[
						['RD', cached.rd],
						['AD', cached.ad],
						['TB', cached.tb],
						['PM', cached.pm],
						['OC', cached.oc],
					] as const
				)
					.filter(([, n]) => n > 0)
					.map(([label, n]) => `${label}: ${n}`);
				toast(`${total} cached (${parts.join(', ')})`, searchToastOptions);
			}
		};
		const track = (promise: Promise<number>, service: keyof typeof cached) => {
			pendingChecks++;
			promise
				.then((count) => {
					cached[service] += count;
				})
				.catch((error) => console.error(`${service} availability check failed:`, error))
				.finally(() => {
					pendingChecks--;
					finish();
				});
		};

		try {
			const params = new URLSearchParams({
				animeId: slug,
				dmmProblemKey: tokenWithTimestamp,
				solution: tokenHash,
				page: String(page),
			});
			if (episode !== null) params.set('episode', String(episode));
			const response = await axiosWithRetry.get<AnimeTorrentsResponse>(
				`/api/torrents/anime?${params.toString()}`
			);
			if (!isMounted.current) return;

			const rows = response.data?.results ?? [];
			if (page === 0 && response.data?.episodes) setEpisodeSummary(response.data.episodes);
			setHasMoreResults(rows.length >= PAGE_SIZE);

			const formatted: SearchResult[] = rows.map((r) => ({
				...r,
				rdAvailable: false,
				adAvailable: false,
				tbAvailable: false,
				pmAvailable: false,
				ocAvailable: false,
				noVideos: false,
				files: r.files || [],
			}));

			let hashesToCheck: string[] = [];
			flushSync(() => {
				setSearchResults((prev) => {
					const seen = new Set(prev.map((r) => r.hash));
					const fresh = formatted.filter(
						(r) => r.hash && !seen.has(r.hash) && hasSubstantialTitle(r.title)
					);
					hashesToCheck = fresh.map((r) => r.hash);
					const next = fresh.length > 0 ? sortByMean([...prev, ...fresh]) : prev;
					resultCount = next.length;
					return next;
				});
			});
			setSourceStates((prev) =>
				markSourceStatus(
					markSourceResults(prev, DMM_SOURCE, hashesToCheck.length),
					DMM_SOURCE,
					'done'
				)
			);
			setSearchState('loaded');
			if (page === 0) {
				toast(
					resultCount === 0
						? 'No torrents found'
						: `${resultCount} unique torrents found`,
					searchToastOptions
				);
			}

			if (hashesToCheck.length > 0) {
				// `''` makes the RD and AD lookups ask by hash alone: the same
				// hashes are filed under whichever show page added them.
				if (rdKey) {
					track(
						generateTokenAndHash().then(([t, h]) =>
							checkDatabaseAvailabilityRd(
								t,
								h,
								'',
								hashesToCheck,
								setSearchResults,
								sortByMean
							)
						),
						'rd'
					);
				}
				if (adKey) {
					track(
						generateTokenAndHash().then(([t, h]) =>
							checkDatabaseAvailabilityAd(
								t,
								h,
								'',
								hashesToCheck,
								setSearchResults,
								sortByMean
							)
						),
						'ad'
					);
				}
				if (premiumizeKey) {
					track(
						checkAvailabilityPm(
							premiumizeKey,
							hashesToCheck,
							setSearchResults,
							sortByMean
						),
						'pm'
					);
				}
				if (offcloudKey) {
					track(
						checkAvailabilityOc(
							offcloudKey,
							hashesToCheck,
							setSearchResults,
							sortByMean
						),
						'oc'
					);
				}
				if (torboxKey) {
					track(
						checkDatabaseAvailabilityTb(
							torboxKey,
							hashesToCheck,
							setSearchResults,
							sortByMean
						),
						'tb'
					);
				}
				if (rdKey && torboxKey) markTransferredHashes(hashesToCheck, setSearchResults);
			}
		} catch (error) {
			console.error(
				'Error fetching torrents:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			if ((error as AxiosError).response?.status === 403) {
				setErrorMessage(
					'Please check the time in your device. If it is correct, please try again.'
				);
			} else {
				setErrorMessage(
					'There was an error searching for the query. Please try again later.'
				);
				setHasMoreResults(false);
			}
			setSourceStates((prev) => markSourceStatus(prev, DMM_SOURCE, 'error'));
			setSearchState('loaded');
		}
	}

	// Torrents, refetched when the entry or the episode filter changes. Every
	// page 0 answers the whole entry's episode summary, so it is dropped only
	// when the entry changes, not when an episode is picked.
	const summaryFor = useRef<string | null>(null);
	useEffect(() => {
		if (pageSlug === null || !router.isReady) return;
		setSearchResults([]);
		setCurrentPage(0);
		setHasMoreResults(true);
		if (summaryFor.current !== pageSlug) {
			summaryFor.current = pageSlug;
			setEpisodeSummary(null);
		}

		const initialize = async () => {
			await torrentDB.initializeDB();
			await Promise.all([fetchData(pageSlug, episodeFilter, 0), fetchHashAndProgress()]);
		};
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pageSlug, episodeFilter, router.isReady]);

	// Stored tracker stats for the uncached rows, once per fetch.
	useEffect(() => {
		if (searchState !== 'loaded' || searchResults.length === 0 || hasLoadedTrackerStats.current)
			return;
		hasLoadedTrackerStats.current = true;
		const uncached = searchResults.filter((r) => unavailable(r) && !r.trackerStats);
		if (uncached.length === 0 || !mediaKey) return;
		getMultipleTrackerStats(
			uncached.map((r) => r.hash),
			mediaKey
		)
			.then((stats) => {
				if (!isMounted.current || stats.length === 0) return;
				const byHash = new Map(stats.map((s: any) => [s.hash, s]));
				setSearchResults((prev) =>
					prev.map((r) => {
						const s: any = byHash.get(r.hash);
						if (!s) return r;
						return {
							...r,
							trackerStats: {
								seeders: s.seeders,
								leechers: s.leechers,
								downloads: s.downloads,
								hasActivity: s.seeders >= 1 && s.leechers + s.downloads >= 1,
							},
						};
					})
				);
			})
			.catch((error) => console.error('Error loading cached tracker stats:', error));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchState]);

	const filteredResults = useMemo(() => {
		if (searchResults.length === 0) return [];
		let results = quickSearch(query, searchResults);
		if (hideRdBlockedTorrents) {
			const transferableToRd = (r: SearchResult) =>
				!!rdKey &&
				!r.rdAvailable &&
				((!!torboxKey && r.tbAvailable) || (!!adKey && r.adAvailable) || !!r.tbTransferred);
			results = results.filter((r) => !isRdBlockedFilename(r.title) || transferableToRd(r));
		}
		return results;
	}, [query, searchResults, hideRdBlockedTorrents, rdKey, torboxKey, adKey]);

	const expectedEpisodeCount = useMemo(() => {
		if (info?.episodeCount && info.episodeCount > 0) return info.episodeCount;
		const numbered = episodeSummary?.episodes ?? [];
		const highest = numbered.length > 0 ? numbered[numbered.length - 1].episode : 0;
		return highest > 0 ? highest : FALLBACK_EPISODE_COUNT;
	}, [info, episodeSummary]);

	const setEpisodeFilter = useCallback(
		(filter: AnimeEpisodeFilter | null) => {
			if (pagePath === null) return;
			const nextQuery: Record<string, string> = { anidbid: pagePath };
			if (filter !== null) nextQuery.episode = String(filter);
			router.replace({ pathname: '/anime/[anidbid]', query: nextQuery }, undefined, {
				shallow: true,
			});
		},
		[pagePath, router]
	);

	const handleShowInfo = (result: SearchResult) => {
		showInfoForSearchResult({
			result,
			keys: { rdKey, adKey, torboxKey },
			player,
			// No cast from here: Stremio casts are keyed by IMDb season and episode.
			imdbId: '',
			mediaType: 'tv',
			shouldDownloadMagnets,
			adInLibrary: `ad:${result.hash}` in hashAndProgress,
		});
	};

	if (pageId === null) {
		return (
			<div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">
				<p className="mb-2">That is not an AniDB id.</p>
				<Link href="/" className="text-cyan-300 underline">
					Go Home
				</Link>
			</div>
		);
	}

	if (isInfoLoading) {
		return <div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">Loading...</div>;
	}

	const metadataKnown = Boolean(info && info.title && info.title !== UNKNOWN_TITLE);
	const self = franchise?.entries.find((e) => e.anidbId === anidbId);
	const idLabel = pageId.source === 'anidb' ? `AniDB ${pageId.id}` : `MAL ${pageId.id}`;
	const title = metadataKnown ? info!.title : (self?.title ?? idLabel);
	const poster =
		metadataKnown && info!.poster !== PLACEHOLDER_POSTER ? info!.poster : (self?.poster ?? '');
	const type = animeTypeLabel(info?.type || self?.type);
	const isKnown = metadataKnown || Boolean(franchise?.known);
	const anidbUrl =
		pageId.source === 'anidb'
			? `https://anidb.net/anime/${pageId.id}`
			: `https://myanimelist.net/anime/${pageId.id}`;

	if (!isKnown && searchState === 'loaded' && searchResults.length === 0 && !errorMessage) {
		return (
			<div className="min-h-screen bg-gray-900 p-2 text-gray-100" data-testid="anime-unknown">
				<Head>
					<title>Debrid Media Manager - Anime - {idLabel}</title>
				</Head>
				<h1 className="mb-2 text-xl font-bold">{idLabel}</h1>
				<p className="mb-2">
					DMM has no anime entry with this id, and nothing has been scraped for it.
				</p>
				<div className="flex gap-2">
					<Link
						href={anidbUrl}
						target="_blank"
						className="rounded border-2 border-gray-500 bg-gray-800/30 px-2 py-1 text-sm"
					>
						Look it up on {pageId.source === 'anidb' ? 'AniDB' : 'MyAnimeList'}
					</Link>
					<Link
						href="/"
						className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100"
					>
						Go Home
					</Link>
				</div>
			</div>
		);
	}

	const entries = franchise?.entries ?? [];
	const position = entries.findIndex((e) => e.anidbId === anidbId);
	const previous = position > 0 ? entries[position - 1] : null;
	const next = position >= 0 && position < entries.length - 1 ? entries[position + 1] : null;
	const imdbIds = franchise?.imdbIds?.length ? franchise.imdbIds : imdbId ? [imdbId] : [];
	const isMovie = (info?.type || self?.type || '').toUpperCase() === 'MOVIE';

	const entryFacts = (
		<div className="flex flex-wrap items-center gap-2 text-xs" data-testid="anime-entry-facts">
			{type && (
				<span className="inline-flex items-center rounded border border-fuchsia-500 bg-fuchsia-900/30 px-2 py-0.5 text-fuchsia-100">
					{isMovie ? <Film className="mr-1 h-3 w-3" /> : <Tv className="mr-1 h-3 w-3" />}
					{type}
				</span>
			)}
			{info?.episodeCount ? (
				<span className="rounded border border-gray-500 bg-gray-800/70 px-2 py-0.5 text-gray-300">
					{info.episodeCount} episode{info.episodeCount === 1 ? '' : 's'}
				</span>
			) : null}
			<Link
				href={anidbUrl}
				target="_blank"
				className="inline-flex items-center rounded border border-gray-500 bg-gray-800/70 px-2 py-0.5 text-gray-200 hover:bg-gray-700/70"
			>
				{idLabel}
				<ExternalLink className="ml-1 h-3 w-3" />
			</Link>
			{imdbIds.map((id) => (
				<Link
					key={id}
					href={isMovie ? `/movie/${id}` : `/show/${id}`}
					data-testid="anime-imdb-link"
					className="inline-flex items-center rounded border-2 border-yellow-500 bg-yellow-900/30 px-2 py-0.5 text-yellow-100 hover:bg-yellow-800/50"
					title="Every season of this show, keyed by IMDb"
				>
					{isMovie ? 'Movie page' : 'Show page'} ({id})
				</Link>
			))}
		</div>
	);

	const franchiseNav =
		entries.length > 1 ? (
			<div className="flex flex-col gap-1" data-testid="anime-franchise">
				<div className="flex flex-wrap gap-2 text-xs">
					{previous && (
						<Link
							href={`/anime/${previous.anidbId}`}
							className="rounded border border-fuchsia-500 bg-fuchsia-900/30 px-2 py-0.5 text-fuchsia-100 hover:bg-fuchsia-800/50"
							title={previous.title}
						>
							&larr; Previous entry
						</Link>
					)}
					{next && (
						<Link
							href={`/anime/${next.anidbId}`}
							className="rounded border border-fuchsia-500 bg-fuchsia-900/30 px-2 py-0.5 text-fuchsia-100 hover:bg-fuchsia-800/50"
							title={next.title}
						>
							Next entry &rarr;
						</Link>
					)}
				</div>
				<AnimeEntryLinks
					entries={entries}
					currentAnidbId={anidbId ?? undefined}
					label="Same IMDb title"
				/>
			</div>
		) : null;

	const headerActionButtons = (
		<div data-testid="media-header-actions">
			{rdKey && (
				<button
					className="mb-1 mr-2 mt-0 rounded border-2 border-yellow-500 bg-yellow-900/30 p-1 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => checkServiceAvailabilityBulk(filteredResults, ['RD'])}
					disabled={isAnyChecking}
				>
					<b className="flex items-center justify-center">
						{isAnyChecking ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin text-yellow-500" />
						) : (
							<Search className="mr-1 h-3 w-3 text-yellow-500" />
						)}
						{isAnyChecking ? 'Checking RD...' : 'Check RD'}
					</b>
				</button>
			)}
			{adKey && (
				<button
					className="mb-1 mr-2 mt-0 rounded border-2 border-orange-500 bg-orange-900/30 p-1 text-xs text-orange-100 transition-colors hover:bg-orange-800/50 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => checkServiceAvailabilityBulk(filteredResults, ['AD'])}
					disabled={isAnyChecking}
				>
					<b className="flex items-center justify-center">
						{isAnyChecking ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin text-orange-500" />
						) : (
							<Search className="mr-1 h-3 w-3 text-orange-500" />
						)}
						{isAnyChecking ? 'Checking AD...' : 'Check AD'}
					</b>
				</button>
			)}
			{debridLinkKey && (
				<button
					className="mb-1 mr-2 mt-0 rounded border-2 border-[#38bdf8] bg-[#38bdf8]/20 p-1 text-xs text-sky-100 transition-colors hover:bg-[#38bdf8]/40 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => checkServiceAvailabilityBulk(filteredResults, ['DL'])}
					disabled={isAnyChecking}
					title="Asks Debrid-Link about every row shown. Each hit is added and removed again, which is why it is a button."
				>
					<b className="flex items-center justify-center">
						{isAnyChecking ? (
							<Loader2 className="mr-1 h-3 w-3 animate-spin text-sky-400" />
						) : (
							<Search className="mr-1 h-3 w-3 text-sky-400" />
						)}
						{isAnyChecking ? 'Checking DL...' : 'Check DL'}
					</b>
				</button>
			)}
		</div>
	);

	const episodeChip = (filter: AnimeEpisodeFilter | null, label: string, count?: number) => {
		const selected = episodeFilter === filter;
		return (
			<button
				key={String(filter)}
				type="button"
				onClick={() => setEpisodeFilter(selected ? null : filter)}
				aria-pressed={selected}
				className={
					selected
						? 'whitespace-nowrap rounded border-2 border-red-500 bg-red-900/30 px-2 py-0.5 text-xs text-red-100'
						: 'whitespace-nowrap rounded border-2 border-yellow-500 bg-yellow-900/30 px-2 py-0.5 text-xs text-yellow-100 hover:bg-yellow-800/50'
				}
			>
				{label}
				{count !== undefined && (
					<>
						{' '}
						<span className="text-gray-300">({count})</span>
					</>
				)}
			</button>
		);
	};

	const summary = episodeSummary;
	const episodeNav =
		summary && (summary.episodes.length > 0 || summary.batches > 0) ? (
			<div
				className="flex items-center gap-1 overflow-x-auto pb-1"
				data-testid="anime-episode-nav"
			>
				<span className="mr-1 shrink-0 text-xs text-gray-300">Episodes:</span>
				{episodeChip(null, 'All')}
				{summary.batches > 0 && episodeChip('batch', 'Packs', summary.batches)}
				{summary.episodes.map(({ episode, count }) =>
					episodeChip(episode, String(episode).padStart(2, '0'), count)
				)}
				{summary.unnumbered > 0 &&
					episodeChip('unnumbered', 'Unnumbered', summary.unnumbered)}
			</div>
		) : null;

	const emptyMessage =
		episodeFilter === null
			? 'Nothing has been scraped for this entry yet.'
			: episodeFilter === 'batch'
				? 'No packs for this entry.'
				: episodeFilter === 'unnumbered'
					? 'Every release names an episode or a range.'
					: `No releases for episode ${episodeFilter}.`;

	return (
		<div className="min-h-screen max-w-full bg-gray-900 text-gray-100">
			<Head>
				<title>Debrid Media Manager - Anime - {title}</title>
			</Head>
			<Toaster position="bottom-right" />

			<MediaHeader
				mediaType="anime"
				imdbId={imdbId}
				title={title}
				description={metadataKnown ? info!.description : ''}
				poster={poster}
				backdrop={metadataKnown ? info!.backdrop : ''}
				imdbScore={metadataKnown ? info!.imdbRating : 0}
				ratingHref={anidbUrl}
				descLimit={descLimit}
				onDescToggle={() => setDescLimit(0)}
				actionButtons={headerActionButtons}
				additionalInfo={
					<>
						{entryFacts}
						{franchiseNav}
					</>
				}
			/>

			{searchState === 'loading' && <SearchSourceProgress sources={sourceStates} />}
			{errorMessage && (
				<div className="relative mt-4 rounded border border-red-400 bg-red-900 px-4 py-3">
					<strong className="font-bold">Error:</strong>
					<span className="block sm:inline"> {errorMessage}</span>
				</div>
			)}

			<div className="mb-1 flex items-center border-b-2 border-gray-600 py-2">
				<input
					className="mr-3 w-full appearance-none border-none bg-transparent px-2 py-1 text-sm leading-tight text-gray-100 focus:outline-none"
					type="text"
					id="query"
					placeholder="filter results, supports regex"
					value={query}
					onChange={(e) => setQuery(e.target.value.toLocaleLowerCase())}
				/>
				<span
					className="me-2 inline-flex cursor-pointer items-center rounded bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
					onClick={() => setQuery('')}
					title="Reset search"
				>
					<RotateCcw className="h-3 w-3" />
					<span className="ml-1 hidden sm:inline">Reset</span>
				</span>
				<span className="text-xs text-gray-400">
					{filteredResults.filter((r) => !unavailable(r)).length}/{filteredResults.length}
				</span>
			</div>

			<div className="mb-2 flex flex-col gap-2 p-2">
				{episodeNav}
				<div className="flex items-center gap-2 overflow-x-auto">
					<SearchTokens
						title={title}
						year=""
						onTokenClick={(token) =>
							setQuery((prev) => (prev ? `${prev} ${token}` : token))
						}
					/>
					{getColorScale(expectedEpisodeCount).map((scale, idx) => (
						<span
							key={idx}
							className={`bg-${scale.color} cursor-pointer whitespace-nowrap rounded px-2 py-1 text-xs text-white`}
							onClick={() => {
								const queryText = getQueryForEpisodeCount(
									scale.threshold,
									expectedEpisodeCount
								);
								setQuery((prev) => {
									const cleanedPrev = prev.replace(/\bvideos:[^\s]+/g, '').trim();
									return cleanedPrev ? `${cleanedPrev} ${queryText}` : queryText;
								});
							}}
						>
							{scale.label}
						</span>
					))}
					<AvailabilityTokens
						query={query}
						onQueryChange={setQuery}
						rdKey={rdKey}
						adKey={adKey}
						torboxKey={torboxKey}
						premiumizeKey={premiumizeKey}
						offcloudKey={offcloudKey}
					/>
				</div>
			</div>

			{searchState === 'loaded' && searchResults.length === 0 && !errorMessage && (
				<div
					className="mx-2 my-4 rounded border border-gray-600 bg-gray-800/50 px-4 py-3 text-sm text-gray-300"
					data-testid="anime-no-torrents"
				>
					{emptyMessage}
				</div>
			)}

			<TvSearchResults
				filteredResults={filteredResults}
				expectedEpisodeCount={expectedEpisodeCount}
				onlyShowCached={false}
				episodeMaxSize={episodeMaxSize}
				rdKey={rdKey}
				adKey={adKey}
				torboxKey={torboxKey}
				premiumizeKey={premiumizeKey}
				offcloudKey={offcloudKey}
				debridLinkKey={debridLinkKey}
				player={player}
				hashAndProgress={hashAndProgress}
				handleShowInfo={handleShowInfo}
				handleCopyMagnet={(hash) => handleCopyOrDownloadMagnet(hash, shouldDownloadMagnets)}
				checkServiceAvailability={checkServiceAvailability}
				addRd={addRd}
				addAd={addAd}
				addTb={addTb}
				addPm={addPm}
				addOc={addOc}
				addDl={addDl}
				sendTbToRd={imdbId ? sendTbToRd : undefined}
				deleteRd={deleteRd}
				deleteAd={deleteAd}
				deleteTb={deleteTb}
				deletePm={deletePm}
				deleteOc={deleteOc}
				deleteDl={deleteDl}
				imdbId={mediaKey}
				isHashServiceChecking={isHashServiceChecking}
			/>

			{searchResults.length > 0 && searchState === 'loaded' && hasMoreResults && (
				<button
					className="haptic my-4 w-full rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 font-medium text-gray-100 shadow-md transition-colors duration-200 hover:bg-gray-700/50 hover:shadow-lg"
					onClick={() => {
						setCurrentPage((prev) => prev + 1);
						fetchData(pageSlug!, episodeFilter, currentPage + 1);
					}}
				>
					Show More Results
				</button>
			)}
		</div>
	);
};

export default withAuth(AnimePage);
