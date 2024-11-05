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
import { handleCastTvShow } from '@/utils/cast';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid } from '@/utils/fetchTorrents';
import { instantCheckInAd, instantCheckInRd, wrapLoading } from '@/utils/instantChecks';
import { applyQuickSearch2 } from '@/utils/quickSearch';
import { borderColor, btnColor, btnIcon, btnLabel, fileSize, sortByMedian } from '@/utils/results';
import { isVideo } from '@/utils/selectable';
import { defaultEpisodeSize, defaultPlayer } from '@/utils/settings';
import { castToastOptions, searchToastOptions } from '@/utils/toastOptions';
import { generateTokenAndHash } from '@/utils/token';
import { withAuth } from '@/utils/withAuth';
import axios, { AxiosError } from 'axios';
import { GetServerSideProps } from 'next';
import getConfig from 'next/config';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useMemo, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { FaMagnet, FaTimes } from 'react-icons/fa';
import UserAgent from 'user-agents';

type TvSearchProps = {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	season_count: number;
	season_names: string[];
	imdb_score: number;
	season_episode_counts: Record<number, number>;
};

const torrentDB = new UserTorrentDB();

// Update the getColorScale function with proper Tailwind color classes
const getColorScale = (expectedEpisodeCount: number) => {
	const scale = [
		{ threshold: 1, color: 'gray-800', label: 'Single' },
		{ threshold: expectedEpisodeCount - 1, color: 'purple-800', label: 'Incomplete' },
		{ threshold: expectedEpisodeCount, color: 'green-900', label: 'Complete' },
		{ threshold: Infinity, color: 'blue-900', label: 'With extras' },
	];
	return scale;
};

// Add this helper function near the other utility functions at the top
const getQueryForEpisodeCount = (videoCount: number, expectedEpisodeCount: number) => {
	if (videoCount === 1) return 'videos:1'; // Single episode
	if (videoCount === expectedEpisodeCount) return `videos:${expectedEpisodeCount}`; // Complete
	if (videoCount < expectedEpisodeCount) return `videos:>1 videos:<${expectedEpisodeCount}`; // Incomplete
	return `videos:>${expectedEpisodeCount}`; // With extras
};

// Modify the getEpisodeCountClass function to consider availability
const getEpisodeCountClass = (
	videoCount: number,
	expectedEpisodeCount: number,
	isInstantlyAvailable: boolean
) => {
	if (!isInstantlyAvailable) return ''; // No color for unavailable torrents
	const scale = getColorScale(expectedEpisodeCount);
	for (let i = 0; i < scale.length; i++) {
		if (videoCount <= scale[i].threshold) {
			return `bg-${scale[i].color}`;
		}
	}
	return `bg-${scale[scale.length - 1].color}`;
};

const getEpisodeCountLabel = (videoCount: number, expectedEpisodeCount: number) => {
	if (videoCount === 1) return `Single`;
	if (videoCount < expectedEpisodeCount)
		return `Incomplete (${videoCount}/${expectedEpisodeCount})`;
	if (videoCount === expectedEpisodeCount)
		return `Complete (${videoCount}/${expectedEpisodeCount})`;
	return `With extras (${videoCount}/${expectedEpisodeCount})`;
};

// Replace the direct access with a function
const getExpectedEpisodeCount = (seasonNum: string | undefined, counts: Record<number, number>) => {
	if (!seasonNum) return 13;
	const num = parseInt(seasonNum);
	return counts[num] || 13;
};

const TvSearch: FunctionComponent<TvSearchProps> = ({
	title,
	description,
	poster,
	backdrop,
	season_count,
	season_names,
	imdb_score,
	season_episode_counts,
}) => {
	const player = window.localStorage.getItem('settings:player') || defaultPlayer;
	const episodeMaxSize =
		window.localStorage.getItem('settings:episodeMaxSize') || defaultEpisodeSize;
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
	const dmmCastToken = useCastToken();
	const [currentPage, setCurrentPage] = useState(0);
	const [totalUncachedCount, setTotalUncachedCount] = useState<number>(0);
	const [hasMoreResults, setHasMoreResults] = useState(true);

	const router = useRouter();
	const { imdbid, seasonNum } = router.query;

	// Move this after router declaration and make it dynamic
	const expectedEpisodeCount = useMemo(
		() => getExpectedEpisodeCount(seasonNum as string | undefined, season_episode_counts),
		[seasonNum, season_episode_counts]
	);

	async function initialize() {
		await torrentDB.initializeDB();
		await Promise.all([
			fetchData(imdbid as string, parseInt(seasonNum as string), 0),
			fetchHashAndProgress(),
		]);
	}

	useEffect(() => {
		if (!imdbid || !seasonNum) return;
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid, seasonNum]);

	async function fetchData(imdbId: string, seasonNum: number, page: number = 0) {
		const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
		if (page === 0) {
			setSearchResults([]);
			setTotalUncachedCount(0);
		}
		setErrorMessage('');
		setSearchState('loading');
		try {
			let path = `api/torrents/tv?imdbId=${imdbId}&seasonNum=${seasonNum}&dmmProblemKey=${tokenWithTimestamp}&solution=${tokenHash}&onlyTrusted=${onlyTrustedTorrents}&maxSize=${episodeMaxSize}&page=${page}`;
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
							instantCheckInRd(rdKey, hashArr, setSearchResults, sortByMedian)
						)
					);
				if (adKey)
					instantChecks.push(
						wrapLoading(
							'AD',
							instantCheckInAd(adKey, hashArr, setSearchResults, sortByMedian)
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

	// tokens
	useEffect(() => {
		if (searchState === 'loading') return;
		const tokens = new Map<string, number>();
		// filter by cached
		const toProcess = searchResults.filter((r) => r.rdAvailable || r.adAvailable);
		toProcess.forEach((r) => {
			r.title.split(/[ .\-\[\]]/).forEach((word) => {
				if (word.length < 3) return;
				// skip if word is in title
				if (title.toLowerCase().includes(word.toLowerCase())) return;
				word = word.toLowerCase();
				if (tokens.has(word)) {
					tokens.set(word, tokens.get(word)! + 1);
				} else {
					tokens.set(word, 1);
				}
			});
		});
		// iterate through tokens
		let tokenEntries = Array.from(tokens.entries());
		// sort by count
		tokenEntries = tokenEntries.sort((a, b) => b[1] - a[1]);
		// get only the tokens
		const tokensArr = tokenEntries.map((a) => a[0].toLowerCase());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchState]);

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

	const intSeasonNum = parseInt(seasonNum as string);

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
		backgroundImage: `linear-gradient(to bottom, hsl(0, 0%, 12%,0.5) 0%, hsl(0, 0%, 12%,0) 50%, hsl(0, 0%, 12%,0.5) 100%), url(${backdrop})`,
		backgroundPosition: 'center',
		// backgroundRepeat: 'no-repeat',
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
		rdKey && showInfoForRD(player, rdKey!, info, dmmCastToken ?? '', imdbid as string, 'tv');
	};

	async function handleCast(hash: string, fileIds: string[]) {
		await toast.promise(
			handleCastTvShow(dmmCastToken!, imdbid as string, rdKey!, hash, fileIds),
			{
				loading: `Casting ${fileIds.length} episodes`,
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

	// Modify the label component to be clickable
	const EpisodeCountDisplay = ({
		result,
		videoCount,
		expectedEpisodeCount,
	}: {
		result: SearchResult;
		videoCount: number;
		expectedEpisodeCount: number;
	}) => {
		return (
			<span
				className="inline-block px-2 py-1 rounded bg-opacity-50 bg-black cursor-pointer hover:bg-opacity-75 haptic-sm"
				onClick={() => handleShowInfo(result)}
			>
				📂&nbsp;{getEpisodeCountLabel(videoCount, expectedEpisodeCount)}
			</span>
		);
	};

	return (
		<div className="max-w-full bg-gray-900 min-h-screen text-gray-100">
			<Head>
				<title>
					Debrid Media Manager - TV Show - {title} - Season {seasonNum}
				</title>
			</Head>
			<Toaster position="bottom-right" />
			{/* Display basic movie info */}
			<div
				className="grid grid-flow-col auto-cols-auto auto-rows-auto gap-2"
				style={backdropStyle}
			>
				{(poster && (
					<Image
						width={200}
						height={300}
						src={poster}
						alt="Show poster"
						className="shadow-lg row-span-5"
					/>
				)) || <Poster imdbId={imdbid as string} title={title} />}
				<div className="flex justify-end p-2">
					<Link
						href="/"
						className="w-fit h-fit text-sm border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50 py-1 px-2 rounded transition-colors"
					>
						Go Home
					</Link>
				</div>
				<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
					{title} - Season {seasonNum}
				</h2>
				<div className="w-fit h-fit bg-slate-900/75" onClick={() => setDescLimit(0)}>
					{descLimit > 0 ? description.substring(0, descLimit) + '..' : description}{' '}
					{imdb_score > 0 && (
						<div className="text-yellow-100 inline">
							<Link href={`https://www.imdb.com/title/${imdbid}/`} target="_blank">
								IMDB Score: {imdb_score < 10 ? imdb_score : imdb_score / 10}
							</Link>
						</div>
					)}
				</div>
				<div className="flex items-center overflow-x-auto">
					{Array.from({ length: season_count || 0 }, (_, i) => season_count - i).map(
						(season, idx) => {
							const color = intSeasonNum === season ? 'red' : 'yellow';
							return (
								<Link
									key={idx}
									href={`/show/${imdbid}/${season}`}
									className={`inline-flex items-center p-1 text-xs border-2 border-${color}-500 bg-${color}-900/30 text-${color}-100 hover:bg-${color}-800/50 rounded mr-2 mb-1 transition-colors`}
								>
									<span role="img" aria-label="tv show" className="mr-2">
										📺
									</span>{' '}
									<span className="whitespace-nowrap">
										{season_names && season_names[season - 1]
											? season_names[season - 1]
											: `Season ${season}`}
									</span>
								</Link>
							);
						}
					)}
				</div>
				<div>
					<button
						className="mr-2 mt-0 mb-1 border-2 border-rose-500 bg-rose-900/30 text-rose-100 hover:bg-rose-800/50 p-1 text-xs rounded transition-colors haptic-sm"
						onClick={() => {
							showSubscribeModal();
						}}
					>
						🔔Subscribe
					</button>
					{rdKey && getFirstAvailableRdTorrent() && (
						<button
							className="mr-2 mt-0 mb-1 border-2 border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50 p-1 text-xs rounded transition-colors haptic-sm"
							onClick={() => addRd(getFirstAvailableRdTorrent()!.hash)}
						>
							<b>⚡Instant RD</b>
						</button>
					)}
					{rdKey && player && getFirstAvailableRdTorrent() && (
						<button
							className="mr-2 mt-0 mb-1 border-2 border-teal-500 bg-teal-900/30 text-teal-100 hover:bg-teal-800/50 p-1 text-xs rounded transition-colors haptic-sm"
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
							className="mr-2 mt-0 mb-1 border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 p-1 text-xs rounded transition-colors haptic-sm"
							onClick={() => handleCast(getFirstAvailableRdTorrent()!.hash, ['1'])}
						>
							<b>Cast✨</b>
						</button>
					)}
					{onlyShowCached && totalUncachedCount > 0 && (
						<button
							className="mr-2 mt-0 mb-1 border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 p-1 text-xs rounded transition-colors haptic-sm"
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
				{getColorScale(expectedEpisodeCount).map((scale, idx) => (
					<span
						key={idx}
						className={`bg-${scale.color} text-white text-xs px-2 py-1 rounded whitespace-nowrap cursor-pointer`}
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
								episodeMaxSize !== '0' &&
								(r.medianFileSize ?? r.fileSize) >
									parseFloat(episodeMaxSize) * 1024 &&
								!inYourLibrary
							)
								return;
							const rdColor = btnColor(r.rdAvailable, r.noVideos);
							const adColor = btnColor(r.adAvailable, r.noVideos);
							let epRegex1 = /S(\d+)\s?E(\d+)/i;
							let epRegex2 = /[^\d](\d{1,2})x(\d{1,2})[^\d]/i;
							const castableFileIds = r.files
								.filter(
									(f) => f.filename.match(epRegex1) || f.filename.match(epRegex2)
								)
								.map((f) => `${f.fileId}`);
							return (
								<div
									key={i}
									className={`
										border-2 border-gray-700 
										${borderColor(downloaded, downloading)}
										${getEpisodeCountClass(r.videoCount, expectedEpisodeCount, r.rdAvailable || r.adAvailable)}
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
												<EpisodeCountDisplay
													result={r}
													videoCount={r.videoCount}
													expectedEpisodeCount={expectedEpisodeCount}
												/>
												<span className="ml-2">
													Total: {fileSize(r.fileSize)} GB; Median:{' '}
													{fileSize(r.medianFileSize)} GB
												</span>
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

											{rdKey &&
												dmmCastToken &&
												castableFileIds.length > 0 && (
													<button
														className="border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
														onClick={() =>
															handleCast(r.hash, castableFileIds)
														}
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
							className="w-full border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 py-2 px-4 my-4 rounded transition-colors duration-200 shadow-md hover:shadow-lg font-medium haptic"
							onClick={() => {
								setCurrentPage((prev) => prev + 1);
								fetchData(
									imdbid as string,
									parseInt(seasonNum as string),
									currentPage + 1
								);
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

const mdblistKey = process.env.MDBLIST_KEY;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
const getCinemetaInfo = (imdbId: string) =>
	`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`;

export const getServerSideProps: GetServerSideProps = async (context) => {
	const { params } = context;
	const mdbPromise = axios.get(getMdbInfo(params!.imdbid as string));
	const cinePromise = axios.get(getCinemetaInfo(params!.imdbid as string), {
		headers: {
			accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'accept-language': 'en-US,en;q=0.5',
			'accept-encoding': 'gzip, deflate, br',
			connection: 'keep-alive',
			'sec-fetch-dest': 'document',
			'sec-fetch-mode': 'navigate',
			'sec-fetch-site': 'same-origin',
			'sec-fetch-user': '?1',
			'upgrade-insecure-requests': '1',
			'user-agent': new UserAgent().toString(),
		},
	});
	const [mdbResponse, cinemetaResponse] = await Promise.all([mdbPromise, cinePromise]);

	let season_count = 1;
	let season_names = [];
	let imdb_score;

	let cineSeasons =
		cinemetaResponse.data.meta?.videos.filter((video: any) => video.season > 0) || [];
	const uniqueSeasons: number[] = Array.from(
		new Set(cineSeasons.map((video: any) => video.season))
	);
	const cineSeasonCount = uniqueSeasons.length > 0 ? Math.max(...uniqueSeasons) : 1;

	let mdbSeasons =
		mdbResponse.data.seasons?.filter((season: any) => season.season_number > 0) || [];
	const mdbSeasonCount =
		mdbSeasons.length > 0
			? Math.max(...mdbSeasons.map((season: any) => season.season_number))
			: 1;
	season_names = mdbSeasons.map((season: any) => season.name);

	if (cineSeasonCount > mdbSeasonCount) {
		season_count = cineSeasonCount;
		// add remaining to season_names
		const remaining = Array.from({ length: cineSeasonCount - mdbSeasonCount }, (_, i) => i + 1);
		season_names = season_names.concat(remaining.map((i) => `Season ${mdbSeasonCount + i}`));
	} else {
		season_count = mdbSeasonCount;
	}

	if (params!.seasonNum && parseInt(params!.seasonNum as string) > season_count) {
		return {
			redirect: {
				destination: `/show/${params!.imdbid}/1`,
				permanent: false,
			},
		};
	}

	imdb_score =
		cinemetaResponse.data.meta?.imdbRating ??
		mdbResponse.data.ratings?.reduce((acc: number | undefined, rating: any) => {
			if (rating.source === 'imdb') {
				return rating.score as number;
			}
			return acc;
		}, null);

	const title = mdbResponse?.data?.title ?? cinemetaResponse?.data?.title ?? 'Unknown';

	const season_episode_counts: Record<number, number> = {};

	// Get counts from cinemeta
	cineSeasons.forEach((video: any) => {
		if (!season_episode_counts[video.season]) {
			season_episode_counts[video.season] = 1;
		} else {
			season_episode_counts[video.season]++;
		}
	});

	// Merge with mdb data if available
	if (mdbResponse.data.seasons) {
		mdbResponse.data.seasons.forEach((season: any) => {
			if (season.episode_count && season.season_number) {
				// Use the larger count between the two sources
				season_episode_counts[season.season_number] = Math.max(
					season_episode_counts[season.season_number] || 0,
					season.episode_count
				);
			}
		});
	}

	return {
		props: {
			title,
			description:
				mdbResponse?.data?.description ?? cinemetaResponse?.data?.description ?? 'n/a',
			poster: mdbResponse?.data?.poster ?? cinemetaResponse?.data?.poster ?? '',
			backdrop:
				mdbResponse?.data?.backdrop ??
				cinemetaResponse?.data?.background ??
				'https://source.unsplash.com/random/1800x300?' + title,
			season_count,
			season_names,
			imdb_score: imdb_score ?? 0,
			season_episode_counts,
		},
	};
};

export default withAuth(TvSearch);
