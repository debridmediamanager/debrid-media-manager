import { showInfoForRD } from '@/components/showInfo';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useCastToken } from '@/hooks/castToken';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd, handleCopyMagnet } from '@/utils/addMagnet';
import { submitAvailability } from '@/utils/availability';
import { handleCastAnime } from '@/utils/castApiClient';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { convertToUserTorrent, fetchAllDebrid } from '@/utils/fetchTorrents';
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
	const [onlyShowCached, setOnlyShowCached] = useState<boolean>(false);
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
				if (rdKey) {
					const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
					instantChecks.push(
						wrapLoading(
							'RD',
							instantCheckAnimeInRd(
								tokenWithTimestamp,
								tokenHash,
								rdKey,
								hashArr,
								setSearchResults,
								sortByMedian
							)
						)
					);
				}
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
		await handleAddAsMagnetInRd(rdKey!, hash, async (info: TorrentInfoResponse) => {
			const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
			await Promise.all([
				submitAvailability(tokenWithTimestamp, tokenHash, info, animeid as string),
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
			status: 'downloaded',
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
		<div className="min-h-screen max-w-full bg-gray-900 text-gray-100">
			<Head>
				<title>Debrid Media Manager - Anime - {animeInfo.title}</title>
			</Head>
			<Toaster position="bottom-right" />
			<div
				className="grid auto-cols-auto grid-flow-col auto-rows-auto gap-2"
				style={backdropStyle}
			>
				{animeInfo.poster && (
					<Image
						width={200}
						height={300}
						src={animeInfo.poster}
						alt="Movie poster"
						className="row-span-5 shadow-lg"
					/>
				)}
				<div className="flex justify-end p-2">
					<Link
						href="/"
						className="h-fit w-fit rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
					>
						Go Home
					</Link>
				</div>
				<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
					{animeInfo.title}
				</h2>
				<div className="h-fit w-fit bg-slate-900/75" onClick={() => setDescLimit(0)}>
					{descLimit > 0
						? animeInfo.description.substring(0, descLimit) + '..'
						: animeInfo.description}{' '}
					{animeInfo.imdbRating > 0 && (
						<div className="inline text-yellow-100">
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
							className="haptic-sm mb-1 mr-2 mt-0 rounded border-2 border-blue-500 bg-blue-900/30 p-1 text-xs text-blue-100 transition-colors hover:bg-blue-800/50"
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
				<div className="mx-1 my-1 grid grid-cols-1 gap-2 overflow-x-auto sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
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
								className={`border-2 border-gray-700 ${borderColor(downloaded, downloading)} ${getMovieCountClass(r.videoCount, r.rdAvailable || r.adAvailable)} overflow-hidden rounded-lg bg-opacity-30 shadow transition-shadow duration-200 ease-in hover:shadow-lg`}
							>
								<div className="space-y-2 p-1">
									<h2 className="line-clamp-2 overflow-hidden text-ellipsis break-words text-sm font-bold leading-tight">
										{r.title}
									</h2>

									{r.videoCount > 0 ? (
										<div className="text-xs text-gray-300">
											<span
												className="haptic-sm inline-block cursor-pointer rounded bg-black bg-opacity-50 px-2 py-1 hover:bg-opacity-75"
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
										<div className="text-xs text-gray-300">
											Total: {fileSize(r.fileSize)} GB
										</div>
									)}

									<div className="space-x-1 space-y-1">
										{/* RD */}
										{rdKey && inLibrary('rd', r.hash) && (
											<button
												className="haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50"
												onClick={() => deleteRd(r.hash)}
											>
												<FaTimes className="mr-2 inline" />
												RD ({hashAndProgress[`rd:${r.hash}`] + '%'})
											</button>
										)}
										{rdKey && notInLibrary('rd', r.hash) && (
											<button
												className={`border-2 border-${rdColor}-500 bg-${rdColor}-900/30 text-${rdColor}-100 hover:bg-${rdColor}-800/50 haptic-sm inline rounded px-1 text-xs transition-colors`}
												onClick={() => addRd(r.hash)}
											>
												{btnIcon(r.rdAvailable)}
												{btnLabel(r.rdAvailable, 'RD')}
											</button>
										)}

										{/* AD */}
										{adKey && inLibrary('ad', r.hash) && (
											<button
												className="haptic-sm inline rounded border-2 border-red-500 bg-red-900/30 px-1 text-xs text-red-100 transition-colors hover:bg-red-800/50"
												onClick={() => deleteAd(r.hash)}
											>
												<FaTimes className="mr-2 inline" />
												AD ({hashAndProgress[`ad:${r.hash}`] + '%'})
											</button>
										)}
										{adKey && notInLibrary('ad', r.hash) && (
											<button
												className={`border-2 border-${adColor}-500 bg-${adColor}-900/30 text-${adColor}-100 hover:bg-${adColor}-800/50 haptic-sm inline rounded px-1 text-xs transition-colors`}
												onClick={() => addAd(r.hash)}
											>
												{btnIcon(r.adAvailable)}
												{btnLabel(r.adAvailable, 'AD')}
											</button>
										)}

										{/* Cast button */}
										{rdKey && dmmCastToken && (
											<button
												className="haptic-sm inline rounded border-2 border-gray-500 bg-gray-900/30 px-1 text-xs text-gray-100 transition-colors hover:bg-gray-800/50"
												onClick={() =>
													handleCast(r.hash, getVideoFileIds(r))
												}
											>
												Cast✨
											</button>
										)}

										{/* Magnet button */}
										<button
											className="haptic-sm inline rounded border-2 border-pink-500 bg-pink-900/30 px-1 text-xs text-pink-100 transition-colors hover:bg-pink-800/50"
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
