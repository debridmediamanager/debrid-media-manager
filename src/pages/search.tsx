import useMyAccount, { MyAccount } from '@/hooks/account';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useDownloadsCache } from '@/hooks/cache';
import useLocalStorage from '@/hooks/localStorage';
import {
	AdInstantAvailabilityResponse,
	adInstantCheck,
	deleteMagnet,
	MagnetFile,
	uploadMagnet,
} from '@/services/allDebrid';
import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	RdInstantAvailabilityResponse,
	rdInstantCheck,
	selectFiles,
} from '@/services/realDebrid';
import { groupBy } from '@/utils/groupBy';
import { getMediaId } from '@/utils/mediaId';
import { getSelectableFiles, isVideo } from '@/utils/selectable';
import { withAuth } from '@/utils/withAuth';
import { ParsedFilename } from '@ctrl/video-filename-parser';
import axios, { CancelTokenSource } from 'axios';
import getConfig from 'next/config';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { FaDownload, FaFastForward, FaTimes } from 'react-icons/fa';
import { SearchApiResponse } from './api/search';

type Availability = 'all:available' | 'rd:available' | 'ad:available' | 'unavailable' | 'no_videos';
type HashAvailability = Record<string, Availability>;

type SearchResult = {
	mediaId: string;
	title: string;
	fileSize: number;
	hash: string;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
	available: Availability;
};

type SearchFilter = {
	count: number;
	title: string;
	biggestFileSize: number;
};

const { publicRuntimeConfig: config } = getConfig();

function Search() {
	const [query, setQuery] = useState('');
	const [typedQuery, setTypedQuery] = useState('');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [filteredResults, setFilteredResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [loading, setLoading] = useState(false);
	const [cancelTokenSource, setCancelTokenSource] = useState<CancelTokenSource | null>(null);
	const [myAccount, setMyAccount] = useMyAccount();
	const [masterAvailability, setMasterAvailability] = useState<HashAvailability>({});
	const [searchFilters, setSearchFilters] = useState<Record<string, SearchFilter>>({});
	const [rdCache, rd, rdCacheAdder, removeFromRdCache] = useDownloadsCache('rd');
	const [adCache, ad, adCacheAdder, removeFromAdCache] = useDownloadsCache('ad');
	const [rdAutoInstantCheck, setRdAutoInstantCheck] = useLocalStorage<boolean>(
		'rdAutoInstantCheck',
		false
	);
	// const [adAutoInstantCheck, setAdAutoInstantCheck] = useLocalStorage<boolean>(
	// 	'adAutoInstantCheck',
	// 	false
	// );

	const router = useRouter();

	const fetchData = async (searchQuery: string) => {
		setSearchResults([]);
		setErrorMessage('');
		setLoading(true);
		const source = axios.CancelToken.source();
		setCancelTokenSource(source);
		try {
			let endpoint = `/api/search?search=${encodeURIComponent(searchQuery)}&libraryType=${
				myAccount?.libraryType
			}`;
			if (
				config.externalSearchApiHostname &&
				window.location.origin !== config.externalSearchApiHostname
			)
				endpoint = `${config.externalSearchApiHostname}${endpoint}`;
			if (config.bypassHostname && !endpoint.startsWith('/'))
				endpoint = `${config.bypassHostname}${encodeURIComponent(endpoint)}`;
			const response = await axios.get<SearchApiResponse>(endpoint, {
				cancelToken: source.token,
			});

			setSearchResults(
				response.data.searchResults?.map((r) => ({
					...r,
					mediaId: getMediaId(r.info, r.mediaType, false),
					available: 'unavailable',
				})) || []
			);
			setSearchFilters(
				response.data.searchResults?.reduce((acc, r) => {
					const mediaId = getMediaId(r.info, r.mediaType, true);
					if (acc[mediaId]) {
						acc[mediaId].count += 1;
						acc[mediaId].biggestFileSize = Math.max(
							acc[mediaId].biggestFileSize,
							r.fileSize
						);
					} else {
						acc[mediaId] = {
							title: getMediaId(r.info, r.mediaType, false),
							biggestFileSize: r.fileSize,
							count: 1,
						};
					}
					return acc;
				}, {} as Record<string, SearchFilter>)!
			);
			if (response.data.searchResults?.length) {
				toast(`Found ${response.data.searchResults.length} results`, { icon: '🔍' });

				// instant checks
				const hashArr = response.data.searchResults.map((r) => r.hash);
				if (rdKey && rdAutoInstantCheck) await instantCheckInRd(hashArr);
				// if (adKey && adAutoInstantCheck) await instantCheckInAd(hashArr);
			} else {
				toast(`No results found`, { icon: '🔍' });
			}
		} catch (error) {
			if (axios.isCancel(error)) {
				console.warn('Request canceled:', error);
			} else {
				console.log(error);
				setErrorMessage('There was an error searching for the query. Please try again.');
			}
		} finally {
			setLoading(false);
		}
	};

	const handleLibraryTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		setMyAccount({ ...myAccount, libraryType: event.target.value as MyAccount['libraryType'] });
	};

	const handleSubmit = useCallback(
		(e?: React.FormEvent<HTMLFormElement>) => {
			if (e) e.preventDefault();
			if (!typedQuery) return;
			router.push({
				query: { ...router.query, query: encodeURIComponent(typedQuery) },
			});
		},
		[router, typedQuery]
	);

	useEffect(() => {
		const { query: searchQuery } = router.query;
		if (!searchQuery) return;
		const decodedQuery = decodeURIComponent(searchQuery as string);
		if (decodedQuery === query) return;
		setQuery(decodedQuery);
		fetchData(decodedQuery);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query, myAccount]);

	useEffect(() => {
		setSearchResults((prev) =>
			prev.map((r) => ({
				...r,
				available: masterAvailability[r.hash],
			}))
		);
	}, [masterAvailability]);

	useEffect(() => {
		const { filter } = router.query;
		if (!filter) {
			setFilteredResults(searchResults);
		} else {
			const decodedFilter = decodeURIComponent(filter as string);
			setFilteredResults(
				searchResults.filter((r) => r.mediaId.toLocaleLowerCase() === decodedFilter)
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query, searchResults]);

	useEffect(() => {
		return () => {
			if (cancelTokenSource) cancelTokenSource.cancel();
		};
	}, [cancelTokenSource]);

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
				{ icon: '🔍' }
			);
			setMasterAvailability({ ...masterAvailability, ...rdAvailability });
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
				{ icon: '🔍' }
			);
			setMasterAvailability({ ...masterAvailability, ...adAvailability });
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
				<title>Debrid Media Manager - Search: {query}</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">Search</h1>
				<Link
					href="/"
					className="text-2xl bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			<form onSubmit={handleSubmit}>
				<div className="flex items-center border-b border-b-2 border-gray-500 py-2 mb-4">
					<input
						className="appearance-none bg-transparent border-none w-full text-gray-700 mr-3 py-1 px-2 leading-tight focus:outline-none"
						type="text"
						id="query"
						placeholder="if movie, add year e.g. greatest showman 2017; if tv series, add s01 e.g. game of thrones s01"
						value={typedQuery}
						onChange={(e) => setTypedQuery(e.target.value)}
					/>
					<select
						id="libraryType"
						value={myAccount!.libraryType}
						onChange={handleLibraryTypeChange}
						className="border rounded p-1 mr-4"
					>
						<option value="1080p">1080p</option>
						<option value="2160p">2160p</option>
						<option value="1080pOr2160p">does not matter</option>
					</select>
					<button
						className="flex-shrink-0 bg-gray-700 hover:bg-gray-600 border-gray-700 hover:border-gray-600 text-sm border-4 text-white py-1 px-2 rounded"
						type="submit"
					>
						Search
					</button>
				</div>
			</form>
			{loading && (
				<div className="flex justify-center items-center mt-4">
					<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
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
					{!loading && (
						<div
							className="mb-4 pb-1 whitespace-nowrap overflow-x-scroll"
							style={{ scrollbarWidth: 'thin' }}
						>
							<button
								className={`mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded`}
								onClick={async () => {
									setLoading(true);
									await instantCheckInRd(
										searchResults.map((result) => result.hash)
									);
									setLoading(false);
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
									setLoading(true);
									await instantCheckInAd(
										searchResults.map((result) => result.hash)
									);
									setLoading(false);
								}}
							>
								Check AD availability
							</button>
							{/* <input
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
							</label> */}
							<Link
								href={`/search?query=${query}`}
								className={`mr-2 mb-2 bg-yellow-400 hover:bg-yellow-500 text-black py-1 px-2 rounded`}
							>
								Reset
							</Link>
							{Object.keys(searchFilters)
								.sort(
									(a, b) =>
										searchFilters[b].biggestFileSize -
										searchFilters[a].biggestFileSize
								)
								.map((mediaId) => (
									<button
										key={mediaId}
										className={`mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded`}
										onClick={async () => {
											router.push({
												query: { ...router.query, filter: mediaId },
											});
										}}
									>
										{searchFilters[mediaId].title} -{' '}
										{searchFilters[mediaId].biggestFileSize}GB{' '}
										<sup>{searchFilters[mediaId].count}</sup>
									</button>
								))}
						</div>
					)}
					<h2 className="text-2xl font-bold my-4">
						Search Results for &quot;{query}&quot;
					</h2>
					<div className="overflow-x-auto">
						<table className="max-w-full w-full table-auto">
							<thead>
								<tr>
									<th className="px-4 py-2">Title</th>
									<th className="px-4 py-2">Size</th>
									<th className="px-4 py-2"></th>
								</tr>
							</thead>
							<tbody>
								{filteredResults.map((r: SearchResult) => (
									<tr
										key={r.hash}
										className={`
											hover:bg-purple-100
											${
												rd.isDownloaded(r.hash) || ad.isDownloaded(r.hash)
													? 'bg-green-100'
													: rd.isDownloading(r.hash) ||
													  ad.isDownloading(r.hash)
													? 'bg-red-100'
													: ''
											}
										`}
									>
										<td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 max-w-2xl overflow-hidden overflow-ellipsis">
											<strong>{r.mediaId}</strong>
											<br />
											{r.title}
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
											{r.fileSize} GB
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
											{rd.isDownloading(r.hash) && rdCache![r.hash].id && (
												<button
													className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
													onClick={() => {
														handleDeleteTorrent(rdCache![r.hash].id);
													}}
												>
													<FaTimes />
													RD ({rdCache![r.hash].progress}%)
												</button>
											)}
											{rdKey && rd.notInLibrary(r.hash) && (
												<button
													className={`bg-${
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
													}-700 text-white font-bold py-2 px-4 rounded`}
													onClick={() => {
														handleAddAsMagnetInRd(
															r.hash,
															isAvailableInRd(r)
														);
													}}
												>
													{isAvailableInRd(r) ? (
														<>
															<FaFastForward />
															RD
														</>
													) : (
														<>
															<FaDownload />
															RD
														</>
													)}
												</button>
											)}
											{ad.isDownloading(r.hash) && adCache![r.hash].id && (
												<button
													className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
													onClick={() => {
														handleDeleteTorrent(adCache![r.hash].id);
													}}
												>
													<FaTimes />
													AD ({adCache![r.hash].progress}%)
												</button>
											)}
											{adKey && ad.notInLibrary(r.hash) && (
												<button
													className={`bg-${
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
													}-700 text-white font-bold py-2 px-4 rounded`}
													onClick={() => {
														handleAddAsMagnetInAd(
															r.hash,
															isAvailableInAd(r)
														);
													}}
												>
													{isAvailableInAd(r) ? (
														<>
															<FaFastForward />
															AD
														</>
													) : (
														<>
															<FaDownload />
															AD
														</>
													)}
												</button>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}
			{Object.keys(router.query).length !== 0 && searchResults.length === 0 && !loading && (
				<>
					<h2 className="text-2xl font-bold my-4">No results found</h2>
				</>
			)}
		</div>
	);
}

export default withAuth(Search);
