import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useDownloadsCache } from '@/hooks/cache';
import useLocalStorage from '@/hooks/localStorage';
import { deleteMagnet, uploadMagnet } from '@/services/allDebrid';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { addHashAsMagnet, deleteTorrent, getTorrentInfo, selectFiles } from '@/services/realDebrid';
import { instantCheckInAd, instantCheckInRd, wrapLoading } from '@/utils/instantChecks';
import { getSelectableFiles, isVideoOrSubs } from '@/utils/selectable';
import { searchToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import axios from 'axios';
import { GetServerSideProps } from 'next';
import getConfig from 'next/config';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { FaDownload, FaFastForward, FaTimes } from 'react-icons/fa';

type MovieSearchProps = {
	title: string;
	description: string;
	poster: string;
	year: string;
	imdb_score?: number;
};

const MovieSearch: FunctionComponent<MovieSearchProps> = ({
	title,
	description,
	poster,
	year,
	imdb_score,
}) => {
	const { publicRuntimeConfig: config } = getConfig();
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [filteredResults, setFilteredResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [rdCache, rd, rdCacheAdder, removeFromRdCache] = useDownloadsCache('rd');
	const [adCache, ad, adCacheAdder, removeFromAdCache] = useDownloadsCache('ad');
	const [rdAutoInstantCheck, setRdAutoInstantCheck] = useLocalStorage<boolean>(
		'rdAutoInstantCheck',
		false
	);
	const [adAutoInstantCheck, setAdAutoInstantCheck] = useLocalStorage<boolean>(
		'adAutoInstantCheck',
		false
	);
	const [onlyShowCached, setOnlyShowCached] = useLocalStorage<boolean>('onlyShowCached', false);

	const router = useRouter();
	const { imdbid } = router.query;

	useEffect(() => {
		if (imdbid) {
			fetchData(imdbid as string);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid]);

	useEffect(() => {
		if (searchResults.length > 0) {
			const filtered = searchResults.filter((result) => {
				if (onlyShowCached) {
					return result.rdAvailable || result.adAvailable;
				}
				return true;
			});
			setFilteredResults(filtered);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchResults, onlyShowCached]);

	const fetchData = async (imdbId: string) => {
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

			setSearchResults(
				response.data.results?.map((r) => ({
					...r,
					available: 'unavailable',
				})) || []
			);

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
	};

	const handleAddAsMagnetInRd = async (
		hash: string,
		instantDownload: boolean = false,
		disableToast: boolean = false
	) => {
		try {
			if (!rdKey) throw new Error('no_rd_key');
			const id = await addHashAsMagnet(rdKey, hash);
			if (!disableToast) toast('Successfully added as magnet!', searchToastOptions);
			rdCacheAdder.single(`rd:${id}`, hash, instantDownload ? 'downloaded' : 'downloading');
			handleSelectFiles(`rd:${id}`, true); // add rd: to account for substr(3) in handleSelectFiles
		} catch (error) {
			console.error(error);
			if (!disableToast)
				toast.error('There was an error adding as magnet. Please try again.');
		}
	};

	const handleAddAsMagnetInAd = async (
		hash: string,
		instantDownload: boolean = false,
		disableToast: boolean = false
	) => {
		try {
			if (!adKey) throw new Error('no_ad_key');
			const resp = await uploadMagnet(adKey, [hash]);
			if (resp.data.magnets.length === 0 || resp.data.magnets[0].error)
				throw new Error('no_magnets');
			if (!disableToast) toast('Successfully added as magnet!', searchToastOptions);
			adCacheAdder.single(
				`ad:${resp.data.magnets[0].id}`,
				hash,
				instantDownload ? 'downloaded' : 'downloading'
			);
		} catch (error) {
			console.error(error);
			if (!disableToast)
				toast.error('There was an error adding as magnet. Please try again.');
		}
	};

	const handleDeleteTorrent = async (id: string, disableToast: boolean = false) => {
		try {
			if (!rdKey && !adKey) throw new Error('no_keys');
			if (rdKey && id.startsWith('rd:')) await deleteTorrent(rdKey, id.substring(3));
			if (adKey && id.startsWith('ad:')) await deleteMagnet(adKey, id.substring(3));
			if (!disableToast) toast(`Download canceled (${id})`, searchToastOptions);
			if (id.startsWith('rd:')) removeFromRdCache(id);
			if (id.startsWith('ad:')) removeFromAdCache(id);
		} catch (error) {
			console.error(error);
			if (!disableToast) toast.error(`Error deleting torrent (${id})`);
		}
	};

	const handleSelectFiles = async (id: string, disableToast: boolean = false) => {
		try {
			if (!rdKey) throw new Error('no_rd_key');
			const response = await getTorrentInfo(rdKey, id.substring(3));
			if (response.filename === 'Magnet') return; // no files yet

			const selectedFiles = getSelectableFiles(response.files.filter(isVideoOrSubs)).map(
				(file) => file.id
			);
			if (selectedFiles.length === 0) {
				handleDeleteTorrent(id, true);
				throw new Error('no_files_for_selection');
			}

			await selectFiles(rdKey, id.substring(3), selectedFiles);
		} catch (error) {
			console.error(error);
			if ((error as Error).message === 'no_files_for_selection') {
				if (!disableToast)
					toast.error(`No files for selection, deleting (${id})`, {
						duration: 5000,
					});
			} else {
				if (!disableToast) toast.error(`Error selecting files (${id})`);
			}
		}
	};

	return (
		<div className="mx-4 my-8 max-w-full">
			<Head>
				<title>
					Debrid Media Manager - Movie - {title} ({year})
				</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-4">
				<h1
					className="text-3xl font-bold"
					onClick={() => router.back()}
					style={{ cursor: 'pointer' }}
				>
					🎥
				</h1>
				<Link
					href="/"
					className="text-2xl bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			{/* Display basic movie info */}
			<div className="flex items-start space-x-4">
				<div className="flex w-1/4 justify-center items-center">
					<Image
						width={200}
						height={300}
						src={poster}
						alt="Movie poster"
						className="shadow-lg"
					/>
				</div>
				<div className="w-3/4 space-y-2">
					<h2 className="text-2xl font-bold">
						{title} ({year})
					</h2>
					<p>{description}</p>
					{imdb_score && (
						<p>
							<Link href={`https://www.imdb.com/title/${imdbid}/`}>
								IMDB Score: {imdb_score}
							</Link>
						</p>
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
							<button
								className={`mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded`}
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
							<button
								className={`mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded`}
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
							<span className="px-2.5 py-1 text-s bg-green-100 text-green-800 mr-2">
								{filteredResults.length} / {searchResults.length} shown
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
							{searchState !== 'loading' &&
								filteredResults.map((r: SearchResult) => (
									<div
										key={r.hash}
										className={`
${
	rd.isDownloaded(r.hash) || ad.isDownloaded(r.hash)
		? 'border-green-400 border-4'
		: rd.isDownloading(r.hash) || ad.isDownloading(r.hash)
		? 'border-red-400 border-4'
		: 'border-black border-2'
}
shadow hover:shadow-lg transition-shadow duration-200 ease-in
rounded-lg overflow-hidden
`}
									>
										<div className="p-6 space-y-4">
											<h2 className="text-2xl font-bold leading-tight break-words">
												{r.title}
											</h2>
											<p className="text-gray-300">
												Size: {(r.fileSize / 1024).toFixed(2)} GB
											</p>
											<div className="flex flex-wrap space-x-2">
												{rd.isDownloading(r.hash) &&
													rdCache![r.hash].id && (
														<button
															className="bg-red-500 hover:bg-red-700 text-white py-2 px-4 rounded-full"
															onClick={() => {
																handleDeleteTorrent(
																	rdCache![r.hash].id
																);
															}}
														>
															<FaTimes className="mr-2" />
															RD ({rdCache![r.hash].progress}%)
														</button>
													)}
												{rdKey && rd.notInLibrary(r.hash) && (
													<button
														className={`flex items-center justify-center bg-${
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
														}-700 text-white py-2 px-4 rounded-full`}
														onClick={() => {
															handleAddAsMagnetInRd(
																r.hash,
																r.rdAvailable
															);
														}}
													>
														{r.rdAvailable ? (
															<>
																<FaFastForward className="mr-2" />
																RD
															</>
														) : (
															<>
																<FaDownload className="mr-2" />
																RD
															</>
														)}
													</button>
												)}
												{ad.isDownloading(r.hash) &&
													adCache![r.hash].id && (
														<button
															className="bg-red-500 hover:bg-red-700 text-white py-2 px-4 rounded-full"
															onClick={() => {
																handleDeleteTorrent(
																	adCache![r.hash].id
																);
															}}
														>
															<FaTimes className="mr-2" />
															AD ({adCache![r.hash].progress}%)
														</button>
													)}
												{adKey && ad.notInLibrary(r.hash) && (
													<button
														className={`flex items-center justify-center bg-${
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
														}-700 text-white py-2 px-4 rounded-full`}
														onClick={() => {
															handleAddAsMagnetInAd(
																r.hash,
																r.adAvailable
															);
														}}
													>
														{r.adAvailable ? (
															<>
																<FaFastForward className="mr-2" />
																AD
															</>
														) : (
															<>
																<FaDownload className="mr-2" />
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
			year: movieResponse.data.year,
			imdb_score,
		},
	};
};

export default withAuth(MovieSearch);
