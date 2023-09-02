import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useDownloadsCache } from '@/hooks/cache';
import useLocalStorage from '@/hooks/localStorage';
import {
	AdInstantAvailabilityResponse,
	MagnetFile,
	adInstantCheck,
	deleteMagnet,
	uploadMagnet,
} from '@/services/allDebrid';
import { Availability, HashAvailability } from '@/services/availability';
import {
	RdInstantAvailabilityResponse,
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	rdInstantCheck,
	selectFiles,
} from '@/services/realDebrid';
import { getTmdbKey } from '@/utils/freekeys';
import { groupBy } from '@/utils/groupBy';
import { getSelectableFiles, isVideo } from '@/utils/selectable';
import { searchToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import axios from 'axios';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { FaDownload, FaFastForward, FaTimes } from 'react-icons/fa';

export type SearchApiResponse = {
	results?: SearchResult[];
	errorMessage?: string;
};

type SearchResult = {
	title: string;
	fileSize: number;
	hash: string;
	available: Availability;
};

type TmdbResponse = {
	tv_results: {
		name: string;
		overview: string;
		first_air_date: string;
		poster_path: string;
	}[];
};

function Search() {
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [masterAvailability, setMasterAvailability] = useState<HashAvailability>({});
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
	const [showInfo, setShowInfo] = useState<TmdbResponse | null>(null);

	const router = useRouter();
	const { imdbid, seasonNum } = router.query;

	const fetchShowInfo = async (imdbId: string) => {
		try {
			const response = await axios.get<TmdbResponse>(
				`https://api.themoviedb.org/3/find/${imdbId}?api_key=${getTmdbKey()}&external_source=imdb_id`
			);
			setShowInfo(response.data);
		} catch (error) {
			setErrorMessage('There was an error fetching movie info. Please try again.');
			console.error(`error fetching movie data`, error);
		}
	};

	useEffect(() => {
		if (imdbid && seasonNum) {
			fetchShowInfo(imdbid as string);
			fetchData(imdbid as string, parseInt(seasonNum as string));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid, seasonNum]);

	const fetchData = async (imdbId: string, seasonNum: number) => {
		setSearchResults([]);
		setErrorMessage('');
		try {
			let endpoint = `/api/tvsearch?imdbId=${encodeURIComponent(
				imdbId
			)}&seasonNum=${seasonNum}`;
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
				if (rdKey && rdAutoInstantCheck) await instantCheckInRd(hashArr);
				if (adKey && adAutoInstantCheck) await instantCheckInAd(hashArr);
			} else {
				toast(`No results found`, searchToastOptions);
			}
		} catch (error) {
			console.error(error);
			setErrorMessage('There was an error searching for the query. Please try again.');
		}
	};

	useEffect(() => {
		setSearchResults((prev) =>
			prev.map((r) => ({
				...r,
				available: masterAvailability[r.hash],
			}))
		);
	}, [masterAvailability]);

	const instantCheckInRd = async (hashes: string[]): Promise<void> => {
		const rdAvailability = {} as HashAvailability;

		const setInstantFromRd = (resp: RdInstantAvailabilityResponse) => {
			for (const masterHash in resp) {
				if ('rd' in resp[masterHash] === false) continue;
				if (masterAvailability[masterHash] === 'no_videos') continue;
				const variants = resp[masterHash]['rd'];
				if (!variants.length) rdAvailability[masterHash] = 'no_videos';
				for (const variant of variants) {
					for (const fileId in variant) {
						const file = variant[fileId];
						if (isVideo({ path: file.filename })) {
							rdAvailability[masterHash] =
								masterAvailability[masterHash] === 'ad:available' ||
								masterAvailability[masterHash] === 'all:available'
									? 'all:available'
									: 'rd:available';

							break;
						}
					}
				}
			}
		};

		try {
			for (const hashGroup of groupBy(100, hashes)) {
				if (rdKey) await rdInstantCheck(rdKey, hashGroup).then(setInstantFromRd);
			}
			toast(
				`Found ${
					Object.values(rdAvailability).filter((a) => a.includes(':available')).length
				} available in RD`,
				searchToastOptions
			);
			setMasterAvailability((prevState) => ({ ...prevState, ...rdAvailability }));
		} catch (error) {
			toast.error(
				'There was an error checking availability in Real-Debrid. Please try again.'
			);
			throw error;
		}
	};

	const instantCheckInAd = async (hashes: string[]): Promise<void> => {
		const adAvailability = {} as HashAvailability;

		const setInstantFromAd = (resp: AdInstantAvailabilityResponse) => {
			for (const magnetData of resp.data.magnets) {
				const masterHash = magnetData.hash;
				if (masterAvailability[masterHash] === 'no_videos') continue;
				if (magnetData.instant) {
					adAvailability[masterHash] = magnetData.files?.reduce(
						(acc: boolean, curr: MagnetFile) => {
							if (isVideo({ path: curr.n })) {
								return true;
							}
							return acc;
						},
						false
					)
						? masterAvailability[masterHash] === 'rd:available' ||
						  masterAvailability[masterHash] === 'all:available'
							? 'all:available'
							: 'ad:available'
						: 'no_videos';
				}
			}
		};

		try {
			for (const hashGroup of groupBy(30, hashes)) {
				if (adKey) await adInstantCheck(adKey, hashGroup).then(setInstantFromAd);
			}
			toast(
				`Found ${
					Object.values(adAvailability).filter((a) => a.includes(':available')).length
				} available in AD`,
				searchToastOptions
			);
			setMasterAvailability((prevState) => ({ ...prevState, ...adAvailability }));
		} catch (error) {
			toast.error('There was an error checking availability in AllDebrid. Please try again.');
			throw error;
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
			if (!disableToast) toast.success('Successfully added as magnet!');
			rdCacheAdder.single(`rd:${id}`, hash, instantDownload ? 'downloaded' : 'downloading');
			handleSelectFiles(`rd:${id}`, true); // add rd: to account for substr(3) in handleSelectFiles
		} catch (error) {
			if (!disableToast)
				toast.error('There was an error adding as magnet. Please try again.');
			throw error;
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
			if (!disableToast) toast.success('Successfully added as magnet!');
			adCacheAdder.single(
				`ad:${resp.data.magnets[0].id}`,
				hash,
				instantDownload ? 'downloaded' : 'downloading'
			);
		} catch (error) {
			if (!disableToast)
				toast.error('There was an error adding as magnet. Please try again.');
			throw error;
		}
	};

	const isAvailableInRd = (result: SearchResult) =>
		result.available === 'rd:available' || result.available === 'all:available';
	const isAvailableInAd = (result: SearchResult) =>
		result.available === 'ad:available' || result.available === 'all:available';
	const hasNoVideos = (result: SearchResult) => result.available === 'no_videos';

	const handleDeleteTorrent = async (id: string, disableToast: boolean = false) => {
		try {
			if (!rdKey && !adKey) throw new Error('no_keys');
			if (rdKey && id.startsWith('rd:')) await deleteTorrent(rdKey, id.substring(3));
			if (adKey && id.startsWith('ad:')) await deleteMagnet(adKey, id.substring(3));
			if (!disableToast) toast.success(`Download canceled (${id})`);
			if (id.startsWith('rd:')) removeFromRdCache(id);
			if (id.startsWith('ad:')) removeFromAdCache(id);
		} catch (error) {
			if (!disableToast) toast.error(`Error deleting torrent (${id})`);
			throw error;
		}
	};

	const handleSelectFiles = async (id: string, disableToast: boolean = false) => {
		try {
			if (!rdKey) throw new Error('no_rd_key');
			const response = await getTorrentInfo(rdKey, id.substring(3));
			if (response.filename === 'Magnet') return; // no files yet

			const selectedFiles = getSelectableFiles(response.files.filter(isVideo)).map(
				(file) => file.id
			);
			if (selectedFiles.length === 0) {
				handleDeleteTorrent(id, true);
				throw new Error('no_files_for_selection');
			}

			await selectFiles(rdKey, id.substring(3), selectedFiles);
		} catch (error) {
			if ((error as Error).message === 'no_files_for_selection') {
				if (!disableToast)
					toast.error(`No files for selection, deleting (${id})`, {
						duration: 5000,
					});
			} else {
				if (!disableToast) toast.error(`Error selecting files (${id})`);
			}
			throw error;
		}
	};

	return (
		<div className="mx-4 my-8 max-w-full">
			<Head>
				<title>
					Debrid Media Manager - TV Show - {showInfo?.tv_results[0].name} - Season{' '}
					{seasonNum}
				</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-4">
				<h1
					className="text-3xl font-bold"
					onClick={() => router.back()}
					style={{ cursor: 'pointer' }}
				>
					📺
				</h1>
				<Link
					href="/"
					className="text-2xl bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			{/* Display basic movie info */}
			{showInfo && (
				<div className="flex items-start space-x-4">
					<div className="flex w-1/4 justify-center items-center">
						<Image
							width={200}
							height={300}
							src={`https://image.tmdb.org/t/p/w200${showInfo.tv_results[0].poster_path}`}
							alt="Movie poster"
							className="shadow-lg"
						/>
					</div>
					<div className="w-3/4 space-y-2">
						<h2 className="text-2xl font-bold">
							{showInfo.tv_results[0].name} - Season {seasonNum}
						</h2>
						<p className="text-gray-700">{showInfo.tv_results[0].overview}</p>
					</div>
				</div>
			)}

			<hr className="my-4" />

			{searchState === 'loading' && (
				<div className="flex justify-center items-center mt-4">
					<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
				</div>
			)}
			{searchState === 'requested' && (
				<div className="mt-4 bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded relative">
					<strong className="font-bold">Notice:</strong>
					<span className="block sm:inline">
						{' '}
						The request has been received. This might take at least 5 minutes.
					</span>
				</div>
			)}
			{searchState === 'processing' && (
				<div className="mt-4 bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded relative">
					<strong className="font-bold">Notice:</strong>
					<span className="block sm:inline">
						{' '}
						Looking for torrents in the dark web. Please wait for 1-2 minutes.
					</span>
				</div>
			)}
			{errorMessage && (
				<div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
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
								onClick={async () => {
									setSearchState('loading');
									await instantCheckInRd(
										searchResults.map((result) => result.hash)
									);
									setSearchState('done');
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
								onClick={async () => {
									setSearchState('loading');
									await instantCheckInAd(
										searchResults.map((result) => result.hash)
									);
									setSearchState('done');
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
						</div>
					)}
					<div className="overflow-x-auto">
						<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
							{searchState !== 'loading' &&
								searchResults.map((r: SearchResult) => (
									<div
										key={r.hash}
										className={`
bg-white
${
	rd.isDownloaded(r.hash) || ad.isDownloaded(r.hash)
		? 'border-green-400'
		: rd.isDownloading(r.hash) || ad.isDownloading(r.hash)
		? 'border-red-400'
		: ''
}
border-2 shadow hover:shadow-lg transition-shadow duration-200 ease-in
rounded-lg overflow-hidden
`}
									>
										<div className="p-6 space-y-4">
											<h2 className="text-2xl font-bold leading-tight text-gray-900 break-words">
												{r.title}
											</h2>
											<p className="text-gray-500">
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
															isAvailableInRd(r)
																? 'green'
																: hasNoVideos(r)
																? 'gray'
																: 'blue'
														}-500 hover:bg-${
															isAvailableInRd(r)
																? 'green'
																: hasNoVideos(r)
																? 'gray'
																: 'blue'
														}-700 text-white py-2 px-4 rounded-full`}
														onClick={() => {
															handleAddAsMagnetInRd(
																r.hash,
																isAvailableInRd(r)
															);
														}}
													>
														{isAvailableInRd(r) ? (
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
															isAvailableInAd(r)
																? 'green'
																: hasNoVideos(r)
																? 'gray'
																: 'blue'
														}-500 hover:bg-${
															isAvailableInAd(r)
																? 'green'
																: hasNoVideos(r)
																? 'gray'
																: 'blue'
														}-700 text-white py-2 px-4 rounded-full`}
														onClick={() => {
															handleAddAsMagnetInAd(
																r.hash,
																isAvailableInAd(r)
															);
														}}
													>
														{isAvailableInAd(r) ? (
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
}

export default withAuth(Search);
