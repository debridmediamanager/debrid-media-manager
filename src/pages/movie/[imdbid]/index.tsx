import MediaHeader from '@/components/MediaHeader';
import MovieSearchResults from '@/components/MovieSearchResults';
import SearchControls from '@/components/SearchControls';
import { showInfoForRD } from '@/components/showInfo';
import { useLibraryCache } from '@/contexts/LibraryCacheContext';
import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import { useAvailabilityCheck } from '@/hooks/useAvailabilityCheck';
import { useExternalSources } from '@/hooks/useExternalSources';
import { useMassReport } from '@/hooks/useMassReport';
import { useTorrentManagement } from '@/hooks/useTorrentManagement';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { handleCastMovieAllDebrid } from '@/utils/allDebridCastApiClient';
import axiosWithRetry from '@/utils/axiosWithRetry';
import { getLocalStorageBoolean, getLocalStorageItemOrDefault } from '@/utils/browserStorage';
import { handleCastMovie } from '@/utils/castApiClient';
import { handleCopyOrDownloadMagnet } from '@/utils/copyMagnet';
import {
	checkDatabaseAvailabilityAd,
	checkDatabaseAvailabilityRd,
	checkDatabaseAvailabilityTb,
} from '@/utils/instantChecks';
import { quickSearch } from '@/utils/quickSearch';
import { sortByBiggest } from '@/utils/results';
import { isVideo } from '@/utils/selectable';
import {
	defaultTorrentsFilter as defaultFilterSetting,
	defaultMovieSize,
	defaultPlayer,
} from '@/utils/settings';
import { castToastOptions, searchToastOptions } from '@/utils/toastOptions';
import { generateTokenAndHash } from '@/utils/token';
import { handleCastMovieTorBox } from '@/utils/torboxCastApiClient';
import { getMultipleTrackerStats } from '@/utils/trackerStats';
import { withAuth } from '@/utils/withAuth';
import { Cast, CloudOff, Eye as EyeIcon, Loader2, Search, Sparkles, Zap } from 'lucide-react';
import getConfig from 'next/config';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useMemo, useRef, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';

type MovieInfo = {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	year: string;
	imdb_score: number;
	trailer: string;
};

const torrentDB = new UserTorrentDB();

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

	const [movieInfo, setMovieInfo] = useState<MovieInfo>({
		title: '',
		description: '',
		poster: '',
		backdrop: '',
		year: '',
		imdb_score: 0,
		trailer: '',
	});

	// Settings
	const player = getLocalStorageItemOrDefault('settings:player', defaultPlayer);
	const movieMaxSize = getLocalStorageItemOrDefault('settings:movieMaxSize', defaultMovieSize);
	const onlyTrustedTorrents = getLocalStorageBoolean('settings:onlyTrustedTorrents', false);
	const defaultTorrentsFilter = getLocalStorageItemOrDefault(
		'settings:defaultTorrentsFilter',
		defaultFilterSetting
	);
	const { publicRuntimeConfig: config } = getConfig();

	// State
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const [query, setQuery] = useState(defaultTorrentsFilter);
	const [descLimit, setDescLimit] = useState(100);
	const [onlyShowCached, setOnlyShowCached] = useState<boolean>(false);
	const [currentPage, setCurrentPage] = useState(0);
	const [hasMoreResults, setHasMoreResults] = useState(true);
	const [searchCompleteInfo, setSearchCompleteInfo] = useState<{
		finalResults: number;
		totalAvailableCount: number;
		rdAvailableCount?: number;
		adAvailableCount?: number;
		tbAvailableCount?: number;
		allSourcesCompleted: boolean;
		pendingAvailabilityChecks: number;
		isAvailabilityOnly?: boolean;
	} | null>(null);

	// Auth keys
	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const torboxKey = useTorBoxAccessToken();

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
		deleteRd,
		deleteAd,
		deleteTb,
	} = useTorrentManagement(
		rdKey,
		adKey,
		torboxKey,
		imdbid as string,
		searchResults,
		setSearchResults
	);

	const { fetchMovieFromExternalSource, getEnabledSources } = useExternalSources(rdKey);

	const {
		isAnyChecking,
		isHashServiceChecking,
		checkServiceAvailability,
		checkServiceAvailabilityBulk,
	} = useAvailabilityCheck(
		rdKey,
		adKey,
		torboxKey,
		imdbid as string,
		searchResults,
		setSearchResults,
		hashAndProgress,
		addRd,
		addAd,
		addTb,
		deleteRd,
		deleteAd,
		deleteTb,
		sortByBiggest
	);

	const { handleMassReport } = useMassReport(rdKey, adKey, torboxKey, imdbid as string);

	// Fetch movie info
	useEffect(() => {
		if (!imdbid) return;

		const fetchMovieInfo = async () => {
			try {
				const response = await axiosWithRetry.get(`/api/info/movie?imdbid=${imdbid}`);
				setMovieInfo(response.data);
			} catch (error) {
				console.error('Failed to fetch movie info:', error);
			}
		};

		fetchMovieInfo();
	}, [imdbid]);

	// Initialize data
	useEffect(() => {
		if (!imdbid) return;

		const initializeData = async () => {
			await torrentDB.initializeDB();
			await Promise.all([fetchData(imdbid as string), fetchHashAndProgress()]);
		};

		initializeData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid, fetchHashAndProgress]);

	useEffect(() => {
		return () => {
			isMounted.current = false;
		};
	}, []);

	// Load cached tracker stats
	useEffect(() => {
		async function loadCachedTrackerStats() {
			const uncachedResults = searchResults.filter(
				(r) => !r.rdAvailable && !r.adAvailable && !r.tbAvailable && !r.trackerStats
			);

			if (uncachedResults.length === 0) return;

			try {
				const hashes = uncachedResults.map((r) => r.hash);
				const trackerStatsArray = await getMultipleTrackerStats(hashes);

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

		if (
			searchState === 'loaded' &&
			searchResults.length > 0 &&
			!hasLoadedTrackerStats.current
		) {
			loadCachedTrackerStats();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchState]);

	// Reset tracker stats flag when search changes
	useEffect(() => {
		hasLoadedTrackerStats.current = false;
	}, [imdbid]);

	async function fetchData(imdbId: string, page: number = 0) {
		const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
		if (page === 0) {
			setSearchResults([]);
		}
		setErrorMessage('');
		setSearchState('loading');

		let completedSources = 0;
		let totalSources = 1; // DMM
		const allSourcesResults: SearchResult[][] = [];
		let rdAvailableCount = 0;
		let adAvailableCount = 0;
		let tbAvailableCount = 0;
		let pendingAvailabilityChecks = 0;
		let allSourcesCompleted = false;
		let finalResultCount = 0;
		let toastShown = false;

		// Helper to check if everything is done and show toast only once
		const checkAndShowFinalToast = () => {
			if (toastShown) return;
			if (!allSourcesCompleted || pendingAvailabilityChecks > 0) return;

			toastShown = true;
			setSearchCompleteInfo({
				finalResults: finalResultCount,
				totalAvailableCount: rdAvailableCount + adAvailableCount + tbAvailableCount,
				rdAvailableCount,
				adAvailableCount,
				tbAvailableCount,
				allSourcesCompleted: true,
				pendingAvailabilityChecks: 0,
			});
		};

		const titleStartsWithYear = /^\d{4}\b/.test(movieInfo.title);

		const processSourceResults = async (sourceResults: SearchResult[], sourceName: string) => {
			if (!isMounted.current) return;

			setSearchResults((prevResults) => {
				const existingHashes = new Set(prevResults.map((r) => r.hash));
				const newUniqueResults = sourceResults.filter(
					(r) =>
						r.hash &&
						!existingHashes.has(r.hash) &&
						(titleStartsWithYear || !/^\d{4}\)/.test(r.title))
				);

				if (newUniqueResults.length === 0) {
					completedSources++;
					if (completedSources === totalSources) {
						allSourcesCompleted = true;
						finalResultCount = prevResults.length;
						setSearchState('loaded');
						checkAndShowFinalToast();
					}
					return prevResults;
				}

				allSourcesResults.push(newUniqueResults);

				const merged = [...prevResults, ...newUniqueResults];
				const sorted = merged.sort((a, b) => {
					const aAvailable = a.rdAvailable || a.adAvailable;
					const bAvailable = b.rdAvailable || b.adAvailable;
					if (aAvailable !== bAvailable) {
						return aAvailable ? -1 : 1;
					}
					if (a.fileSize !== b.fileSize) {
						return b.fileSize - a.fileSize;
					}
					return a.hash.localeCompare(b.hash);
				});

				const nonCachedNew = newUniqueResults.filter(
					(r) => !r.rdAvailable && !r.adAvailable && !r.tbAvailable
				);

				completedSources++;

				if (nonCachedNew.length > 0) {
					const hashArr = nonCachedNew.map((r) => r.hash);

					// Check RD database for cached availability
					if (rdKey) {
						pendingAvailabilityChecks++;

						(async () => {
							const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
							const count = await checkDatabaseAvailabilityRd(
								tokenWithTimestamp,
								tokenHash,
								imdbId,
								hashArr,
								setSearchResults,
								sortByBiggest
							);
							rdAvailableCount += count;
							pendingAvailabilityChecks--;
							checkAndShowFinalToast();
						})();
					}

					// Check AllDebrid database for cached availability
					if (adKey) {
						pendingAvailabilityChecks++;

						(async () => {
							const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
							const count = await checkDatabaseAvailabilityAd(
								tokenWithTimestamp,
								tokenHash,
								imdbId,
								hashArr,
								setSearchResults,
								sortByBiggest
							);
							adAvailableCount += count;
							pendingAvailabilityChecks--;
							checkAndShowFinalToast();
						})();
					}

					// Check TorBox database for cached availability
					if (torboxKey) {
						pendingAvailabilityChecks++;

						(async () => {
							const count = await checkDatabaseAvailabilityTb(
								torboxKey,
								hashArr,
								setSearchResults,
								sortByBiggest
							);
							tbAvailableCount += count;
							pendingAvailabilityChecks--;
							checkAndShowFinalToast();
						})();
					}
				}

				if (completedSources === totalSources) {
					allSourcesCompleted = true;
					finalResultCount = sorted.length;
					setSearchState('loaded');
					checkAndShowFinalToast();
				}

				return sorted;
			});
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
					setSearchState(response.headers.status ?? 'loaded');
					return [];
				}

				return response.data.results || [];
			})();

			// Check enabled sources and start external fetches
			if (page === 0) {
				const enabledSources = getEnabledSources();
				totalSources += enabledSources.length;

				// Start all external fetches simultaneously
				enabledSources.forEach((source) => {
					fetchMovieFromExternalSource(imdbId, source)
						.then((results) => processSourceResults(results, source))
						.catch((err) => {
							console.error(`${source} error:`, err);
							completedSources++;
							if (completedSources === totalSources) {
								allSourcesCompleted = true;
								setSearchResults((prevResults) => {
									finalResultCount = prevResults.length;
									setSearchState('loaded');
									checkAndShowFinalToast();
									return prevResults;
								});
							}
						});
				});
			}

			// Process DMM results
			const dmmResults = await dmmPromise;
			setHasMoreResults(dmmResults.length > 0);

			const formattedDmmResults = dmmResults.map((r) => ({
				...r,
				rdAvailable: false,
				adAvailable: false,
				tbAvailable: false,
				noVideos: false,
				files: r.files || [],
			}));
			await processSourceResults(formattedDmmResults, 'DMM');
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
			setSearchState('loaded');
		}
	}

	// Derive filtered results and uncached count using useMemo to prevent setState during render
	const filteredResults = useMemo(() => {
		if (searchResults.length === 0) {
			return [];
		}
		return quickSearch(query, searchResults);
	}, [query, searchResults]);

	const totalUncachedCount = useMemo(() => {
		return filteredResults.filter((r) => !r.rdAvailable && !r.adAvailable && !r.tbAvailable)
			.length;
	}, [filteredResults]);

	// Handle toast notifications when search completes
	useEffect(() => {
		if (!searchCompleteInfo) return;

		const {
			finalResults,
			totalAvailableCount,
			rdAvailableCount,
			adAvailableCount,
			tbAvailableCount,
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
		isAnyChecking,
		isLibrarySyncing,
		checkServiceAvailabilityBulk,
		filteredResults,
		imdbid,
	]);

	const handleShowInfo = (result: SearchResult) => {
		let files = result.files
			.filter((file) => isVideo({ path: file.filename }))
			.map((file) => ({
				id: file.fileId,
				path: file.filename,
				bytes: file.filesize,
				selected: 1,
			}));
		files.sort();
		const info = {
			id: '',
			filename: result.title,
			original_filename: result.title,
			hash: result.hash,
			bytes: result.fileSize * 1024 * 1024,
			original_bytes: result.fileSize,
			progress: 100,
			files,
			links: [],
			fake: true,
			host: '',
			split: 0,
			status: 'downloaded',
			added: '',
			ended: '',
			speed: 0,
			seeders: 0,
		} as TorrentInfoResponse;
		rdKey &&
			showInfoForRD(player, rdKey, info, imdbid as string, 'movie', shouldDownloadMagnets);
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
		window.open(`stremio://detail/movie/${imdbid}/${imdbid}`);
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
		window.open(`stremio://detail/movie/${imdbid}/${imdbid}`);
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
		window.open(`stremio://detail/movie/${imdbid}/${imdbid}`);
	}

	const getFirstAvailableRdTorrent = () => {
		return filteredResults.find((r) => r.rdAvailable && !r.noVideos);
	};

	const getBiggestFileId = (result: SearchResult) => {
		if (!result.files || !result.files.length) return '';
		const biggestFile = result.files
			.filter((f) => isVideo({ path: f.filename }))
			.sort((a, b) => b.filesize - a.filesize)[0];
		return biggestFile?.fileId ?? '';
	};

	const handleActionButtons = () => (
		<>
			{(rdKey || adKey || torboxKey) && (
				<>
					{rdKey && (
						<button
							className="mb-1 mr-2 mt-0 rounded border-2 border-yellow-500 bg-yellow-900/30 p-1 text-xs text-yellow-100 transition-colors hover:bg-yellow-800/50 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => checkServiceAvailabilityBulk(filteredResults, ['RD'])}
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
							onClick={() => checkServiceAvailabilityBulk(filteredResults, ['AD'])}
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
					{torboxKey && (
						<button
							className="mb-1 mr-2 mt-0 rounded border-2 border-cyan-500 bg-cyan-900/30 p-1 text-xs text-cyan-100 transition-colors hover:bg-cyan-800/50 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => checkServiceAvailabilityBulk(filteredResults, ['TB'])}
							disabled={isAnyChecking}
						>
							<b className="flex items-center justify-center">
								{isAnyChecking ? (
									<>
										<Loader2 className="mr-1 h-3 w-3 animate-spin text-cyan-500" />
										Checking TB...
									</>
								) : (
									<>
										<Search className="mr-1 h-3 w-3 text-cyan-500" />
										Check TB
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
								className="mb-1 mr-2 mt-0 rounded border-2 border-teal-500 bg-teal-900/30 p-1 text-xs text-teal-100 transition-colors hover:bg-teal-800/50"
								onClick={() =>
									window.open(
										`/api/watch/instant/${player}?token=${rdKey}&hash=${getFirstAvailableRdTorrent()!.hash}&fileId=${getBiggestFileId(getFirstAvailableRdTorrent()!)}`
									)
								}
							>
								<b className="flex items-center justify-center">
									<EyeIcon className="mr-1 h-3 w-3 text-teal-500" />
									Watch
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
				</>
			)}
			<button
				className="mb-1 mr-2 mt-0 rounded border-2 border-purple-500 bg-purple-900/30 p-1 text-xs text-purple-100 transition-colors hover:bg-purple-800/50"
				onClick={() => window.open(`stremio://detail/movie/${imdbid}/${imdbid}`)}
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
			/>

			{searchState === 'loading' && (
				<div className="flex items-center justify-center bg-black">Loading...</div>
			)}
			{searchState === 'requested' && (
				<div className="relative mt-4 rounded border border-yellow-400 bg-yellow-500 px-4 py-3 text-yellow-900">
					<strong className="font-bold">Notice:</strong>
					<span className="block sm:inline">
						{' '}
						The request has been received. This might take at least 5 minutes.
					</span>
				</div>
			)}
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
					filteredResults.filter((r) => r.rdAvailable || r.adAvailable || r.tbAvailable)
						.length
				}
				totalCount={filteredResults.length}
				showMassReportButtons={showMassReportButtons}
				rdKey={rdKey}
				onMassReport={(type) => handleMassReport(type, filteredResults)}
				mediaType="movie"
				title={movieInfo.title}
				year={movieInfo.year}
				colorScales={getColorScale()}
				getQueryForScale={getQueryForMovieCount}
			/>

			{searchResults.length > 0 && (
				<>
					<MovieSearchResults
						filteredResults={filteredResults}
						onlyShowCached={onlyShowCached}
						movieMaxSize={movieMaxSize}
						rdKey={rdKey}
						adKey={adKey}
						torboxKey={torboxKey}
						player={player}
						hashAndProgress={hashAndProgress}
						handleShowInfo={handleShowInfo}
						handleCast={handleCast}
						handleCastTorBox={torboxKey ? handleCastTorBox : undefined}
						handleCastAllDebrid={adKey ? handleCastAllDebrid : undefined}
						handleCopyMagnet={(hash) =>
							handleCopyOrDownloadMagnet(hash, shouldDownloadMagnets)
						}
						checkServiceAvailability={checkServiceAvailability}
						addRd={addRd}
						addAd={addAd}
						addTb={addTb}
						deleteRd={deleteRd}
						deleteAd={deleteAd}
						deleteTb={deleteTb}
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
