import Poster from '@/components/poster';
import { showInfoForRD } from '@/components/showInfo';
import { showSubscribeModal } from '@/components/subscribe';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useCastToken } from '@/hooks/cast';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd, handleCopyMagnet } from '@/utils/addMagnet';
import { handleCastMovie } from '@/utils/cast';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid } from '@/utils/fetchTorrents';
import { instantCheckInAd, instantCheckInRd, wrapLoading } from '@/utils/instantChecks';
import { applyQuickSearch2 } from '@/utils/quickSearch';
import { borderColor, btnColor, btnIcon, btnLabel, fileSize, sortByBiggest } from '@/utils/results';
import { isVideo } from '@/utils/selectable';
import { defaultMovieSize, defaultPlayer } from '@/utils/settings';
import { castToastOptions, searchToastOptions } from '@/utils/toastOptions';
import { generateTokenAndHash } from '@/utils/token';
import { withAuth } from '@/utils/withAuth';
import axios from 'axios';
import getConfig from 'next/config';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { FaMagnet, FaTimes } from 'react-icons/fa';

type MovieInfo = {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	year: string;
	imdb_score: number;
};

const torrentDB = new UserTorrentDB();

// Update the getColorScale function with proper Tailwind color classes
const getColorScale = () => {
	const scale = [
		{ threshold: 1, color: 'gray-800', label: 'Single' },
		{ threshold: Infinity, color: 'blue-900', label: 'With extras' },
	];
	return scale;
};

// Add this helper function near the other utility functions at the top
const getQueryForMovieCount = (videoCount: number) => {
	if (videoCount === 1) return 'videos:1'; // Single episode
	return `videos:>1`; // With extras
};

// Modify the getMovieCountClass function to consider availability
const getMovieCountClass = (videoCount: number, isInstantlyAvailable: boolean) => {
	if (!isInstantlyAvailable) return ''; // No color for unavailable torrents
	const scale = getColorScale();
	for (let i = 0; i < scale.length; i++) {
		if (videoCount <= scale[i].threshold) {
			return `bg-${scale[i].color}`;
		}
	}
	return `bg-${scale[scale.length - 1].color}`;
};

const getMovieCountLabel = (videoCount: number) => {
	if (videoCount === 1) return `Single`;
	return `With extras (${videoCount})`;
};

const MovieSearch: FunctionComponent = () => {
	const router = useRouter();
	const { imdbid } = router.query;
	const [movieInfo, setMovieInfo] = useState<MovieInfo>({
		title: '',
		description: '',
		poster: '',
		backdrop: '',
		year: '',
		imdb_score: 0,
	});

	const player = window.localStorage.getItem('settings:player') || defaultPlayer;
	const movieMaxSize = window.localStorage.getItem('settings:movieMaxSize') || defaultMovieSize;
	const onlyTrustedTorrents =
		window.localStorage.getItem('settings:onlyTrustedTorrents') === 'true';
	const defaultTorrentsFilter =
		window.localStorage.getItem('settings:defaultTorrentsFilter') ?? '';
	const { publicRuntimeConfig: config } = getConfig();
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [filteredResults, setFilteredResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const [query, setQuery] = useState(defaultTorrentsFilter);
	const [descLimit, setDescLimit] = useState(100);
	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [onlyShowCached, setOnlyShowCached] = useState<boolean>(true);
	const [totalUncachedCount, setTotalUncachedCount] = useState<number>(0);
	const dmmCastToken = useCastToken();
	const [currentPage, setCurrentPage] = useState(0);
	const [hasMoreResults, setHasMoreResults] = useState(true);

	useEffect(() => {
		if (!imdbid) return;

		const fetchMovieInfo = async () => {
			try {
				const response = await axios.get(`/api/info/movie?imdbid=${imdbid}`);
				setMovieInfo(response.data);
			} catch (error) {
				console.error('Failed to fetch movie info:', error);
			}
		};

		fetchMovieInfo();
	}, [imdbid]);

	async function initialize() {
		await torrentDB.initializeDB();
		await Promise.all([fetchData(imdbid as string), fetchHashAndProgress()]);
	}

	useEffect(() => {
		if (!imdbid) return;
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid]);

	async function fetchData(imdbId: string, page: number = 0) {
		const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
		if (page === 0) {
			setSearchResults([]);
			setTotalUncachedCount(0);
		}
		setErrorMessage('');
		setSearchState('loading');
		try {
			let path = `api/torrents/movie?imdbId=${imdbId}&dmmProblemKey=${tokenWithTimestamp}&solution=${tokenHash}&onlyTrusted=${onlyTrustedTorrents}&maxSize=${movieMaxSize}&page=${page}`;
			if (config.externalSearchApiHostname) {
				path = encodeURIComponent(path);
			}
			let endpoint = `${config.externalSearchApiHostname || ''}/${path}`;
			const response = await axios.get<SearchApiResponse>(endpoint);
			if (response.status !== 200) {
				setSearchState(response.headers.status ?? 'loaded');
				return;
			}

			if (response.data.results?.length) {
				const results = response.data.results;
				setSearchResults((prevResults) => {
					const newResults = [
						...prevResults,
						...results.map((r) => ({
							...r,
							rdAvailable: false,
							adAvailable: false,
							noVideos: false,
							files: [],
						})),
					];
					// Sort function that prioritizes instant availability
					return newResults.sort((a, b) => {
						const aAvailable = a.rdAvailable || a.adAvailable;
						const bAvailable = b.rdAvailable || b.adAvailable;
						if (aAvailable !== bAvailable) {
							return aAvailable ? -1 : 1;
						}
						return b.fileSize - a.fileSize;
					});
				});
				setHasMoreResults(results.length > 0);
				toast(`Found ${results.length} results`, searchToastOptions);

				// instant checks
				const hashArr = results.map((r) => r.hash);
				const instantChecks = [];
				if (rdKey)
					instantChecks.push(
						wrapLoading(
							'RD',
							instantCheckInRd(rdKey, hashArr, setSearchResults, sortByBiggest)
						)
					);
				if (adKey)
					instantChecks.push(
						wrapLoading(
							'AD',
							instantCheckInAd(adKey, hashArr, setSearchResults, sortByBiggest)
						)
					);
				const counts = await Promise.all(instantChecks);
				setSearchState('loaded');
				const newUncachedCount = hashArr.length - counts.reduce((acc, cur) => acc + cur, 0);
				setTotalUncachedCount((prev) => prev + newUncachedCount);
			} else {
				if (page === 0) {
					setSearchResults([]);
				}
				setHasMoreResults(false);
				toast(`No${page === 0 ? '' : ' more'} results found`, searchToastOptions);
			}
		} catch (error) {
			console.error(error);
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
		} finally {
			setSearchState('loaded');
		}
	}

	useEffect(() => {
		if (searchResults.length === 0) return;
		const filteredResults = applyQuickSearch2(query, searchResults);
		setFilteredResults(filteredResults);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, searchResults]);

	const [hashAndProgress, setHashAndProgress] = useState<Record<string, number>>({});
	async function fetchHashAndProgress(hash?: string) {
		const torrents = await torrentDB.all();
		const records: Record<string, number> = {};
		for (const t of torrents) {
			if (hash && t.hash !== hash) continue;
			records[`${t.id.substring(0, 3)}${t.hash}`] = t.progress;
		}
		setHashAndProgress((prev) => ({ ...prev, ...records }));
	}
	const isDownloading = (service: string, hash: string) =>
		`${service}:${hash}` in hashAndProgress && hashAndProgress[`${service}:${hash}`] < 100;
	const isDownloaded = (service: string, hash: string) =>
		`${service}:${hash}` in hashAndProgress && hashAndProgress[`${service}:${hash}`] === 100;
	const inLibrary = (service: string, hash: string) => `${service}:${hash}` in hashAndProgress;
	const notInLibrary = (service: string, hash: string) =>
		!(`${service}:${hash}` in hashAndProgress);

	async function addRd(hash: string) {
		await handleAddAsMagnetInRd(rdKey!, hash);
		await fetchRealDebrid(
			rdKey!,
			async (torrents) => {
				await torrentDB.addAll(torrents);
				await fetchHashAndProgress(hash);
			},
			2
		);
	}

	async function addAd(hash: string) {
		await handleAddAsMagnetInAd(adKey!, hash);
		await fetchAllDebrid(
			adKey!,
			async (torrents: UserTorrent[]) => await torrentDB.addAll(torrents)
		);
		await fetchHashAndProgress();
	}

	async function deleteRd(hash: string) {
		const torrents = await torrentDB.getAllByHash(hash);
		for (const t of torrents) {
			if (!t.id.startsWith('rd:')) continue;
			await handleDeleteRdTorrent(rdKey!, t.id);
			await torrentDB.deleteByHash('rd', hash);
			setHashAndProgress((prev) => {
				const newHashAndProgress = { ...prev };
				delete newHashAndProgress[`rd:${hash}`];
				return newHashAndProgress;
			});
		}
	}

	async function deleteAd(hash: string) {
		const torrents = await torrentDB.getAllByHash(hash);
		for (const t of torrents) {
			if (!t.id.startsWith('ad:')) continue;
			await handleDeleteAdTorrent(adKey!, t.id);
			await torrentDB.deleteByHash('ad', hash);
			setHashAndProgress((prev) => {
				const newHashAndProgress = { ...prev };
				delete newHashAndProgress[`ad:${hash}`];
				return newHashAndProgress;
			});
		}
	}

	const backdropStyle = {
		backgroundImage: `linear-gradient(to bottom, hsl(0, 0%, 12%,0.5) 0%, hsl(0, 0%, 12%,0) 50%, hsl(0, 0%, 12%,0.5) 100%), url(${movieInfo.backdrop})`,
		backgroundPosition: 'center',
		backgroundSize: 'screen',
	};

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
			/// extras
			host: '',
			split: 0,
			status: '',
			added: '',
			ended: '',
			speed: 0,
			seeders: 0,
		} as TorrentInfoResponse;
		rdKey && showInfoForRD(player, rdKey, info, dmmCastToken ?? '', imdbid as string, 'movie');
	};

	async function handleCast(hash: string) {
		await toast.promise(
			handleCastMovie(dmmCastToken!, imdbid as string, rdKey!, hash),
			{
				loading: 'Casting...',
				success: 'Casting successful',
				error: 'Casting failed',
			},
			castToastOptions
		);
	}

	const getFirstAvailableRdTorrent = () => {
		return searchResults.find((r) => r.rdAvailable && !r.noVideos);
	};

	const getBiggestFileId = (result: SearchResult) => {
		if (!result.files || !result.files.length) return '';
		const biggestFile = result.files
			.filter((f) => isVideo({ path: f.filename }))
			.sort((a, b) => b.filesize - a.filesize)[0];
		return biggestFile?.fileId ?? '';
	};

	if (!movieInfo.title) {
		return <div>Loading...</div>;
	}

	return (
		<div className="max-w-full bg-gray-900 min-h-screen text-gray-100">
			<Head>
				<title>
					Debrid Media Manager - Movie - {movieInfo.title} ({movieInfo.year})
				</title>
			</Head>
			<Toaster position="bottom-right" />
			{/* Display basic movie info */}
			<div
				className="grid grid-flow-col auto-cols-auto auto-rows-auto gap-2"
				style={backdropStyle}
			>
				{(movieInfo.poster && (
					<Image
						width={200}
						height={300}
						src={movieInfo.poster}
						alt="Movie poster"
						className="shadow-lg row-span-5"
					/>
				)) || <Poster imdbId={imdbid as string} title={movieInfo.title} />}
				<div className="flex justify-end p-2">
					<Link
						href="/"
						className="w-fit h-fit text-sm border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50 py-1 px-2 rounded transition-colors"
					>
						Go Home
					</Link>
				</div>
				<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
					{movieInfo.title} ({movieInfo.year})
				</h2>
				<div className="w-fit h-fit bg-slate-900/75" onClick={() => setDescLimit(0)}>
					{descLimit > 0
						? movieInfo.description.substring(0, descLimit) + '..'
						: movieInfo.description}{' '}
					{movieInfo.imdb_score > 0 && (
						<div className="text-yellow-100 inline">
							<Link href={`https://www.imdb.com/title/${imdbid}/`} target="_blank">
								IMDB Score:{' '}
								{movieInfo.imdb_score < 10
									? movieInfo.imdb_score
									: movieInfo.imdb_score / 10}
							</Link>
						</div>
					)}
				</div>
				<div>
					<button
						className="mr-2 mt-0 mb-1 border-2 border-rose-500 bg-rose-900/30 text-rose-100 hover:bg-rose-800/50 p-1 text-xs rounded transition-colors"
						onClick={() => {
							showSubscribeModal();
						}}
					>
						🔔Subscribe
					</button>
					{rdKey && getFirstAvailableRdTorrent() && (
						<button
							className="mr-2 mt-0 mb-1 border-2 border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50 p-1 text-xs rounded transition-colors"
							onClick={() => addRd(getFirstAvailableRdTorrent()!.hash)}
						>
							<b>⚡Instant RD</b>
						</button>
					)}
					{rdKey && player && getFirstAvailableRdTorrent() && (
						<button
							className="mr-2 mt-0 mb-1 border-2 border-teal-500 bg-teal-900/30 text-teal-100 hover:bg-teal-800/50 p-1 text-xs rounded transition-colors"
							onClick={() =>
								window.open(
									`/api/watch/instant/${player}?token=${rdKey}&hash=${getFirstAvailableRdTorrent()!.hash}&fileId=${getBiggestFileId(getFirstAvailableRdTorrent()!)}`
								)
							}
						>
							<b>🧐Watch</b>
						</button>
					)}
					{rdKey && dmmCastToken && getFirstAvailableRdTorrent() && (
						<button
							className="mr-2 mt-0 mb-1 border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 p-1 text-xs rounded transition-colors"
							onClick={() => handleCast(getFirstAvailableRdTorrent()!.hash)}
						>
							<b>Cast✨</b>
						</button>
					)}
					{onlyShowCached && totalUncachedCount > 0 && (
						<button
							className="mr-2 mt-0 mb-1 border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 p-1 text-xs rounded transition-colors"
							onClick={() => {
								setOnlyShowCached(false);
							}}
						>
							Show {totalUncachedCount} uncached
						</button>
					)}
				</div>
			</div>

			{searchState === 'loading' && (
				<div className="flex justify-center items-center bg-black">Loading...</div>
			)}
			{searchState === 'requested' && (
				<div className="mt-4 bg-yellow-500 border border-yellow-400 text-yellow-900 px-4 py-3 rounded relative">
					<strong className="font-bold">Notice:</strong>
					<span className="block sm:inline">
						{' '}
						The request has been received. This might take at least 5 minutes.
					</span>
				</div>
			)}
			{searchState === 'processing' && (
				<div className="mt-4 bg-blue-700 border border-blue-400 text-blue-100 px-4 py-3 rounded relative">
					<strong className="font-bold">Notice:</strong>
					<span className="block sm:inline">
						{' '}
						Looking for torrents in the dark web. Please wait for 1-2 minutes.
					</span>
				</div>
			)}
			{errorMessage && (
				<div className="mt-4 bg-red-900 border border-red-400 px-4 py-3 rounded relative">
					<strong className="font-bold">Error:</strong>
					<span className="block sm:inline"> {errorMessage}</span>
				</div>
			)}
			<div className="flex items-center border-b-2 border-gray-600 py-2 mb-1">
				<input
					className="appearance-none bg-transparent border-none w-full text-sm text-gray-100 mr-3 py-1 px-2 leading-tight focus:outline-none"
					type="text"
					id="query"
					placeholder="filter results, supports regex"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value.toLocaleLowerCase());
					}}
				/>
				<span
					className="bg-yellow-100 text-yellow-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded dark:bg-yellow-900 dark:text-yellow-300 cursor-pointer"
					onClick={() => setQuery('')}
				>
					Reset
				</span>
			</div>
			<div className="flex items-center gap-2 p-2 mb-2 overflow-x-auto">
				{getColorScale().map((scale, idx) => (
					<span
						key={idx}
						className={`bg-${scale.color} text-white text-xs px-2 py-1 rounded whitespace-nowrap cursor-pointer`}
						onClick={() => {
							const queryText = getQueryForMovieCount(scale.threshold);
							setQuery((prev) => {
								const cleanedPrev = prev.replace(/\bvideos:[^\s]+/g, '').trim();
								return cleanedPrev ? `${cleanedPrev} ${queryText}` : queryText;
							});
						}}
					>
						{scale.label}
					</span>
				))}
			</div>
			{searchResults.length > 0 && (
				<>
					<div className="mx-1 my-1 overflow-x-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
						{filteredResults.map((r: SearchResult, i: number) => {
							const downloaded =
								isDownloaded('rd', r.hash) || isDownloaded('ad', r.hash);
							const downloading =
								isDownloading('rd', r.hash) || isDownloading('ad', r.hash);
							const inYourLibrary = downloaded || downloading;
							if (
								onlyShowCached &&
								!r.rdAvailable &&
								!r.adAvailable &&
								!inYourLibrary
							)
								return;
							if (
								movieMaxSize !== '0' &&
								(r.biggestFileSize ?? r.fileSize) > parseInt(movieMaxSize) * 1024 &&
								!inYourLibrary
							)
								return;
							const rdColor = btnColor(r.rdAvailable, r.noVideos);
							const adColor = btnColor(r.adAvailable, r.noVideos);
							return (
								<div
									key={i}
									className={`
                                        border-2 border-gray-700 
                                        ${borderColor(downloaded, downloading)}
                                        ${getMovieCountClass(r.videoCount, r.rdAvailable || r.adAvailable)}
                                        shadow hover:shadow-lg 
                                        transition-shadow duration-200 ease-in 
                                        rounded-lg overflow-hidden 
                                        bg-opacity-30
                                    `}
								>
									<div className="p-1 space-y-2">
										<h2 className="text-sm font-bold leading-tight break-words line-clamp-2 overflow-hidden text-ellipsis">
											{r.title}
										</h2>

										{r.videoCount > 0 ? (
											<div className="text-gray-300 text-xs">
												<span
													className="inline-block px-2 py-1 rounded bg-opacity-50 bg-black cursor-pointer hover:bg-opacity-75 haptic-sm haptic-sm"
													onClick={() => handleShowInfo(r)}
												>
													📂&nbsp;{getMovieCountLabel(r.videoCount)}
												</span>
												{r.videoCount > 1 ? (
													<span className="ml-2">
														Total: {fileSize(r.fileSize)} GB; Biggest:{' '}
														{fileSize(r.biggestFileSize)} GB
													</span>
												) : (
													<span className="ml-2">
														Total: {fileSize(r.fileSize)} GB
													</span>
												)}
											</div>
										) : (
											<div className="text-gray-300 text-xs">
												Total: {fileSize(r.fileSize)} GB
											</div>
										)}

										<div className="space-x-1 space-y-1">
											{/* RD */}
											{rdKey && inLibrary('rd', r.hash) && (
												<button
													className="border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
													onClick={() => deleteRd(r.hash)}
												>
													<FaTimes className="mr-2 inline" />
													RD ({hashAndProgress[`rd:${r.hash}`] + '%'})
												</button>
											)}
											{rdKey && notInLibrary('rd', r.hash) && (
												<button
													className={`border-2 border-${rdColor}-500 bg-${rdColor}-900/30 text-${rdColor}-100 hover:bg-${rdColor}-800/50 text-xs rounded inline px-1 transition-colors haptic-sm`}
													onClick={() => addRd(r.hash)}
												>
													{btnIcon(r.rdAvailable)}
													{btnLabel(r.rdAvailable, 'RD')}
												</button>
											)}

											{/* AD */}
											{adKey && inLibrary('ad', r.hash) && (
												<button
													className="border-2 border-red-500 bg-red-900/30 text-red-100 hover:bg-red-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
													onClick={() => deleteAd(r.hash)}
												>
													<FaTimes className="mr-2 inline" />
													AD ({hashAndProgress[`ad:${r.hash}`] + '%'})
												</button>
											)}
											{adKey && notInLibrary('ad', r.hash) && (
												<button
													className={`border-2 border-${adColor}-500 bg-${adColor}-900/30 text-${adColor}-100 hover:bg-${adColor}-800/50 text-xs rounded inline px-1 transition-colors haptic-sm`}
													onClick={() => addAd(r.hash)}
												>
													{btnIcon(r.adAvailable)}
													{btnLabel(r.adAvailable, 'AD')}
												</button>
											)}

											{(r.rdAvailable || r.adAvailable) && (
												<>
													{r.rdAvailable && player && (
														<button
															className="border-2 border-teal-500 bg-teal-900/30 text-teal-100 hover:bg-teal-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
															onClick={() =>
																window.open(
																	`/api/watch/instant/${player}?token=${rdKey}&hash=${r.hash}&fileId=${getBiggestFileId(r)}`
																)
															}
														>
															🧐Watch
														</button>
													)}
												</>
											)}

											{rdKey && dmmCastToken && (
												<button
													className="border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
													onClick={() => handleCast(r.hash)}
												>
													Cast✨
												</button>
											)}

											<button
												className="border-2 border-pink-500 bg-pink-900/30 text-pink-100 hover:bg-pink-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
												onClick={() => handleCopyMagnet(r.hash)}
											>
												<FaMagnet className="inline" /> Magnet
											</button>
										</div>
									</div>
								</div>
							);
						})}
					</div>

					{searchResults.length > 0 && searchState === 'loaded' && hasMoreResults && (
						<button
							className="w-full border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 py-2 px-4 my-4 rounded transition-colors duration-200 shadow-md hover:shadow-lg font-medium"
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
