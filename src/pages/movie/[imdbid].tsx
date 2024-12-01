import MovieSearchResults from '@/components/MovieSearchResults';
import Poster from '@/components/poster';
import { showInfoForRD } from '@/components/showInfo';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInRd,
	handleCopyOrDownloadMagnet,
} from '@/utils/addMagnet';
import { submitAvailability } from '@/utils/availability';
import { handleCastMovie } from '@/utils/castApiClient';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { convertToUserTorrent, fetchAllDebrid } from '@/utils/fetchTorrents';
import { instantCheckInAd, instantCheckInRd, wrapLoading } from '@/utils/instantChecks';
import { applyQuickSearch2 } from '@/utils/quickSearch';
import { sortByBiggest } from '@/utils/results';
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
	const [onlyShowCached, setOnlyShowCached] = useState<boolean>(false);
	const [totalUncachedCount, setTotalUncachedCount] = useState<number>(0);
	const [currentPage, setCurrentPage] = useState(0);
	const [hasMoreResults, setHasMoreResults] = useState(true);
	const [hashAndProgress, setHashAndProgress] = useState<Record<string, number>>({});

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

				const hashArr = results.map((r) => r.hash);
				const instantChecks = [];
				if (rdKey) {
					const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
					instantChecks.push(
						wrapLoading(
							'RD',
							instantCheckInRd(
								tokenWithTimestamp,
								tokenHash,
								imdbId,
								hashArr,
								setSearchResults,
								sortByBiggest
							)
						)
					);
				}
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
	}, [query, searchResults]);

	async function fetchHashAndProgress(hash?: string) {
		const torrents = await torrentDB.all();
		const records: Record<string, number> = {};
		for (const t of torrents) {
			if (hash && t.hash !== hash) continue;
			records[`${t.id.substring(0, 3)}${t.hash}`] = t.progress;
		}
		setHashAndProgress((prev) => ({ ...prev, ...records }));
	}

	async function addRd(hash: string) {
		await handleAddAsMagnetInRd(rdKey!, hash, async (info: TorrentInfoResponse) => {
			const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
			await Promise.all([
				submitAvailability(tokenWithTimestamp, tokenHash, info, imdbid as string),
				torrentDB.add(convertToUserTorrent(info)).then(() => fetchHashAndProgress(hash)),
			]);
		});
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
			host: '',
			split: 0,
			status: 'downloaded',
			added: '',
			ended: '',
			speed: 0,
			seeders: 0,
		} as TorrentInfoResponse;
		rdKey && showInfoForRD(player, rdKey, info, imdbid as string, 'movie');
	};

	async function handleCast(hash: string) {
		await toast.promise(
			handleCastMovie(imdbid as string, rdKey!, hash),
			{
				loading: 'Casting...',
				success: 'Casting successful',
				error: 'Casting failed',
			},
			castToastOptions
		);
		// open stremio after casting
		window.open(`stremio://detail/movie/${imdbid}/${imdbid}`);
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
		<div className="min-h-screen max-w-full bg-gray-900 text-gray-100">
			<Head>
				<title>
					Debrid Media Manager - Movie - {movieInfo.title} ({movieInfo.year})
				</title>
			</Head>
			<Toaster position="bottom-right" />
			{/* Display basic movie info */}
			<div
				className="grid auto-cols-auto grid-flow-col auto-rows-auto gap-2"
				style={backdropStyle}
			>
				{(movieInfo.poster && (
					<Image
						width={200}
						height={300}
						src={movieInfo.poster}
						alt="Movie poster"
						className="row-span-5 shadow-lg"
					/>
				)) || <Poster imdbId={imdbid as string} title={movieInfo.title} />}
				<div className="flex justify-end p-2">
					<Link
						href="/"
						className="h-fit w-fit rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
					>
						Go Home
					</Link>
				</div>
				<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
					{movieInfo.title} ({movieInfo.year})
				</h2>
				<div className="h-fit w-fit bg-slate-900/75" onClick={() => setDescLimit(0)}>
					{descLimit > 0
						? movieInfo.description.substring(0, descLimit) + '..'
						: movieInfo.description}{' '}
					{movieInfo.imdb_score > 0 && (
						<div className="inline text-yellow-100">
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
					{rdKey && getFirstAvailableRdTorrent() && (
						<>
							<button
								className="mb-1 mr-2 mt-0 rounded border-2 border-green-500 bg-green-900/30 p-1 text-xs text-green-100 transition-colors hover:bg-green-800/50"
								onClick={() => addRd(getFirstAvailableRdTorrent()!.hash)}
							>
								<b>⚡Instant RD</b>
							</button>
							<button
								className="mb-1 mr-2 mt-0 rounded border-2 border-teal-500 bg-teal-900/30 p-1 text-xs text-teal-100 transition-colors hover:bg-teal-800/50"
								onClick={() =>
									window.open(
										`/api/watch/instant/${player}?token=${rdKey}&hash=${getFirstAvailableRdTorrent()!.hash}&fileId=${getBiggestFileId(getFirstAvailableRdTorrent()!)}`
									)
								}
							>
								<b>🧐Watch</b>
							</button>
							<button
								className="mb-1 mr-2 mt-0 rounded border-2 border-gray-500 bg-gray-900/30 p-1 text-xs text-gray-100 transition-colors hover:bg-gray-800/50"
								onClick={() => handleCast(getFirstAvailableRdTorrent()!.hash)}
							>
								<b>Cast✨</b>
							</button>
							<button
								className="mb-1 mr-2 mt-0 rounded border-2 border-purple-500 bg-purple-900/30 p-1 text-xs text-purple-100 transition-colors hover:bg-purple-800/50"
								onClick={() =>
									window.open(`stremio://detail/movie/${imdbid}/${imdbid}`)
								}
							>
								<b>🔮Stremio</b>
							</button>
						</>
					)}
					{onlyShowCached && totalUncachedCount > 0 && (
						<button
							className="mb-1 mr-2 mt-0 rounded border-2 border-blue-500 bg-blue-900/30 p-1 text-xs text-blue-100 transition-colors hover:bg-blue-800/50"
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
			<div className="mb-1 flex items-center border-b-2 border-gray-600 py-2">
				<input
					className="mr-3 w-full appearance-none border-none bg-transparent px-2 py-1 text-sm leading-tight text-gray-100 focus:outline-none"
					type="text"
					id="query"
					placeholder="filter results, supports regex"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value.toLocaleLowerCase());
					}}
				/>
				<span
					className="me-2 cursor-pointer rounded bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
					onClick={() => setQuery('')}
				>
					Reset
				</span>
			</div>
			<div className="mb-2 flex items-center gap-2 overflow-x-auto p-2">
				{getColorScale().map((scale, idx) => (
					<span
						key={idx}
						className={`bg-${scale.color} cursor-pointer whitespace-nowrap rounded px-2 py-1 text-xs text-white`}
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
					<MovieSearchResults
						filteredResults={filteredResults}
						onlyShowCached={onlyShowCached}
						movieMaxSize={movieMaxSize}
						rdKey={rdKey}
						adKey={adKey}
						player={player}
						hashAndProgress={hashAndProgress}
						handleShowInfo={handleShowInfo}
						handleCast={handleCast}
						handleCopyMagnet={handleCopyOrDownloadMagnet}
						addRd={addRd}
						addAd={addAd}
						deleteRd={deleteRd}
						deleteAd={deleteAd}
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
