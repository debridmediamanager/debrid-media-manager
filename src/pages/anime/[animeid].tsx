import { showInfoForRD } from '@/components/showInfo';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useCastToken } from '@/hooks/cast';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd, handleCopyMagnet } from '@/utils/addMagnet';
import { handleCastAnime } from '@/utils/cast';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid } from '@/utils/fetchTorrents';
import { instantCheckAnimeInRd, instantCheckInAd, wrapLoading } from '@/utils/instantChecks';
import { applyQuickSearch2 } from '@/utils/quickSearch';
import { borderColor, btnColor, btnIcon, btnLabel, fileSize, sortByMedian } from '@/utils/results';
import { isVideo } from '@/utils/selectable';
import { defaultPlayer } from '@/utils/settings';
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

type AnimeSearchProps = {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	imdbid: string;
	imdbRating: number;
};

const torrentDB = new UserTorrentDB();

const getColorScale = () => {
	const scale = [
		{ threshold: 1, color: 'gray-800', label: 'Single' },
		{ threshold: Infinity, color: 'blue-900', label: 'With extras' },
	];
	return scale;
};

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

const getQueryForMovieCount = (videoCount: number) => {
	if (videoCount === 1) return 'videos:1';
	return `videos:>1`;
};

const getVideoFileIds = (result: SearchResult) => {
	if (!result.files || result.files.length === 0) return [];
	return result.files.filter((f) => isVideo({ path: f.filename })).map((f) => `${f.fileId}`);
};

const MovieSearch: FunctionComponent = () => {
	const router = useRouter();
	const { animeid } = router.query;
	const [animeInfo, setAnimeInfo] = useState<AnimeSearchProps>({
		title: '',
		description: '',
		poster: '',
		backdrop: '',
		imdbid: '',
		imdbRating: 0,
	});

	const player = window.localStorage.getItem('settings:player') || defaultPlayer;
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
	const [uncachedCount, setUncachedCount] = useState<number>(0);
	const dmmCastToken = useCastToken();

	useEffect(() => {
		if (!animeid) return;

		const fetchAnimeInfo = async () => {
			try {
				const response = await axios.get(`/api/info/anime?animeid=${animeid}`);
				setAnimeInfo(response.data);
			} catch (error) {
				console.error('Failed to fetch anime info:', error);
			}
		};

		fetchAnimeInfo();
	}, [animeid]);

	async function initialize() {
		await torrentDB.initializeDB();
		await Promise.all([fetchData(animeid as string), fetchHashAndProgress()]);
	}

	useEffect(() => {
		if (!animeid) return;
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [animeid]);

	async function fetchData(animeId: string) {
		const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
		setSearchResults([]);
		setErrorMessage('');
		setSearchState('loading');
		setUncachedCount(0);
		try {
			let path = `api/torrents/anime?animeId=${animeId}&dmmProblemKey=${tokenWithTimestamp}&solution=${tokenHash}&onlyTrusted=${onlyTrustedTorrents}`;
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
				setSearchResults(
					results.map((r) => ({
						...r,
						rdAvailable: false,
						adAvailable: false,
						noVideos: false,
						files: [],
					}))
				);
				toast(`Found ${results.length} results`, searchToastOptions);

				// instant checks
				const hashArr = results.map((r) => r.hash);
				const instantChecks = [];
				if (rdKey)
					instantChecks.push(
						wrapLoading(
							'RD',
							instantCheckAnimeInRd(rdKey, hashArr, setSearchResults, sortByMedian)
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
				setUncachedCount(hashArr.length - counts.reduce((acc, cur) => acc + cur, 0));
			} else {
				setSearchResults([]);
				toast(`No results found`, searchToastOptions);
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
		backgroundImage: `linear-gradient(to bottom, hsl(0, 0%, 12%,0.5) 0%, hsl(0, 0%, 12%,0) 50%, hsl(0, 0%, 12%,0.5) 100%), url(${animeInfo.backdrop})`,
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
		rdKey && showInfoForRD(player, rdKey, info, dmmCastToken ?? '', animeid as string, 'movie');
	};

	async function handleCast(hash: string, fileIds: string[]) {
		await toast.promise(
			handleCastAnime(dmmCastToken!, animeid as string, rdKey!, hash, fileIds),
			{
				loading: `Casting ${fileIds.length} episodes`,
				success: 'Casting successful',
				error: 'Casting failed',
			},
			castToastOptions
		);
	}

	if (!animeInfo.title) {
		return <div>Loading...</div>;
	}

	return (
		<div className="max-w-full bg-gray-900 min-h-screen text-gray-100">
			<Head>
				<title>Debrid Media Manager - Anime - {animeInfo.title}</title>
			</Head>
			<Toaster position="bottom-right" />
			<div
				className="grid grid-flow-col auto-cols-auto auto-rows-auto gap-2"
				style={backdropStyle}
			>
				{animeInfo.poster && (
					<Image
						width={200}
						height={300}
						src={animeInfo.poster}
						alt="Movie poster"
						className="shadow-lg row-span-5"
					/>
				)}
				<div className="flex justify-end p-2">
					<Link
						href="/"
						className="w-fit h-fit text-sm border-2 border-cyan-500 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-800/50 py-1 px-2 rounded transition-colors"
					>
						Go Home
					</Link>
				</div>
				<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
					{animeInfo.title}
				</h2>
				<div className="w-fit h-fit bg-slate-900/75" onClick={() => setDescLimit(0)}>
					{descLimit > 0
						? animeInfo.description.substring(0, descLimit) + '..'
						: animeInfo.description}{' '}
					{animeInfo.imdbRating > 0 && (
						<div className="text-yellow-100 inline">
							<Link
								href={`https://www.imdb.com/title/${animeInfo.imdbid}/`}
								target="_blank"
							>
								IMDB Score:{' '}
								{animeInfo.imdbRating < 10
									? animeInfo.imdbRating
									: animeInfo.imdbRating / 10}
							</Link>
						</div>
					)}
				</div>
				<div>
					{onlyShowCached && uncachedCount > 0 && (
						<button
							className="mr-2 mt-0 mb-1 border-2 border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50 p-1 text-xs rounded transition-colors haptic-sm"
							onClick={() => {
								setOnlyShowCached(false);
							}}
						>
							Show {uncachedCount} uncached
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
				<div className="mx-1 my-1 overflow-x-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
					{filteredResults.map((r: SearchResult, i: number) => {
						const downloaded = isDownloaded('rd', r.hash) || isDownloaded('ad', r.hash);
						const downloading =
							isDownloading('rd', r.hash) || isDownloading('ad', r.hash);
						const inYourLibrary = downloaded || downloading;
						if (onlyShowCached && !r.rdAvailable && !r.adAvailable && !inYourLibrary)
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
												className="inline-block px-2 py-1 rounded bg-opacity-50 bg-black cursor-pointer hover:bg-opacity-75 haptic-sm"
												onClick={() => handleShowInfo(r)}
											>
												📂&nbsp;{getMovieCountLabel(r.videoCount)}
											</span>
											{r.videoCount > 1 ? (
												<span className="ml-2">
													Total: {fileSize(r.fileSize)} GB; Median:{' '}
													{fileSize(r.medianFileSize)} GB
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

										{/* Cast button */}
										{rdKey && dmmCastToken && (
											<button
												className="border-2 border-gray-500 bg-gray-900/30 text-gray-100 hover:bg-gray-800/50 text-xs rounded inline px-1 transition-colors haptic-sm"
												onClick={() =>
													handleCast(r.hash, getVideoFileIds(r))
												}
											>
												Cast✨
											</button>
										)}

										{/* Magnet button */}
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
			)}
		</div>
	);
};

export default withAuth(MovieSearch);
