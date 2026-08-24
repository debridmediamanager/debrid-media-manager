import MediaHeader from '@/components/MediaHeader';
import MovieSearchResults from '@/components/MovieSearchResults';
import SearchControls from '@/components/SearchControls';
import SearchSourceProgress from '@/components/SearchSourceProgress';
import UsenetResults from '@/components/UsenetResults';
import { useLibraryCache } from '@/contexts/LibraryCacheContext';
import {
	useAllDebridApiKey,
	usePremiumizeCredential,
	useRealDebridAccessToken,
	useTorBoxAccessToken,
} from '@/hooks/auth';
import { useAvailabilityCheck } from '@/hooks/useAvailabilityCheck';
import { useExternalSources } from '@/hooks/useExternalSources';
import { useMassReport } from '@/hooks/useMassReport';
import { useTorrentManagement } from '@/hooks/useTorrentManagement';
import { SearchApiResponse, SearchResult, hasSubstantialTitle } from '@/services/mediasearch';
import UserTorrentDB from '@/torrent/db';
import { handleCastMovieAllDebrid } from '@/utils/allDebridCastApiClient';
import axiosWithRetry from '@/utils/axiosWithRetry';
import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import { handleCastMovie } from '@/utils/castApiClient';
import { handleCopyOrDownloadMagnet } from '@/utils/copyMagnet';
import { markTransferredHashes } from '@/utils/debridUploader';
import {
	checkAvailabilityPm,
	checkDatabaseAvailabilityAd,
	checkDatabaseAvailabilityRd,
	checkDatabaseAvailabilityTb,
} from '@/utils/instantChecks';
import { formatReleaseDate } from '@/utils/movieReleaseDates';
import { handleCastMoviePremiumize } from '@/utils/premiumizeCastApiClient';
import { quickSearch } from '@/utils/quickSearch';
import { isRdBlockedFilename } from '@/utils/rdFilenameFilter';
import { sortByBiggest } from '@/utils/results';
import { searchStateFromStatusHeader } from '@/utils/searchNotice';
import { showInfoForSearchResult } from '@/utils/searchResultInfo';
import {
	DMM_SOURCE,
	SearchSourceStates,
	SearchSourceStatus,
	initSourceStates,
	markSourceResults,
	markSourceStatus,
} from '@/utils/searchSources';
import {
	defaultTorrentsFilter as defaultFilterSetting,
	defaultMovieSize,
	defaultMovieYearFilter,
	defaultPlayer,
} from '@/utils/settings';
import { getStremioDetailUrl } from '@/utils/stremioLinks';
import { castToastOptions, searchToastOptions } from '@/utils/toastOptions';
import { generateTokenAndHash } from '@/utils/token';
import { handleCastMovieTorBox } from '@/utils/torboxCastApiClient';
import { getMultipleTrackerStats } from '@/utils/trackerStats';
import {
	WATCH_SERVICE_LABEL,
	getBiggestVideoFile,
	openWatch,
	pickWatchService,
} from '@/utils/watchService';
import { withAuth } from '@/utils/withAuth';
import { buildYearRegex } from '@/utils/yearFilter';
import { Cast, CloudOff, Eye as EyeIcon, Loader2, Search, Sparkles, Zap } from 'lucide-react';
import getConfig from 'next/config';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import toast, { Toaster } from 'react-hot-toast';

type MovieInfo = {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	year: string;
	imdb_score: number;
	trailer: string;
	digitalReleaseDate?: string;
	expectedDigitalReleaseDate?: string;
	expectedDigitalReleaseSource?: 'tmdb' | 'estimated' | null;
	digitalReleaseAvailable?: boolean;
};

const torrentDB = new UserTorrentDB();

const emptyMovieInfo: MovieInfo = {
	title: '',
	description: '',
	poster: '',
	backdrop: '',
	year: '',
	imdb_score: 0,
	trailer: '',
	digitalReleaseDate: '',
	expectedDigitalReleaseDate: '',
	expectedDigitalReleaseSource: null,
	digitalReleaseAvailable: false,
};

// Color scale for video count
const getColorScale = () => {
	const scale = [
		{ threshold: 1, color: 'gray-800', label: 'Single' },
		{ threshold: Infinity, color: 'blue-900', label: 'With extras' },
	];
	return scale;
};

const getQueryForMovieCount = (videoCount: number) => {
	if (videoCount === 1) return 'videos:1';
	return `videos:>1`;
};

const MovieSearch: FunctionComponent = () => {
	const router = useRouter();
	const { imdbid } = router.query;
	const isMounted = useRef(true);
	const hasLoadedTrackerStats = useRef(false);

	const [movieInfo, setMovieInfo] = useState<MovieInfo>(emptyMovieInfo);
	// imdb id movieInfo belongs to - lets the search wait for its own metadata
	// instead of running against the previously viewed movie's
	const [infoImdbId, setInfoImdbId] = useState<string | null>(null);

	// Settings
	const player = getLocalStorageItemOrDefault('settings:player', defaultPlayer);
	const movieMaxSize = getLocalStorageItemOrDefault('settings:movieMaxSize', defaultMovieSize);
	const onlyTrustedTorrents = getLocalStorageBoolean('settings:onlyTrustedTorrents', false);
	const hideRdBlockedTorrents = (() => {
		if (typeof localStorage === 'undefined') return false;
		const stored = localStorage.getItem('settings:hideRdBlockedTorrents');
		if (stored !== null) return stored === 'true';
		const hasRd = !!localStorage.getItem('rd:accessToken');
		const hasAd = !!localStorage.getItem('ad:apiKey');
		const hasTb = !!localStorage.getItem('tb:apiKey');
		return hasRd && !hasAd && !hasTb;
	})();
	const defaultTorrentsFilter = getLocalStorageItemOrDefault(
		'settings:defaultTorrentsFilter',
		defaultFilterSetting
	);
	const movieYearFilter = getLocalStorageItemOrDefault(
		'settings:movieYearFilter',
		defaultMovieYearFilter
	);
	const { publicRuntimeConfig: config } = getConfig();

	// State
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const [query, setQuery] = useState(defaultTorrentsFilter);
	const [descLimit, setDescLimit] = useState(100);
	const [isWatching, setIsWatching] = useState(false);
	const [onlyShowCached, setOnlyShowCached] = useState<boolean>(false);
	const [currentPage, setCurrentPage] = useState(0);
	const [hasMoreResults, setHasMoreResults] = useState(true);
	const [sourceStates, setSourceStates] = useState<SearchSourceStates>({});
	const [searchCompleteInfo, setSearchCompleteInfo] = useState<{
		finalResults: number;
		totalAvailableCount: number;
		rdAvailableCount?: number;
		adAvailableCount?: number;
		tbAvailableCount?: number;
		pmAvailableCount?: number;
		allSourcesCompleted: boolean;
		pendingAvailabilityChecks: number;
		isAvailabilityOnly?: boolean;
	} | null>(null);

	// Auth keys
	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const torboxKey = useTorBoxAccessToken();
	const premiumizeKey = usePremiumizeCredential();

	// Library sync status - used to prevent auto-availability check while library is still loading
	const { isFetching: isLibrarySyncing } = useLibraryCache();

	const [shouldDownloadMagnets] = useState(
		() =>
			typeof window !== 'undefined' &&
			window.localStorage.getItem('settings:downloadMagnets') === 'true'
	);
	const [showMassReportButtons] = useState(
		() =>
			typeof window !== 'undefined' &&
			window.localStorage.getItem('settings:showMassReportButtons') === 'true'
	);

	// Use shared hooks
	const {
		hashAndProgress,
		fetchHashAndProgress,
		addRd,
		addAd,
		addTb,
		addPm,
		sendTbToRd,
		sendAdToRd,
		deleteRd,
		deleteAd,
		deleteTb,
		deletePm,
	} = useTorrentManagement(
		rdKey,
		adKey,
		torboxKey,
		premiumizeKey,
		imdbid as string,
		searchResults,
		setSearchResults
	);

	const { fetchMovieFromExternalSource, getEnabledSources } = useExternalSources(
		rdKey,
		adKey,
		torboxKey
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
		imdbid as string,
		searchResults,
		setSearchResults,
		hashAndProgress,
		addRd,
		addAd,
		deleteRd,
		deleteAd,
		sortByBiggest
	);

	const { handleMassReport } = useMassReport(rdKey, adKey, torboxKey, imdbid as string);

	// Fetch movie info
	useEffect(() => {
		if (!imdbid) return;
		const id = imdbid as string;

		// Drop the previous movie's metadata so nothing downstream reads it as if
		// it belonged to this one
		setMovieInfo(emptyMovieInfo);
		setInfoImdbId(null);

		const fetchMovieInfo = async () => {
			try {
				const response = await axiosWithRetry.get(`/api/info/movie?imdbid=${id}`);
				setMovieInfo(response.data);
				setInfoImdbId(id);
			} catch (error) {
				console.error('Failed to fetch movie info:', error);
			}
		};

		fetchMovieInfo();
	}, [imdbid]);

	// Apply year prefilter when movie info loads
	const hasAppliedYearFilter = useRef<string | null>(null);
	useEffect(() => {
		if (movieYearFilter === 'off' || !infoImdbId || !movieInfo.year) return;
		if (hasAppliedYearFilter.current === infoImdbId) return;
		const yearNum = parseInt(movieInfo.year, 10);
		if (isNaN(yearNum)) return;
		const tolerance = parseInt(movieYearFilter, 10);
		if (isNaN(tolerance)) return;
		hasAppliedYearFilter.current = infoImdbId;
		const yearPattern = buildYearRegex(yearNum, tolerance);
		setQuery((prev) => (prev ? `${prev} ${yearPattern}` : yearPattern));
	}, [movieYearFilter, movieInfo.year, infoImdbId]);

	// Initialize data - waits for this movie's own info so the search can use its title
	useEffect(() => {
		if (!imdbid || infoImdbId !== imdbid) return;

		const initializeData = async () => {
			await torrentDB.initializeDB();
			await Promise.all([fetchData(imdbid as string), fetchHashAndProgress()]);
		};

		initializeData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid, infoImdbId]);

	useEffect(() => {
		return () => {
			isMounted.current = false;
		};
	}, []);

	// Load cached tracker stats
	useEffect(() => {
		async function loadCachedTrackerStats() {
			const uncachedResults = searchResults.filter(
				(r) =>
					!r.rdAvailable &&
					!r.adAvailable &&
					!r.tbAvailable &&
					!r.pmAvailable &&
					!r.trackerStats
			);

			if (uncachedResults.length === 0) return;

			try {
				const hashes = uncachedResults.map((r) => r.hash);
				const trackerStatsArray = await getMultipleTrackerStats(hashes, imdbid as string);

				if (isMounted.current && trackerStatsArray.length > 0) {
					setSearchResults((prevResults) => {
						return prevResults.map((r) => {
							const stats = trackerStatsArray.find((s) => s.hash === r.hash);
							if (stats) {
								return {
									...r,
									trackerStats: {
										seeders: stats.seeders,
										leechers: stats.leechers,
										downloads: stats.downloads,
										hasActivity:
											stats.seeders >= 1 &&
											stats.leechers + stats.downloads >= 1,
									},
								};
							}
							return r;
						});
					});
				}
				hasLoadedTrackerStats.current = true;
			} catch (error) {
				console.error('Error loading cached tracker stats:', error);
			}
		}

		// Runs once per fetch - fetchData clears the flag, so "Show More Results"
		// pages get their stats too
		if (
			searchState === 'loaded' &&
			searchResults.length > 0 &&
			!hasLoadedTrackerStats.current
		) {
			loadCachedTrackerStats();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchState]);

	// Reset per-title state when navigating to another movie - the component stays
	// mounted across client-side routing, so nothing resets on its own
	useEffect(() => {
		setQuery(defaultTorrentsFilter);
		setCurrentPage(0);
		setHasMoreResults(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid]);

	async function fetchData(imdbId: string, page: number = 0) {
		const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
		if (page === 0) {
			setSearchResults([]);
		}
		setErrorMessage('');
		setSearchState('loading');
		// Newly fetched results have no tracker stats yet
		hasLoadedTrackerStats.current = false;

		// External addons only run on the first page; "Show More Results" is DMM only
		const enabledSources = page === 0 ? getEnabledSources() : [];
		setSourceStates(initSourceStates(enabledSources));

		let completedSources = 0;
		let totalSources = 1 + enabledSources.length; // DMM + external addons
		let rdAvailableCount = 0;
		let adAvailableCount = 0;
		let tbAvailableCount = 0;
		let pmAvailableCount = 0;
		let pendingAvailabilityChecks = 0;
		let allSourcesCompleted = false;
		let finalResultCount = 0;
		let latestResultCount = 0;
		let toastShown = false;

		// Helper to check if everything is done and show toast only once
		const checkAndShowFinalToast = () => {
			if (toastShown) return;
			if (!allSourcesCompleted || pendingAvailabilityChecks > 0) return;

			toastShown = true;
			setSearchCompleteInfo({
				finalResults: finalResultCount,
				totalAvailableCount:
					rdAvailableCount + adAvailableCount + tbAvailableCount + pmAvailableCount,
				rdAvailableCount,
				adAvailableCount,
				tbAvailableCount,
				pmAvailableCount,
				allSourcesCompleted: true,
				pendingAvailabilityChecks: 0,
			});
		};

		const titleStartsWithYear = /^\d{4}\b/.test(movieInfo.title);

		// Counted once per source, never per batch of results, so the completion
		// toast reports the full set rather than whatever had arrived first
		const markSourceComplete = (source: string, status: SearchSourceStatus = 'done') => {
			setSourceStates((prev) => markSourceStatus(prev, source, status));
			completedSources++;
			if (completedSources < totalSources) return;
			allSourcesCompleted = true;
			finalResultCount = latestResultCount;
			// keep the "processing" notice if the API returned one
			setSearchState((prev) => (prev === 'processing' ? prev : 'loaded'));
			checkAndShowFinalToast();
		};

		const processSourceResults = async (sourceResults: SearchResult[], sourceName: string) => {
			if (!isMounted.current) return;

			let hashesToCheck: string[] = [];
			let addedCount = 0;

			// flushSync ensures the updater runs synchronously so hashesToCheck
			// is populated before the availability checks below.
			flushSync(() => {
				setSearchResults((prevResults) => {
					const existingHashes = new Set(prevResults.map((r) => r.hash));
					const newUniqueResults = sourceResults.filter(
						(r) =>
							r.hash &&
							!existingHashes.has(r.hash) &&
							hasSubstantialTitle(r.title) &&
							(titleStartsWithYear || !/^\d{4}\)/.test(r.title))
					);

					if (newUniqueResults.length === 0) {
						latestResultCount = prevResults.length;
						return prevResults;
					}

					// Same ordering the availability checks re-apply as they land, so
					// rows do not jump between two different sorts
					const sorted = sortByBiggest([...prevResults, ...newUniqueResults]);

					hashesToCheck = newUniqueResults
						.filter(
							(r) =>
								!r.rdAvailable && !r.adAvailable && !r.tbAvailable && !r.pmAvailable
						)
						.map((r) => r.hash);

					addedCount = newUniqueResults.length;
					latestResultCount = sorted.length;
					return sorted;
				});
			});

			if (addedCount > 0) {
				setSourceStates((prev) => markSourceResults(prev, sourceName, addedCount));
			}

			// Fire availability checks outside the state updater
			if (hashesToCheck.length > 0) {
				if (rdKey) {
					pendingAvailabilityChecks++;
					generateTokenAndHash().then(async ([tokenWithTimestamp, tokenHash]) => {
						const count = await checkDatabaseAvailabilityRd(
							tokenWithTimestamp,
							tokenHash,
							imdbId,
							hashesToCheck,
							setSearchResults,
							sortByBiggest
						);
						rdAvailableCount += count;
						pendingAvailabilityChecks--;
						checkAndShowFinalToast();
					});
				}

				if (adKey) {
					pendingAvailabilityChecks++;
					generateTokenAndHash().then(async ([tokenWithTimestamp, tokenHash]) => {
						const count = await checkDatabaseAvailabilityAd(
							tokenWithTimestamp,
							tokenHash,
							imdbId,
							hashesToCheck,
							setSearchResults,
							sortByBiggest
						);
						adAvailableCount += count;
						pendingAvailabilityChecks--;
						checkAndShowFinalToast();
					});
				}

				if (premiumizeKey) {
					pendingAvailabilityChecks++;
					// One request for the whole batch, and nothing is added to the
					// account - the cheapest availability check of the four.
					checkAvailabilityPm(
						premiumizeKey,
						hashesToCheck,
						setSearchResults,
						sortByBiggest
					).then((count) => {
						pmAvailableCount += count;
						pendingAvailabilityChecks--;
						checkAndShowFinalToast();
					});
				}

				if (torboxKey) {
					pendingAvailabilityChecks++;
					checkDatabaseAvailabilityTb(
						torboxKey,
						hashesToCheck,
						setSearchResults,
						sortByBiggest
					).then((count) => {
						tbAvailableCount += count;
						pendingAvailabilityChecks--;
						checkAndShowFinalToast();
					});
				}

				// Suppress the redundant "TB → RD" button on rows already transferred
				// to RD by any user (content lives in RD under a rewritten hash).
				if (rdKey && torboxKey) {
					markTransferredHashes(hashesToCheck, setSearchResults);
				}
			}

			checkAndShowFinalToast();
		};

		try {
			// Start DMM fetch
			const dmmPromise = (async () => {
				let path = `api/torrents/movie?imdbId=${imdbId}&dmmProblemKey=${tokenWithTimestamp}&solution=${tokenHash}&onlyTrusted=${onlyTrustedTorrents}&maxSize=${movieMaxSize}&page=${page}`;
				if (config.externalSearchApiHostname) {
					path = encodeURIComponent(path);
				}
				let endpoint = `${config.externalSearchApiHostname || ''}/${path}`;
				const response = await axiosWithRetry.get<SearchApiResponse>(endpoint);

				if (response.status !== 200) {
					setSearchState(searchStateFromStatusHeader(response.headers.status));
					return [];
				}

				return response.data.results || [];
			})();

			// Start all external fetches simultaneously
			enabledSources.forEach((source) => {
				fetchMovieFromExternalSource(imdbId, source)
					.then((results) => processSourceResults(results, source))
					.then(
						() => markSourceComplete(source),
						(err) => {
							console.error(`${source} error:`, err);
							markSourceComplete(source, 'error');
						}
					);
			});

			// Process DMM results
			const dmmResults = await dmmPromise;
			setHasMoreResults(dmmResults.length > 0);

			const formattedDmmResults = dmmResults.map((r) => ({
				...r,
				rdAvailable: false,
				adAvailable: false,
				tbAvailable: false,
				pmAvailable: false,
				noVideos: false,
				files: r.files || [],
			}));
			await processSourceResults(formattedDmmResults, DMM_SOURCE);
			markSourceComplete(DMM_SOURCE);
		} catch (error) {
			console.error(
				'Error fetching torrents:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			if ((error as any).response?.status === 403) {
				setErrorMessage(
					'Please check the time in your device. If it is correct, please try again.'
				);
			} else {
				setErrorMessage(
					'There was an error searching for the query. Please try again later.'
				);
				setHasMoreResults(false);
			}
			// DMM failed outright - stop showing it as still searching
			setSourceStates((prev) => markSourceStatus(prev, DMM_SOURCE, 'error'));
			setSearchState('loaded');
		}
	}

	// Derive filtered results and uncached count using useMemo to prevent setState during render
	const filteredResults = useMemo(() => {
		if (searchResults.length === 0) {
			return [];
		}
		let results = quickSearch(query, searchResults);
		if (hideRdBlockedTorrents) {
			// Keep an RD-blocked row when it can still reach RD through a TB/AD
			// transfer (which de-infringes the name) — that's where the block matters
			// least and the Send-to-RD button is the whole point.
			const transferableToRd = (r: SearchResult) =>
				!!rdKey &&
				!r.rdAvailable &&
				((!!torboxKey && r.tbAvailable) || (!!adKey && r.adAvailable) || !!r.tbTransferred);
			results = results.filter((r) => !isRdBlockedFilename(r.title) || transferableToRd(r));
		}
		return results;
	}, [query, searchResults, hideRdBlockedTorrents, rdKey, torboxKey, adKey]);

	const totalUncachedCount = useMemo(() => {
		return filteredResults.filter(
			(r) => !r.rdAvailable && !r.adAvailable && !r.tbAvailable && !r.pmAvailable
		).length;
	}, [filteredResults]);

	const movieReleaseInfo = useMemo(() => {
		if (!movieInfo.expectedDigitalReleaseDate) return null;
		const date = formatReleaseDate(movieInfo.expectedDigitalReleaseDate);
		const label =
			movieInfo.expectedDigitalReleaseSource === 'estimated'
				? 'Expected digital release'
				: 'Digital release';
		return (
			<div className="w-fit rounded bg-slate-900/75 px-2 py-1 text-xs text-slate-100">
				<span className="text-slate-400">{label}:</span> {date}
				{movieInfo.expectedDigitalReleaseSource === 'estimated' && (
					<span className="text-slate-400"> estimate</span>
				)}
			</div>
		);
	}, [movieInfo.expectedDigitalReleaseDate, movieInfo.expectedDigitalReleaseSource]);

	// Handle toast notifications when search completes
	useEffect(() => {
		if (!searchCompleteInfo) return;

		const {
			finalResults,
			totalAvailableCount,
			rdAvailableCount,
			adAvailableCount,
			tbAvailableCount,
			pmAvailableCount,
			allSourcesCompleted,
			pendingAvailabilityChecks,
			isAvailabilityOnly,
		} = searchCompleteInfo;

		// Show search results toast (only if this is not an availability-only update)
		if (!isAvailabilityOnly) {
			if (finalResults === 0) {
				toast('No torrents found', searchToastOptions);
			} else {
				toast(`${finalResults} unique torrents found`, searchToastOptions);
			}
		}

		// Show availability toast and/or auto-trigger availability check per service
		if (allSourcesCompleted && pendingAvailabilityChecks === 0) {
			// Build service-specific availability message
			const servicesWithCache = [];
			if (rdKey && (rdAvailableCount ?? 0) > 0)
				servicesWithCache.push(`RD: ${rdAvailableCount}`);
			if (adKey && (adAvailableCount ?? 0) > 0)
				servicesWithCache.push(`AD: ${adAvailableCount}`);
			if (torboxKey && (tbAvailableCount ?? 0) > 0)
				servicesWithCache.push(`TB: ${tbAvailableCount}`);
			if (premiumizeKey && (pmAvailableCount ?? 0) > 0)
				servicesWithCache.push(`PM: ${pmAvailableCount}`);

			// Show toast for cached torrents if any found
			if (totalAvailableCount > 0) {
				const message =
					servicesWithCache.length > 0
						? `${totalAvailableCount} cached (${servicesWithCache.join(', ')})`
						: `${totalAvailableCount} cached torrents available`;
				toast(message, searchToastOptions);
			}
		}

		// Clear the info after handling
		setSearchCompleteInfo(null);
	}, [
		searchCompleteInfo,
		rdKey,
		adKey,
		torboxKey,
		premiumizeKey,
		isAnyChecking,
		isLibrarySyncing,
		checkServiceAvailabilityBulk,
		filteredResults,
		imdbid,
	]);

	const handleShowInfo = (result: SearchResult) => {
		showInfoForSearchResult({
			result,
			keys: { rdKey, adKey, torboxKey },
			player,
			imdbId: imdbid as string,
			mediaType: 'movie',
			shouldDownloadMagnets,
			adInLibrary: `ad:${result.hash}` in hashAndProgress,
		});
	};

	async function handleCast(hash: string) {
		await toast.promise(
			handleCastMovie(imdbid as string, rdKey!, hash),
			{
				loading: 'Starting RD cast in Stremio...',
				success: 'Cast started in Stremio',
				error: 'RD cast failed in Stremio',
			},
			castToastOptions
		);
		window.open(getStremioDetailUrl(imdbid as string));
	}

	async function handleCastTorBox(hash: string) {
		await toast.promise(
			handleCastMovieTorBox(imdbid as string, torboxKey!, hash),
			{
				loading: 'Starting TorBox cast in Stremio...',
				success: 'Cast started in Stremio',
				error: 'TorBox cast failed in Stremio',
			},
			castToastOptions
		);
		window.open(getStremioDetailUrl(imdbid as string));
	}

	async function handleCastAllDebrid(hash: string) {
		await toast.promise(
			handleCastMovieAllDebrid(imdbid as string, adKey!, hash),
			{
				loading: 'Starting AllDebrid cast in Stremio...',
				success: 'Cast started in Stremio',
				error: 'AllDebrid cast failed in Stremio',
			},
			castToastOptions
		);
		window.open(getStremioDetailUrl(imdbid as string));
	}

	async function handleCastPremiumize(hash: string) {
		await toast.promise(
			handleCastMoviePremiumize(imdbid as string, premiumizeKey!, hash),
			{
				loading: 'Starting Premiumize cast in Stremio...',
				success: 'Cast started in Stremio',
				error: 'Premiumize cast failed in Stremio',
			},
			castToastOptions
		);
		window.open(getStremioDetailUrl(imdbid as string));
	}

	const getFirstAvailableRdTorrent = () => {
		return filteredResults.find((r) => r.rdAvailable && !r.noVideos);
	};

	// Unlike "Instant RD" and "Cast (RD)", Watch works with whichever service has
	// the torrent cached, so it gets its own pick rather than reusing the RD one.
	const getFirstWatchableTorrent = () =>
		filteredResults.find(
			(r) => !r.noVideos && pickWatchService(r, { rdKey, adKey, torboxKey }) !== null
		);

	const handleWatchFirst = async () => {
		const result = getFirstWatchableTorrent();
		if (!result) return;
		const service = pickWatchService(result, { rdKey, adKey, torboxKey });
		if (!service) return;
		const biggest = getBiggestVideoFile(result);
		setIsWatching(true);
		try {
			await openWatch({
				service,
				player,
				hash: result.hash,
				keys: { rdKey, adKey, torboxKey },
				fileName: biggest?.filename,
				fileId: biggest?.fileId,
				adInLibrary: `ad:${result.hash}` in hashAndProgress,
			});
		} finally {
			setIsWatching(false);
		}
	};

	const handleActionButtons = () => {
		const firstWatchable = getFirstWatchableTorrent();
		const watchableService = firstWatchable
			? pickWatchService(firstWatchable, { rdKey, adKey, torboxKey })
			: null;
		return (
			<>
				{(rdKey || adKey || torboxKey) && (
					<>
						{rdKey && (
							<button
								className="mb-1 mr-2 mt-0 rounded border-2 border-yellow-500 bg-yellow-900/30 p-1 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50 disabled:cursor-not-allowed disabled:opacity-50"
								onClick={() =>
									checkServiceAvailabilityBulk(filteredResults, ['RD'])
								}
								disabled={isAnyChecking}
							>
								<b className="flex items-center justify-center">
									{isAnyChecking ? (
										<>
											<Loader2 className="mr-1 h-3 w-3 animate-spin text-yellow-500" />
											Checking RD...
										</>
									) : (
										<>
											<Search className="mr-1 h-3 w-3 text-yellow-500" />
											Check RD
										</>
									)}
								</b>
							</button>
						)}
						{adKey && (
							<button
								className="mb-1 mr-2 mt-0 rounded border-2 border-orange-500 bg-orange-900/30 p-1 text-xs text-orange-100 transition-colors hover:bg-orange-800/50 disabled:cursor-not-allowed disabled:opacity-50"
								onClick={() =>
									checkServiceAvailabilityBulk(filteredResults, ['AD'])
								}
								disabled={isAnyChecking}
							>
								<b className="flex items-center justify-center">
									{isAnyChecking ? (
										<>
											<Loader2 className="mr-1 h-3 w-3 animate-spin text-orange-500" />
											Checking AD...
										</>
									) : (
										<>
											<Search className="mr-1 h-3 w-3 text-orange-500" />
											Check AD
										</>
									)}
								</b>
							</button>
						)}
						{getFirstAvailableRdTorrent() && (
							<>
								<button
									className="mb-1 mr-2 mt-0 rounded border-2 border-green-500 bg-green-900/30 p-1 text-xs text-green-100 transition-colors hover:bg-green-800/50"
									onClick={() => {
										const firstAvailable = getFirstAvailableRdTorrent()!;
										if (`rd:${firstAvailable.hash}` in hashAndProgress) {
											toast.success('Already in your Real-Debrid library');
											return;
										}
										addRd(firstAvailable.hash);
									}}
								>
									<b className="flex items-center justify-center">
										<Zap className="mr-1 h-3 w-3 text-yellow-500" />
										Instant RD
									</b>
								</button>
								<button
									className="mb-1 mr-2 mt-0 rounded border-2 border-green-500 bg-green-900/30 p-1 text-xs text-green-100 transition-colors hover:bg-green-800/50"
									onClick={() => handleCast(getFirstAvailableRdTorrent()!.hash)}
								>
									<b className="flex items-center justify-center">
										<Cast className="mr-1 h-3 w-3 text-green-400" />
										Cast (RD)
									</b>
								</button>
							</>
						)}
						{watchableService && player && (
							<button
								className="mb-1 mr-2 mt-0 rounded border-2 border-teal-500 bg-teal-900/30 p-1 text-xs text-teal-100 transition-colors hover:bg-teal-800/50 disabled:cursor-not-allowed disabled:opacity-50"
								title={`Watch via ${WATCH_SERVICE_LABEL[watchableService]}`}
								onClick={handleWatchFirst}
								disabled={isWatching}
							>
								<b className="flex items-center justify-center">
									{isWatching ? (
										<Loader2 className="mr-1 h-3 w-3 animate-spin text-teal-500" />
									) : (
										<EyeIcon className="mr-1 h-3 w-3 text-teal-500" />
									)}
									Watch
								</b>
							</button>
						)}
					</>
				)}
				<button
					className="mb-1 mr-2 mt-0 rounded border-2 border-purple-500 bg-purple-900/30 p-1 text-xs text-purple-100 transition-colors hover:bg-purple-800/50"
					onClick={() => window.open(getStremioDetailUrl(imdbid as string))}
				>
					<b className="flex items-center justify-center">
						<Sparkles className="mr-1 h-3 w-3 text-purple-500" />
						Stremio
					</b>
				</button>
				{onlyShowCached && totalUncachedCount > 0 && (
					<button
						className="mb-1 mr-2 mt-0 rounded border-2 border-blue-500 bg-blue-900/30 p-1 text-xs text-blue-100 transition-colors hover:bg-blue-800/50"
						onClick={() => setOnlyShowCached(false)}
					>
						<CloudOff className="mr-1 h-3 w-3 text-blue-500" />
						Show {totalUncachedCount} uncached
					</button>
				)}
			</>
		);
	};

	if (!movieInfo.title) {
		return <div>Loading...</div>;
	}

	return (
		<div className="min-h-screen max-w-full bg-gray-900 text-gray-100">
			<Head>
				<title>
					Debrid Media Manager - Movie - {movieInfo.title} ({movieInfo.year})
				</title>
			</Head>
			<Toaster position="bottom-right" />

			<MediaHeader
				mediaType="movie"
				imdbId={imdbid as string}
				title={movieInfo.title}
				year={movieInfo.year}
				description={movieInfo.description}
				poster={movieInfo.poster}
				backdrop={movieInfo.backdrop}
				imdbScore={movieInfo.imdb_score}
				descLimit={descLimit}
				onDescToggle={() => setDescLimit(0)}
				actionButtons={handleActionButtons()}
				trailer={movieInfo.trailer}
				additionalInfo={movieReleaseInfo}
			/>

			{searchState === 'loading' && <SearchSourceProgress sources={sourceStates} />}
			{searchState === 'processing' && (
				<div className="relative mt-4 rounded border border-blue-400 bg-blue-700 px-4 py-3 text-blue-100">
					<strong className="font-bold">Notice:</strong>
					<span className="block sm:inline">
						{' '}
						Looking for torrents in the dark web. Please wait for 1-2 minutes.
					</span>
				</div>
			)}
			{errorMessage && (
				<div className="relative mt-4 rounded border border-red-400 bg-red-900 px-4 py-3">
					<strong className="font-bold">Error:</strong>
					<span className="block sm:inline"> {errorMessage}</span>
				</div>
			)}

			<SearchControls
				query={query}
				onQueryChange={setQuery}
				filteredCount={
					filteredResults.filter(
						(r) => r.rdAvailable || r.adAvailable || r.tbAvailable || r.pmAvailable
					).length
				}
				totalCount={filteredResults.length}
				showMassReportButtons={showMassReportButtons}
				rdKey={rdKey}
				adKey={adKey}
				torboxKey={torboxKey}
				premiumizeKey={premiumizeKey}
				onMassReport={(type) => handleMassReport(type, filteredResults)}
				mediaType="movie"
				title={movieInfo.title}
				year={movieInfo.year}
				colorScales={getColorScale()}
				getQueryForScale={getQueryForMovieCount}
				extraTokens={
					movieInfo.digitalReleaseAvailable
						? [
								{
									label: 'Quality releases',
									query: 'web.?dl|web.?rip|blu.?ray|remux|dovi|hdr10|2160p',
								},
							]
						: undefined
				}
			/>

			<UsenetResults imdbId={imdbid as string} rdKey={rdKey} />

			{searchResults.length > 0 && (
				<>
					<MovieSearchResults
						filteredResults={filteredResults}
						onlyShowCached={onlyShowCached}
						movieMaxSize={movieMaxSize}
						rdKey={rdKey}
						adKey={adKey}
						torboxKey={torboxKey}
						premiumizeKey={premiumizeKey}
						player={player}
						hashAndProgress={hashAndProgress}
						handleShowInfo={handleShowInfo}
						handleCast={handleCast}
						handleCastTorBox={torboxKey ? handleCastTorBox : undefined}
						handleCastAllDebrid={adKey ? handleCastAllDebrid : undefined}
						handleCastPremiumize={premiumizeKey ? handleCastPremiumize : undefined}
						handleCopyMagnet={(hash) =>
							handleCopyOrDownloadMagnet(hash, shouldDownloadMagnets)
						}
						checkServiceAvailability={checkServiceAvailability}
						addRd={addRd}
						addAd={addAd}
						addTb={addTb}
						addPm={addPm}
						sendTbToRd={sendTbToRd}
						sendAdToRd={sendAdToRd}
						deleteRd={deleteRd}
						deleteAd={deleteAd}
						deleteTb={deleteTb}
						deletePm={deletePm}
						imdbId={imdbid as string}
						isHashServiceChecking={isHashServiceChecking}
					/>

					{searchResults.length > 0 && searchState === 'loaded' && hasMoreResults && (
						<button
							className="my-4 w-full rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 font-medium text-gray-100 shadow-md transition-colors duration-200 hover:bg-gray-700/50 hover:shadow-lg"
							onClick={() => {
								setCurrentPage((prev) => prev + 1);
								fetchData(imdbid as string, currentPage + 1);
							}}
						>
							Show More Results
						</button>
					)}
				</>
			)}
		</div>
	);
};

export default withAuth(MovieSearch);
