import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import useLocalStorage from '@/hooks/localStorage';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd, handleCopyMagnet } from '@/utils/addMagnet';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid } from '@/utils/fetchTorrents';
import { instantCheckInAd, instantCheckInRd, wrapLoading } from '@/utils/instantChecks';
import { searchToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import axios from 'axios';
import { GetServerSideProps } from 'next';
import getConfig from 'next/config';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { FaDownload, FaFastForward, FaMagnet, FaTimes } from 'react-icons/fa';

type MovieSearchProps = {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	year: string;
	imdb_score?: number;
};

const torrentDB = new UserTorrentDB();

const MovieSearch: FunctionComponent<MovieSearchProps> = ({
	title,
	description,
	poster,
	backdrop,
	year,
	imdb_score,
}) => {
	const { publicRuntimeConfig: config } = getConfig();
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [rdAutoInstantCheck, setRdAutoInstantCheck] = useLocalStorage<boolean>(
		'rdAutoInstantCheck',
		!!rdKey
	);
	const [adAutoInstantCheck, setAdAutoInstantCheck] = useLocalStorage<boolean>(
		'adAutoInstantCheck',
		!!adKey
	);
	const [onlyShowCached, setOnlyShowCached] = useLocalStorage<boolean>('onlyShowCached', false);

	const router = useRouter();
	const { imdbid } = router.query;

	async function fetchData(imdbId: string) {
		setSearchResults([]);
		setErrorMessage('');
		try {
			let path = `api/torrents/movie?imdbId=${encodeURIComponent(imdbId)}`;
			if (config.externalSearchApiHostname) {
				path = encodeURIComponent(path);
			}
			let endpoint = `${config.externalSearchApiHostname || ''}/${path}`;
			const response = await axios.get<SearchApiResponse>(endpoint);
			if (response.status === 204) {
				setSearchState(response.headers['status']);
				return;
			} else if (response.status === 200) {
				setSearchState('loaded');
			}

			setSearchResults(response.data.results || []);

			if (response.data.results?.length) {
				toast(`Found ${response.data.results.length} results`, searchToastOptions);

				// instant checks
				const hashArr = response.data.results.map((r) => r.hash);
				if (rdKey && rdAutoInstantCheck)
					wrapLoading('RD', instantCheckInRd(rdKey, hashArr, setSearchResults));
				if (adKey && adAutoInstantCheck)
					wrapLoading('AD', instantCheckInAd(adKey, hashArr, setSearchResults));
			} else {
				toast(`No results found`, searchToastOptions);
			}
		} catch (error) {
			console.error(error);
			setErrorMessage('There was an error searching for the query. Please try again.');
		}
	}

	const [hashAndProgress, setHashAndProgress] = useState<Record<string, number>>({});
	async function fetchHashAndProgress(hash?: string) {
		const torrents = await torrentDB.all();
		const records: Record<string, number> = {};
		for (const t of torrents) {
			if (hash && t.hash !== hash) continue;
			records[t.hash] = t.progress;
		}
		setHashAndProgress((prev) => ({ ...prev, ...records }));
	}
	const isDownloading = (hash: string) => hash in hashAndProgress && hashAndProgress[hash] < 100;
	const isDownloaded = (hash: string) => hash in hashAndProgress && hashAndProgress[hash] === 100;
	const inLibrary = (hash: string) => hash in hashAndProgress;
	const notInLibrary = (hash: string) => !(hash in hashAndProgress);

	async function initialize() {
		await torrentDB.initializeDB();
		await Promise.all([fetchData(imdbid as string), fetchHashAndProgress()]);
	}
	useEffect(() => {
		if (!imdbid) return;
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid]);

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
		const torrent = await torrentDB.getLatestByHash(hash);
		if (!torrent) return;
		await handleDeleteRdTorrent(rdKey!, torrent.id);
		await torrentDB.deleteByHash(hash);
		setHashAndProgress((prev) => {
			const newHashAndProgress = { ...prev };
			delete newHashAndProgress[hash];
			return newHashAndProgress;
		});
	}

	async function deleteAd(hash: string) {
		const torrent = await torrentDB.getLatestByHash(hash);
		if (!torrent) return;
		await handleDeleteAdTorrent(adKey!, torrent.id);
		await torrentDB.deleteByHash(hash);
		setHashAndProgress((prev) => {
			const newHashAndProgress = { ...prev };
			delete newHashAndProgress[hash];
			return newHashAndProgress;
		});
	}

	const backdropStyle = {
		backgroundImage: `linear-gradient(to bottom, hsl(0, 0%, 12%,0.5) 0%, hsl(0, 0%, 12%,0) 50%, hsl(0, 0%, 12%,0.5) 100%), url(${backdrop})`,
		backgroundPosition: 'center',
		backgroundRepeat: 'no-repeat',
		backgroundSize: 'screen',
	};

	return (
		<div className="mx-2 my-1 max-w-full">
			<Head>
				<title>
					Debrid Media Manager - Movie - {title} ({year})
				</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-4">
				<h1
					className="text-xl font-bold"
					onClick={() => router.back()}
					style={{ cursor: 'pointer' }}
				>
					🎥
				</h1>
				<Link
					href="/"
					className="text-sm bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			{/* Display basic movie info */}
			<div className="flex items-start space-x-4" style={backdropStyle}>
				<div className="flex justify-center items-center">
					<Image
						width={200}
						height={300}
						src={poster}
						alt="Movie poster"
						className="shadow-2xl"
					/>
				</div>
				<div className="w-9/12 space-y-2 align-baseline">
					<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
						{title} ({year})
					</h2>
					<div className="bg-slate-900/75 w-fit">{description}</div>
					{imdb_score && (
						<div className="text-yellow-100">
							<Link href={`https://www.imdb.com/title/${imdbid}/`} target="_blank">
								IMDB Score: {imdb_score}
							</Link>
						</div>
					)}
				</div>
			</div>

			<hr className="my-4" />

			{searchState === 'loading' && (
				<div className="flex justify-center items-center mt-4">
					<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
				</div>
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
			{searchResults.length > 0 && (
				<>
					{searchState !== 'loading' && (
						<div
							className="mb-4 pb-1 whitespace-nowrap overflow-x-scroll"
							style={{ scrollbarWidth: 'thin' }}
						>
							{rdKey && (
								<>
									<button
										className={`mr-2 mt-0 mb-2 bg-green-700 hover:bg-green-600 text-white py-2 px-1 text-xs rounded`}
										onClick={() => {
											wrapLoading(
												'RD',
												instantCheckInRd(
													rdKey!,
													searchResults.map((result) => result.hash),
													setSearchResults
												)
											);
										}}
									>
										Check RD availability
									</button>
									<input
										id="auto-check-rd"
										className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
										type="checkbox"
										checked={rdAutoInstantCheck || false}
										onChange={(event) => {
											const isChecked = event.target.checked;
											setRdAutoInstantCheck(isChecked);
										}}
									/>{' '}
									<label
										htmlFor="auto-check-rd"
										className="mr-2 mb-2 text-sm font-medium"
									>
										Auto
									</label>
								</>
							)}
							{adKey && (
								<>
									<button
										className={`mr-2 mt-0 mb-2 bg-green-700 hover:bg-green-600 text-white py-2 px-1 text-xs rounded`}
										onClick={() => {
											wrapLoading(
												'AD',
												instantCheckInAd(
													adKey!,
													searchResults.map((result) => result.hash),
													setSearchResults
												)
											);
										}}
									>
										Check AD availability
									</button>
									<input
										id="auto-check-ad"
										className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
										type="checkbox"
										checked={adAutoInstantCheck || false}
										onChange={(event) => {
											const isChecked = event.target.checked;
											setAdAutoInstantCheck(isChecked);
										}}
									/>{' '}
									<label
										htmlFor="auto-check-ad"
										className="ml-2 mr-2 mb-2 text-sm font-medium"
									>
										Auto
									</label>
								</>
							)}
							<span className="px-1 py-1 text-xs bg-green-100 text-green-800 mr-2">
								{
									searchResults.filter(
										(r) =>
											(onlyShowCached && (r.rdAvailable || r.adAvailable)) ||
											!onlyShowCached
									).length
								}{' '}
								/ {searchResults.length} shown
							</span>
							<input
								id="show-cached"
								className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
								type="checkbox"
								checked={onlyShowCached || false}
								onChange={(event) => {
									const isChecked = event.target.checked;
									setOnlyShowCached(isChecked);
								}}
							/>{' '}
							<label
								htmlFor="show-cached"
								className="ml-2 mr-2 mb-2 text-sm font-medium"
							>
								Only show cached
							</label>
						</div>
					)}
					<div className="overflow-x-auto">
						<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
							{searchResults
								.filter(
									(result) =>
										!onlyShowCached || result.rdAvailable || result.adAvailable
								)
								.map((r: SearchResult, i: number) => (
									<div
										key={i}
										className={`
${
	isDownloaded(r.hash)
		? 'border-green-400 border-4'
		: isDownloading(r.hash)
		? 'border-red-400 border-4'
		: 'border-black border-2'
}
shadow hover:shadow-lg transition-shadow duration-200 ease-in
rounded-lg overflow-hidden
`}
									>
										<div className="p-2 space-y-4">
											<h2 className="text-xl font-bold leading-tight break-words">
												{r.title}
											</h2>
											<div className="text-gray-300">
												Size: {(r.fileSize / 1024).toFixed(2)} GB
											</div>
											<div className="flex flex-wrap space-x-2">
												<button
													className="bg-pink-500 hover:bg-pink-700 text-white rounded px-2 w-max"
													onClick={() => handleCopyMagnet(r.hash)}
												>
													<FaMagnet />
												</button>
												{rdKey && inLibrary(r.hash) && (
													<button
														className="bg-red-500 hover:bg-red-700 text-white rounded px-2 w-max"
														onClick={() => deleteRd(r.hash)}
													>
														<FaTimes className="mr-2 inline" />
														RD ({hashAndProgress[r.hash] + '%'})
													</button>
												)}
												{rdKey && notInLibrary(r.hash) && (
													<button
														className={`bg-${
															r.rdAvailable
																? 'green'
																: r.noVideos
																? 'gray'
																: 'blue'
														}-500 hover:bg-${
															r.rdAvailable
																? 'green'
																: r.noVideos
																? 'gray'
																: 'blue'
														}-700 text-white rounded px-2 w-max`}
														onClick={() => addRd(r.hash)}
													>
														{r.rdAvailable ? (
															<>
																<FaFastForward className="mr-2 inline" />
																RD
															</>
														) : (
															<>
																<FaDownload className="mr-2 inline" />
																RD
															</>
														)}
													</button>
												)}
												{adKey && inLibrary(r.hash) && (
													<button
														className="bg-red-500 hover:bg-red-700 text-white rounded px-2 w-max"
														onClick={() => deleteAd(r.hash)}
													>
														<FaTimes className="mr-2 inline" />
														AD ({hashAndProgress[r.hash] + '%'})
													</button>
												)}
												{adKey && notInLibrary(r.hash) && (
													<button
														className={`bg-${
															r.adAvailable
																? 'green'
																: r.noVideos
																? 'gray'
																: 'blue'
														}-500 hover:bg-${
															r.adAvailable
																? 'green'
																: r.noVideos
																? 'gray'
																: 'blue'
														}-700 text-white rounded px-2 w-max`}
														onClick={() => addAd(r.hash)}
													>
														{r.adAvailable ? (
															<>
																<FaFastForward className="mr-2 inline" />
																AD
															</>
														) : (
															<>
																<FaDownload className="mr-2 inline" />
																AD
															</>
														)}
													</button>
												)}
											</div>
										</div>
									</div>
								))}
						</div>
					</div>
				</>
			)}
		</div>
	);
};

const mdblistKey = process.env.MDBLIST_KEY;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;

export const getServerSideProps: GetServerSideProps = async (context) => {
	const { params } = context;
	const movieResponse = await axios.get(getMdbInfo(params!.imdbid as string));
	let imdb_score = movieResponse.data.ratings?.reduce((acc: number | undefined, rating: any) => {
		if (rating.source === 'imdb') {
			return rating.score as number;
		}
		return acc;
	}, null);
	return {
		props: {
			title: movieResponse.data.title,
			description: movieResponse.data.description,
			poster: movieResponse.data.poster,
			backdrop: movieResponse.data.backdrop,
			year: movieResponse.data.year,
			imdb_score,
		},
	};
};

const MovieSearchWithAuth = dynamic(() => Promise.resolve(withAuth(MovieSearch)), { ssr: false });

export default MovieSearchWithAuth;
