import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useDownloadsCache } from '@/hooks/cache';
import useLocalStorage from '@/hooks/localStorage';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInRd,
	handleCopyMagnet,
	handleSelectFilesInRd,
} from '@/utils/addMagnet';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { instantCheckInAd, instantCheckInRd, wrapLoading } from '@/utils/instantChecks';
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
import { FaDownload, FaFastForward, FaMagnet, FaTimes } from 'react-icons/fa';

type TvSearchProps = {
	title: string;
	description: string;
	poster: string;
	season_count: number;
	season_names: string[];
	imdb_score?: number;
};

const TvSearch: FunctionComponent<TvSearchProps> = ({
	title,
	description,
	poster,
	season_count,
	season_names,
	imdb_score,
}) => {
	const { publicRuntimeConfig: config } = getConfig();
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const rdKey = useRealDebridAccessToken();
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
	const { imdbid, seasonNum } = router.query;

	useEffect(() => {
		if (imdbid && seasonNum) {
			fetchData(imdbid as string, parseInt(seasonNum as string));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid, seasonNum]);

	const fetchData = async (imdbId: string, seasonNum: number) => {
		setSearchResults([]);
		setErrorMessage('');
		try {
			let path = `api/torrents/tv?imdbId=${imdbId}&seasonNum=${seasonNum}`;
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
					rdAvailable: false,
					adAvailable: false,
					noVideos: false,
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

	const intSeasonNum = parseInt(seasonNum as string);

	return (
		<div className="mx-4 my-8 max-w-full">
			<Head>
				<title>
					Debrid Media Manager - TV Show - {title} - Season {seasonNum}
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
						{title} - Season {seasonNum}
					</h2>
					<p>{description}</p>
					{imdb_score && (
						<p>
							<Link href={`https://www.imdb.com/title/${imdbid}/`}>
								IMDB Score: {imdb_score}
							</Link>
						</p>
					)}
					<>
						{Array.from({ length: season_count || 0 }, (_, i) => i + 1).map(
							(season, idx) => {
								const color = intSeasonNum === season ? 'red' : 'yellow';
								return (
									<Link
										key={idx}
										href={`/show/${imdbid}/${season}`}
										className={`mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-${color}-500 hover:bg-${color}-700 rounded mr-2 mb-2`}
									>
										<span role="img" aria-label="tv show" className="mr-2">
											📺
										</span>{' '}
										{season_names && season_names[season - 1]
											? season_names[season - 1]
											: `Season ${season}`}
									</Link>
								);
							}
						)}
					</>
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
								.map((r: SearchResult, i: number) => {
									const rdColor = r.noVideos
										? 'gray'
										: r.rdAvailable
										? 'green'
										: 'blue';
									const adColor = r.noVideos
										? 'gray'
										: r.adAvailable
										? 'green'
										: 'blue';
									return (
										<div
											key={i}
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
													<button
														className="flex items-center justify-center bg-pink-500 hover:bg-pink-700 text-white py-2 px-4 rounded-full"
														onClick={() => handleCopyMagnet(r.hash)}
													>
														<FaMagnet />
													</button>
													{rdKey &&
														rd.isDownloading(r.hash) &&
														rdCache![r.hash].id && (
															<button
																className="bg-red-500 hover:bg-red-700 text-white py-2 px-4 rounded-full"
																onClick={() => {
																	const id = rdCache![r.hash].id;
																	handleDeleteRdTorrent(
																		rdKey,
																		id,
																		removeFromRdCache
																	);
																}}
															>
																<FaTimes className="mr-2" />
																RD ({rdCache![r.hash].progress}%)
															</button>
														)}
													{rdKey && rd.notInLibrary(r.hash) && (
														<button
															className={`flex items-center justify-center bg-${rdColor}-500 hover:bg-${rdColor}-700 text-white py-2 px-4 rounded-full`}
															onClick={() =>
																handleAddAsMagnetInRd(
																	rdKey,
																	r.hash,
																	async (id: string) => {
																		await handleSelectFilesInRd(
																			rdKey,
																			`rd:${id}`,
																			removeFromRdCache,
																			true
																		);
																		rdCacheAdder.single(
																			`rd:${id}`,
																			r.hash,
																			r.rdAvailable
																		);
																	}
																)
															}
														>
															<>
																{r.rdAvailable ? (
																	<FaFastForward className="mr-2" />
																) : (
																	<FaDownload className="mr-2" />
																)}
																RD
															</>
														</button>
													)}
													{adKey &&
														ad.isDownloading(r.hash) &&
														adCache![r.hash].id && (
															<button
																className="bg-red-500 hover:bg-red-700 text-white py-2 px-4 rounded-full"
																onClick={() => {
																	const id = adCache![r.hash].id;
																	handleDeleteAdTorrent(
																		adKey,
																		id,
																		removeFromAdCache
																	);
																}}
															>
																<FaTimes className="mr-2" />
																AD ({adCache![r.hash].progress}%)
															</button>
														)}
													{adKey && ad.notInLibrary(r.hash) && (
														<button
															className={`flex items-center justify-center bg-${adColor}-500 hover:bg-${adColor}-700 text-white py-2 px-4 rounded-full`}
															onClick={() =>
																handleAddAsMagnetInAd(
																	adKey,
																	r.hash,
																	async (id: string) => {
																		adCacheAdder.single(
																			`ad:${id}`,
																			r.hash,
																			r.adAvailable
																		);
																	}
																)
															}
														>
															<>
																{r.adAvailable ? (
																	<FaFastForward className="mr-2" />
																) : (
																	<FaDownload className="mr-2" />
																)}
																AD
															</>
														</button>
													)}
												</div>
											</div>
										</div>
									);
								})}
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
	let season_count = 1;
	let season_names = [];
	let imdb_score;
	const showResponse = await axios.get(getMdbInfo(params!.imdbid as string));
	if (showResponse.data.type === 'show' && showResponse.data.seasons?.length !== 0) {
		const seasons = showResponse.data.seasons.filter((season: any) => season.season_number > 0);
		season_count = Math.max(...seasons.map((season: any) => season.season_number));
		season_names = seasons.map((season: any) => season.name);
		imdb_score = showResponse.data.ratings?.reduce((acc: number | undefined, rating: any) => {
			if (rating.source === 'imdb') {
				return rating.score as number;
			}
			return acc;
		}, null);

		if (params!.seasonNum && parseInt(params!.seasonNum as string) > season_count) {
			return {
				redirect: {
					destination: `/show/${params!.imdbid}/1`,
					permanent: false,
				},
			};
		}
	}
	return {
		props: {
			title: showResponse.data.title,
			description: showResponse.data.description,
			poster: showResponse.data.poster,
			season_count,
			season_names,
			imdb_score,
		},
	};
};

export default withAuth(TvSearch);
