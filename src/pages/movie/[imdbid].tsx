import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/realDebrid';
import { SearchProfile } from '@/services/searchProfile';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd, handleCopyMagnet } from '@/utils/addMagnet';
import { defaultPlayer } from '@/utils/chooseYourPlayer';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid } from '@/utils/fetchTorrents';
import { instantCheckInAd, instantCheckInRd, wrapLoading } from '@/utils/instantChecks';
import { isVideo } from '@/utils/selectable';
import { showInfo } from '@/utils/showInfo';
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
	const [searchProfile, setSearchProfile] = useState<SearchProfile>({
		stringSearch: '',
		lowerBound: 0,
		upperBound: Number.MAX_SAFE_INTEGER,
	});
	const [errorMessage, setErrorMessage] = useState('');
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [onlyShowCached, setOnlyShowCached] = useState<boolean>(true);
	const [uncachedCount, setUncachedCount] = useState<number>(0);

	const router = useRouter();
	const { imdbid } = router.query;

	async function fetchData(imdbId: string) {
		setSearchResults([]);
		setErrorMessage('');
		setSearchState('loading');
		setUncachedCount(0);
		try {
			let path = `api/torrents/movie?imdbId=${encodeURIComponent(imdbId)}`;
			if (config.externalSearchApiHostname) {
				path = encodeURIComponent(path);
			}
			let endpoint = `${config.externalSearchApiHostname || ''}/${path}`;
			const response = await axios.get<SearchApiResponse>(endpoint);
			if (response.status !== 200) {
				setSearchState(response.headers.status ?? 'loaded');
				return;
			}

			setSearchResults(response.data.results || []);

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
		showInfo(window.localStorage.getItem('player') || defaultPlayer, rdKey!, info);
	};

	return (
		<div className="max-w-full">
			<Head>
				<title>
					Debrid Media Manager - Movie - {title} ({year})
				</title>
			</Head>
			<Toaster position="bottom-right" />
			{/* Display basic movie info */}
			<div
				className="grid grid-flow-col auto-cols-auto auto-rows-auto gap-2"
				style={backdropStyle}
			>
				<Image
					width={200}
					height={300}
					src={poster}
					alt="Movie poster"
					className="shadow-lg row-span-4"
				/>
				<div className="flex justify-end p-2">
					<Link
						href="/"
						className="w-fit h-fit text-xs bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
					>
						Go Home
					</Link>
				</div>
				<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
					{title} ({year})
				</h2>
				<div className="w-fit h-fit bg-slate-900/75">
					{description}{' '}
					{imdb_score && (
						<div className="text-yellow-100 inline">
							<Link href={`https://www.imdb.com/title/${imdbid}/`} target="_blank">
								IMDB Score: {imdb_score}
							</Link>
						</div>
					)}
				</div>
				<div className="">
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
			{searchResults.length > 0 && (
				<div className="mx-2 my-1 overflow-x-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
					{searchResults
						.filter(
							(result) => !onlyShowCached || result.rdAvailable || result.adAvailable
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
									<div className="space-x-2 space-y-2">
										<button
											className="bg-pink-500 hover:bg-pink-700 text-white rounded inline px-1"
											onClick={() => handleCopyMagnet(r.hash)}
										>
											<FaMagnet className="inline" /> Get
										</button>
										{rdKey && inLibrary(r.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white rounded inline px-1"
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
												}-700 text-white rounded inline px-1`}
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
										{r.rdAvailable && (
											<button
												className="bg-sky-500 hover:bg-sky-700 text-white rounded inline px-1"
												onClick={() => handleShowInfo(r)}
											>
												👀 Watch
											</button>
										)}
										{adKey && inLibrary(r.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white rounded inline px-1"
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
												}-700 text-white rounded inline px-1`}
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

export default withAuth(MovieSearch);
