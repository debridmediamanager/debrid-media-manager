import useMyAccount, { MyAccount } from '@/hooks/account';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useDownloadsCache } from '@/hooks/cache';
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

type SearchResult = {
	title: string;
	fileSize: number;
	hash: string;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
	available: Availability;
};

const { publicRuntimeConfig: config } = getConfig();

function Search() {
	const [query, setQuery] = useState('');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [loading, setLoading] = useState(false);
	const [cancelTokenSource, setCancelTokenSource] = useState<CancelTokenSource | null>(null);
	const [myAccount, setMyAccount] = useMyAccount();
	const [rdCache, rd, rdCacheAdder, removeFromRdCache] = useDownloadsCache('rd');
	const [adCache, ad, adCacheAdder, removeFromAdCache] = useDownloadsCache('ad');

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
				response.data.searchResults?.map((r) => ({ ...r, available: 'unavailable' })) || []
			);
			if (response.data.searchResults?.length) {
				toast(`Found ${response.data.searchResults.length} results`, { icon: '🔍' });
				const availability = await instantCheckInRd(
					response.data.searchResults.map((result) => result.hash)
				);
				toast(
					`Found ${
						Object.values(availability).filter((a) => a.includes(':available')).length
					} available in RD`,
					{ icon: '🔍' }
				);
				setSearchResults((prev) =>
					prev.map((r) => ({ ...r, available: availability[r.hash] }))
				);
			} else {
				toast(`No results found`, { icon: '🔍' });
				setSearchResults([]);
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
			if (!query) return;
			router.push({
				query: { ...router.query, query: encodeURIComponent(query) },
			});
		},
		[router, query]
	);

	useEffect(() => {
		const { query: searchQuery } = router.query;
		if (!searchQuery) return;
		const decodedQuery = decodeURIComponent(searchQuery as string);
		setQuery(decodedQuery);
		fetchData(decodedQuery);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query, myAccount]);

	useEffect(() => {
		return () => {
			if (cancelTokenSource) cancelTokenSource.cancel();
		};
	}, [cancelTokenSource]);

	type HashAvailability = Record<string, Availability>;

	const instantCheckInRd = async (hashes: string[]): Promise<HashAvailability> => {
		const availability = hashes.reduce((acc: HashAvailability, curr: string) => {
			acc[curr] = 'unavailable';
			return acc;
		}, {});

		if (!rdKey) return availability;

		const setInstantFromRd = (rdAvailabilityResp: RdInstantAvailabilityResponse) => {
			for (const masterHash in rdAvailabilityResp) {
				if ('rd' in rdAvailabilityResp[masterHash] === false) continue;
				const variants = rdAvailabilityResp[masterHash]['rd'];
				if (variants.length) availability[masterHash] = 'no_videos';
				for (const variant of variants) {
					for (const fileId in variant) {
						const file = variant[fileId];
						if (isVideo({ path: file.filename })) {
							availability[masterHash] =
								availability[masterHash] === 'ad:available'
									? 'all:available'
									: 'rd:available';
							break;
						}
					}
				}
			}
		};

		const groupBy = (itemLimit: number, hashes: string[]) =>
			Array.from({ length: Math.ceil(hashes.length / itemLimit) }, (_, i) =>
				hashes.slice(i * itemLimit, (i + 1) * itemLimit)
			);

		try {
			for (const hashGroup of groupBy(100, hashes)) {
				if (rdKey) await rdInstantCheck(rdKey, hashGroup).then(setInstantFromRd);
			}
			return availability;
		} catch (error) {
			toast.error(
				'There was an error checking availability in Real-Debrid. Please try again.'
			);
			throw error;
		}
	};

	// TODO: Add AD instant check-in support
	const instantCheckInAd = async (
		hashes: string[],
		existingAvailability?: HashAvailability
	): Promise<HashAvailability> => {
		const availability =
			existingAvailability ||
			hashes.reduce((acc: HashAvailability, curr: string) => {
				acc[curr] = 'unavailable';
				return acc;
			}, {});

		if (!adKey) return availability;

		const setInstantFromAd = (adAvailabilityResp: AdInstantAvailabilityResponse) => {
			for (const magnetData of adAvailabilityResp.data.magnets) {
				const masterHash = magnetData.hash;
				const instant = magnetData.instant;

				if (masterHash in availability && instant === true) {
					availability[masterHash] = magnetData.files?.reduce(
						(acc: boolean, curr: MagnetFile) => {
							if (isVideo({ path: curr.n })) {
								return true;
							}
							return acc;
						},
						false
					)
						? availability[masterHash] === 'rd:available'
							? 'all:available'
							: 'ad:available'
						: 'no_videos';
				}
			}
		};

		const groupBy = (itemLimit: number, hashes: string[]) =>
			Array.from({ length: Math.ceil(hashes.length / itemLimit) }, (_, i) =>
				hashes.slice(i * itemLimit, (i + 1) * itemLimit)
			);

		try {
			for (const hashGroup of groupBy(30, hashes)) {
				if (adKey) await adInstantCheck(adKey, hashGroup).then(setInstantFromAd);
			}
			return availability;
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

	const handleDeleteTorrent = async (id: string, disableToast: boolean = false) => {
		try {
			if (!rdKey && !adKey) throw new Error('no_keys');
			if (rdKey && id.startsWith('rd:')) await deleteTorrent(rdKey, id.substring(3));
			if (adKey && id.startsWith('ad:')) await deleteMagnet(adKey, id.substring(3));
			if (!disableToast) toast.success(`Download canceled (${id})`);
			if (id.startsWith('rd:')) removeFromRdCache(id.substring(3));
			if (id.startsWith('ad:')) removeFromAdCache(id.substring(3));
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
		<div className="mx-4 my-8">
			<Head>
				<title>Debrid Media Manager - Search: {query}</title>
			</Head>
			<Toaster position="top-right" />
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
				<div className="flex items-center border-b border-b-2 border-gray-500 py-2">
					<input
						className="appearance-none bg-transparent border-none w-full text-gray-700 mr-3 py-1 px-2 leading-tight focus:outline-none"
						type="text"
						id="query"
						placeholder="if movie, add year e.g. greatest showman 2017; if tv series, add s01 e.g. game of thrones s01"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
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
			</form>
			{searchResults.length > 0 && (
				<>
					<h2 className="text-2xl font-bold my-4">Search Results</h2>
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
								{searchResults.map((r: SearchResult) => (
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
											<strong>
												{getMediaId(r.info, r.mediaType, false)}
											</strong>
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
														isAvailableInRd(r) ? 'green' : 'blue'
													}-500 hover:bg-${
														isAvailableInRd(r) ? 'green' : 'blue'
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
														isAvailableInAd(r) ? 'green' : 'blue'
													}-500 hover:bg-${
														isAvailableInAd(r) ? 'green' : 'blue'
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
