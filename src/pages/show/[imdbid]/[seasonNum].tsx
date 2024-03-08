import Poster from '@/components/poster';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/realDebrid';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd, handleCopyMagnet } from '@/utils/addMagnet';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid } from '@/utils/fetchTorrents';
import { instantCheckInAd, instantCheckInRd, wrapLoading } from '@/utils/instantChecks';
import { borderColor, btnColor, btnIcon, fileSize, sortByMedian } from '@/utils/results';
import { isVideo } from '@/utils/selectable';
import { defaultEpisodeSize, defaultPlayer } from '@/utils/settings';
import { showInfoForRD } from '@/utils/showInfo';
import { searchToastOptions } from '@/utils/toastOptions';
import { generateTokenAndHash } from '@/utils/token';
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
};

const torrentDB = new UserTorrentDB();

const TvSearch: FunctionComponent<TvSearchProps> = ({
	title,
	description,
	poster,
	backdrop,
	season_count,
	season_names,
	imdb_score,
}) => {
	const player = window.localStorage.getItem('player') || defaultPlayer;
	const episodeMaxSize = window.localStorage.getItem('episodeMaxSize') || defaultEpisodeSize;
	const { publicRuntimeConfig: config } = getConfig();
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [onlyShowCached, setOnlyShowCached] = useState<boolean>(true);
	const [uncachedCount, setUncachedCount] = useState<number>(0);

	const router = useRouter();
	const { imdbid, seasonNum } = router.query;

	async function initialize() {
		await torrentDB.initializeDB();
		await Promise.all([
			fetchData(imdbid as string, parseInt(seasonNum as string)),
			fetchHashAndProgress(),
		]);
	}

	useEffect(() => {
		if (!imdbid || !seasonNum) return;
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imdbid, seasonNum]);

	async function fetchData(imdbId: string, seasonNum: number) {
		const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
		setSearchResults([]);
		setErrorMessage('');
		setSearchState('loading');
		setUncachedCount(0);
		try {
			let path = `api/torrents/tv?imdbId=${imdbId}&seasonNum=${seasonNum}&dmmProblemKey=${tokenWithTimestamp}&solution=${tokenHash}`;
			if (config.externalSearchApiHostname) {
				path = encodeURIComponent(path);
			}
			let endpoint = `${config.externalSearchApiHostname || ''}/${path}`;
			const response = await axios.get<SearchApiResponse>(endpoint);
			if (response.status !== 200) {
				setSearchState(response.headers.status ?? 'loaded');
				return;
			}

			setSearchResults(
				response.data.results?.map((r) => ({
					...r,
					rdAvailable: false,
					adAvailable: false,
					noVideos: false,
					files: [],
				})) || []
			);

			if (response.data.results?.length) {
				toast(`Found ${response.data.results.length} results`, searchToastOptions);

				// instant checks
				const hashArr = response.data.results.map((r) => r.hash);
				const instantChecks = [];
				if (rdKey)
					instantChecks.push(
						wrapLoading('RD', instantCheckInRd(rdKey, hashArr, setSearchResults))
					);
				if (adKey)
					instantChecks.push(
						wrapLoading('AD', instantCheckInAd(adKey, hashArr, setSearchResults))
					);
				const counts = await Promise.all(instantChecks);
				setSearchState('loaded');
				setUncachedCount(hashArr.length - counts.reduce((acc, cur) => acc + cur, 0));
			} else {
				toast(`No results found`, searchToastOptions);
			}
		} catch (error) {
			console.error(error);
			setErrorMessage('There was an error searching for the query. Please try again.');
		} finally {
			setSearchState('loaded');
		}
	}

	// sort search results by size
	useEffect(() => {
		setSearchResults(sortByMedian(searchResults));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchResults]);

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
			await handleDeleteAdTorrent(rdKey!, t.id);
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
		rdKey && showInfoForRD(player, rdKey!, info);
	};

	return (
		<div className="max-w-full">
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
						className="shadow-lg row-span-4"
					/>
				)) || <Poster imdbId={imdbid as string} title={title} />}
				<div className="flex justify-end p-2">
					<Link
						href="/"
						className="w-fit h-fit text-xs bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
					>
						Go Home
					</Link>
				</div>
				<h2 className="block text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
					<span className="whitespace-nowrap">{title}</span> -{' '}
					<span className="whitespace-nowrap">Season {seasonNum}</span>
				</h2>
				<div className="w-fit h-fit bg-slate-900/75">
					{description}{' '}
					{imdb_score > 0 && (
						<div className="text-yellow-100 inline">
							<Link href={`https://www.imdb.com/title/${imdbid}/`} target="_blank">
								IMDB Score: {imdb_score}
							</Link>
						</div>
					)}
				</div>
				<div className="">
					{Array.from({ length: season_count || 0 }, (_, i) => i + 1).map(
						(season, idx) => {
							const color = intSeasonNum === season ? 'red' : 'yellow';
							return (
								<Link
									key={idx}
									href={`/show/${imdbid}/${season}`}
									className={`w-fit inline-flex items-center p-1 text-xs text-white bg-${color}-500 hover:bg-${color}-700 rounded mr-2 mb-2`}
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
					{onlyShowCached && uncachedCount > 0 && (
						<button
							className={`mr-2 mt-0 mb-2 bg-blue-700 hover:bg-blue-600 text-white p-1 text-xs rounded`}
							onClick={() => {
								setOnlyShowCached(false);
							}}
						>
							👉 Show {uncachedCount} uncached results
						</button>
					)}
				</div>
			</div>

			{searchState === 'loading' && (
				<div className="float-start flex justify-center items-center bg-black">
					Loading...
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
				<div className="mx-2 my-1 overflow-x-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
					{searchResults.map((r: SearchResult, i: number) => {
						const downloaded = isDownloaded('rd', r.hash) || isDownloaded('ad', r.hash);
						const downloading =
							isDownloading('rd', r.hash) || isDownloading('ad', r.hash);
						const inYourLibrary = downloaded || downloading;
						if (onlyShowCached && !r.rdAvailable && !r.adAvailable && !inYourLibrary)
							return;
						if (
							episodeMaxSize !== '0' &&
							(r.medianFileSize ?? r.fileSize) > parseFloat(episodeMaxSize) * 1024 &&
							!inYourLibrary
						)
							return;
						const rdColor = btnColor(r.rdAvailable, r.noVideos);
						const adColor = btnColor(r.adAvailable, r.noVideos);
						return (
							<div
								key={i}
								className={`${borderColor(
									isDownloaded('rd', r.hash) || isDownloaded('ad', r.hash),
									isDownloading('rd', r.hash) || isDownloading('ad', r.hash)
								)} shadow hover:shadow-lg transition-shadow duration-200 ease-in rounded-lg overflow-hidden`}
							>
								<div className="p-2 space-y-4">
									<h2 className="text-xl font-bold leading-tight break-words">
										{r.title}
									</h2>

									<div className="text-gray-300">
										Total: {fileSize(r.fileSize)} GB
									</div>
									{r.videoCount > 0 && (
										<span className="text-gray-300 mt-0 text-sm">
											Median: {fileSize(r.medianFileSize)} GB ({r.videoCount}{' '}
											📂)
										</span>
									)}

									<div className="space-x-2 space-y-2">
										<button
											className="bg-pink-500 hover:bg-pink-700 text-white rounded inline px-1"
											onClick={() => handleCopyMagnet(r.hash)}
										>
											<FaMagnet className="inline" /> Get&nbsp;magnet
										</button>

										{/* RD */}
										{rdKey && inLibrary('rd', r.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white rounded inline px-1"
												onClick={() => deleteRd(r.hash)}
											>
												<FaTimes className="mr-2 inline" />
												RD ({hashAndProgress[`rd:${r.hash}`] + '%'})
											</button>
										)}
										{rdKey && notInLibrary('rd', r.hash) && (
											<button
												className={`bg-${rdColor}-500 hover:bg-${rdColor}-700 text-white rounded inline px-1`}
												onClick={() => addRd(r.hash)}
											>
												{btnIcon(r.rdAvailable)}
												Add&nbsp;to&nbsp;RD&nbsp;library
											</button>
										)}

										{/* AD */}
										{adKey && inLibrary('ad', r.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white rounded inline px-1"
												onClick={() => deleteAd(r.hash)}
											>
												<FaTimes className="mr-2 inline" />
												AD ({hashAndProgress[`ad:${r.hash}`] + '%'})
											</button>
										)}
										{adKey && notInLibrary('ad', r.hash) && (
											<button
												className={`bg-${adColor}-500 hover:bg-${adColor}-700 text-white rounded inline px-1`}
												onClick={() => addAd(r.hash)}
											>
												{btnIcon(r.adAvailable)}
												Add&nbsp;to&nbsp;AD&nbsp;library
											</button>
										)}

										{(r.rdAvailable || r.adAvailable) && (
											<button
												className="bg-sky-500 hover:bg-sky-700 text-white rounded inline px-1"
												onClick={() => handleShowInfo(r)}
											>
												👀 Look Inside
											</button>
										)}
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
		},
	};
};

export default withAuth(TvSearch);
