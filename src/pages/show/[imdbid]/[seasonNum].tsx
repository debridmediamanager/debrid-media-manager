import Poster from '@/components/poster';
import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxApiKey } from '@/hooks/auth';
import { useCastToken } from '@/hooks/cast';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/realDebrid';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd, handleAddAsMagnetInTb, handleCopyMagnet } from '@/utils/addMagnet';
import { handleCastTvShow } from '@/utils/cast';
import { handleDeleteAdTorrent, handleDeleteRdTorrent, handleDeleteTbTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid, fetchTorBox } from '@/utils/fetchTorrents';
import { instantCheckInAd, instantCheckInRd, wrapLoading, instantCheckInTb } from '@/utils/instantChecks';
import { applyQuickSearch2 } from '@/utils/quickSearch';
import { borderColor, btnColor, btnIcon, fileSize, sortByMedian } from '@/utils/results';
import { isVideo } from '@/utils/selectable';
import { defaultEpisodeSize, defaultPlayer } from '@/utils/settings';
import { showInfoForRD } from '@/utils/showInfo';
import { castToastOptions, searchToastOptions } from '@/utils/toastOptions';
import { generateTokenAndHash } from '@/utils/token';
import { withAuth } from '@/utils/withAuth';
import axios, { AxiosError } from 'axios';
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
	const player = window.localStorage.getItem('settings:player') || defaultPlayer;
	const episodeMaxSize =
		window.localStorage.getItem('settings:episodeMaxSize') || defaultEpisodeSize;
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
	const tbKey = useTorBoxApiKey();
	const [onlyShowCached, setOnlyShowCached] = useState<boolean>(true);
	const [uncachedCount, setUncachedCount] = useState<number>(0);
	const dmmCastToken = useCastToken();

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
			let path = `api/torrents/tv?imdbId=${imdbId}&seasonNum=${seasonNum}&dmmProblemKey=${tokenWithTimestamp}&solution=${tokenHash}&onlyTrusted=${onlyTrustedTorrents}`;
			// if (config.externalSearchApiHostname) {
			// 	path = encodeURIComponent(path);
			// }
			let endpoint = `${config.externalSearchApiHostname || ''}/${path}`;
			const response = await axios.get<SearchApiResponse>(endpoint);
			if (response.status !== 200) {
				setSearchState(response.headers.status ?? 'loaded');
				return;
			}

			if (response.data.results?.length) {
				const results = sortByMedian(response.data.results);

				setSearchResults(
					results.map((r) => ({
						...r,
						rdAvailable: false,
						adAvailable: false,
						tbAvailable: false,
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
						wrapLoading('RD', instantCheckInRd(rdKey, hashArr, setSearchResults))
					);
				if (adKey)
					instantChecks.push(
						wrapLoading('AD', instantCheckInAd(adKey, hashArr, setSearchResults))
					);
				if (tbKey) {
					instantChecks.push(
						wrapLoading('TorBox cache', instantCheckInTb(tbKey, hashArr, setSearchResults))
					)
				}
				const counts = await Promise.all(instantChecks);
				setSearchState('loaded');
				setUncachedCount(hashArr.length - counts.reduce((acc, cur) => acc + cur, 0));
			} else {
				setSearchResults([]);
				toast(`No results found`, searchToastOptions);
			}
		} catch (error) {
			console.error(error);
			if ((error as AxiosError).response?.status === 403) {
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

	// tokens
	useEffect(() => {
		if (searchState === 'loading') return;
		const tokens = new Map<string, number>();
		// filter by cached
		const toProcess = searchResults.filter((r) => r.rdAvailable || r.adAvailable || r.tbAvailable);
		toProcess.forEach((r) => {
			r.title.split(/[ .\-\[\]]/).forEach((word) => {
				if (word.length < 3) return;
				// skip if word is in title
				if (title.toLowerCase().includes(word.toLowerCase())) return;
				word = word.toLowerCase();
				if (tokens.has(word)) {
					tokens.set(word, tokens.get(word)! + 1);
				} else {
					tokens.set(word, 1);
				}
			});
		});
		// iterate through tokens
		let tokenEntries = Array.from(tokens.entries());
		// sort by count
		tokenEntries = tokenEntries.sort((a, b) => b[1] - a[1]);
		// get only the tokens
		const tokensArr = tokenEntries.map((a) => a[0].toLowerCase());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchState]);

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
			await handleDeleteAdTorrent(adKey!, t.id);
			await torrentDB.deleteByHash('ad', hash);
			setHashAndProgress((prev) => {
				const newHashAndProgress = { ...prev };
				delete newHashAndProgress[`ad:${hash}`];
				return newHashAndProgress;
			});
		}
	}

	async function addTb(hash: string) {
		await handleAddAsMagnetInTb(tbKey!, hash);
		await fetchTorBox(
			tbKey!,
			async (torrents: UserTorrent[]) => await torrentDB.addAll(torrents)
		)
		await fetchHashAndProgress();
	}

	async function deleteTb(hash: string) {
		const torrents = await torrentDB.getAllByHash(hash);
		for (const t of torrents) {
			if (!t.id.startsWith('tb:')) continue;
			await handleDeleteTbTorrent(tbKey!, t.id);
			await torrentDB.deleteByHash('tb', hash);
			setHashAndProgress((prev) => {
				const newHashAndProgress = { ...prev };
				delete newHashAndProgress[`tb:${hash}`];
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
		rdKey && showInfoForRD(player, rdKey!, info, dmmCastToken ?? '', imdbid as string, 'tv');
	};

	async function handleCast(hash: string, fileIds: string[]) {
		await toast.promise(
			handleCastTvShow(dmmCastToken!, imdbid as string, rdKey!, hash, fileIds),
			{
				loading: `Casting ${fileIds.length} episodes`,
				success: 'Casting successful',
				error: 'Casting failed',
			},
			castToastOptions
		);
	}

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
						className="shadow-lg row-span-5"
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
				<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
					{title} - Season {seasonNum}
				</h2>
				<div className="w-fit h-fit bg-slate-900/75" onClick={() => setDescLimit(0)}>
					{descLimit > 0 ? description.substring(0, descLimit) + '..' : description}{' '}
					{imdb_score > 0 && (
						<div className="text-yellow-100 inline">
							<Link href={`https://www.imdb.com/title/${imdbid}/`} target="_blank">
								IMDB Score: {imdb_score < 10 ? imdb_score : imdb_score / 10}
							</Link>
						</div>
					)}
				</div>
				<div className="flex items-center overflow-x-auto">
					{Array.from({ length: season_count || 0 }, (_, i) => i + 1).map(
						(season, idx) => {
							const color = intSeasonNum === season ? 'red' : 'yellow';
							return (
								<Link
									key={idx}
									href={`/show/${imdbid}/${season}`}
									className={`inline-flex items-center p-1 text-xs text-white bg-${color}-500 hover:bg-${color}-700 rounded mr-2 mb-1`}
								>
									<span role="img" aria-label="tv show" className="mr-2">
										📺
									</span>{' '}
									<span className="whitespace-nowrap">
										{season_names && season_names[season - 1]
											? season_names[season - 1]
											: `Season ${season}`}
									</span>
								</Link>
							);
						}
					)}
				</div>
				<div>
					{onlyShowCached && uncachedCount > 0 && (
						<button
							className={`mr-2 mt-0 mb-1 bg-blue-700 hover:bg-blue-600 text-white p-1 text-xs rounded`}
							onClick={() => {
								setOnlyShowCached(false);
							}}
						>
							👉 Show {uncachedCount} uncached
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
			<div className="flex items-center border-b-2 border-gray-500 py-2 mb-1">
				<input
					className="appearance-none bg-transparent border-none w-full text-sm text-white mr-3 py-1 px-2 leading-tight focus:outline-none"
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
			{/* <div className="flex items-center p-1 mb-1 overflow-x-auto">
				<span className="bg-blue-100 text-blue-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300 cursor-pointer">
					S01
				</span>
				<span className="bg-blue-100 text-blue-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300 cursor-pointer">
					S01E01
				</span>
				<span className="bg-blue-100 text-blue-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300 cursor-pointer">
					S01E02
				</span>
				<span className="bg-blue-100 text-blue-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300 cursor-pointer">
					S01E03
				</span>
				<span className="bg-blue-100 text-blue-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300 cursor-pointer">
					S01E04
				</span>
				<span className="bg-blue-100 text-blue-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300 cursor-pointer">
					S01E05
				</span>
				<span className="bg-blue-100 text-blue-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300 cursor-pointer">
					S01E06
				</span>
			</div> */}
			{searchResults.length > 0 && (
				<div className="mx-2 my-1 overflow-x-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
					{filteredResults.map((r: SearchResult, i: number) => {
						const downloaded = isDownloaded('rd', r.hash) || isDownloaded('ad', r.hash) || isDownloaded('tb', r.hash)
						const downloading =
							isDownloading('rd', r.hash) || isDownloading('ad', r.hash) || isDownloading('tb', r.hash)
						const inYourLibrary = downloaded || downloading;
						if (onlyShowCached && !r.rdAvailable && !r.adAvailable && !r.tbAvailable && !inYourLibrary)
							return;
						if (
							episodeMaxSize !== '0' &&
							(r.medianFileSize ?? r.fileSize) > parseFloat(episodeMaxSize) * 1024 &&
							!inYourLibrary
						)
							return;
						const rdColor = btnColor(r.rdAvailable, r.noVideos);
						const adColor = btnColor(r.adAvailable, r.noVideos);
						let epRegex1 = /S(\d+)\s?E(\d+)/i;
						let epRegex2 = /[^\d](\d{1,2})x(\d{1,2})[^\d]/i;
						const castableFileIds = r.files
							.filter((f) => f.filename.match(epRegex1) || f.filename.match(epRegex2))
							.map((f) => `${f.fileId}`);
						return (
							<div
								key={i}
								className={`${borderColor(
									downloaded,
									downloading
								)} shadow hover:shadow-lg transition-shadow duration-200 ease-in rounded-lg overflow-hidden`}
							>
								<div className="p-2 space-y-4">
									<h2 className="text-lg font-bold leading-tight break-words line-clamp-3 overflow-hidden text-ellipsis">
										{r.title}
									</h2>

									{r.videoCount > 0 ? (
										<div className="text-gray-300 text-xs">
											Total: {fileSize(r.fileSize)} GB; Median:{' '}
											{fileSize(r.medianFileSize)} GB ({r.videoCount} 📂)
										</div>
									) : (
										<div className="text-gray-300 text-xs">
											Total: {fileSize(r.fileSize)} GB
										</div>
									)}

									<div className="space-x-2 space-y-2">
										<button
											className="bg-pink-500 hover:bg-pink-700 text-white text-xs rounded inline px-1"
											onClick={() => handleCopyMagnet(r.hash)}
										>
											<FaMagnet className="inline" /> Get&nbsp;magnet
										</button>

										{/* RD */}
										{rdKey && inLibrary('rd', r.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white text-xs rounded inline px-1"
												onClick={() => deleteRd(r.hash)}
											>
												<FaTimes className="mr-2 inline" />
												RD ({hashAndProgress[`rd:${r.hash}`] + '%'})
											</button>
										)}
										{rdKey && notInLibrary('rd', r.hash) && (
											<button
												className={`bg-${rdColor}-500 hover:bg-${rdColor}-700 text-white text-xs rounded inline px-1`}
												onClick={() => addRd(r.hash)}
											>
												{btnIcon(r.rdAvailable)}
												Add&nbsp;to&nbsp;RD&nbsp;library
											</button>
										)}

										{/* AD */}
										{adKey && inLibrary('ad', r.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white text-xs rounded inline px-1"
												onClick={() => deleteAd(r.hash)}
											>
												<FaTimes className="mr-2 inline" />
												AD ({hashAndProgress[`ad:${r.hash}`] + '%'})
											</button>
										)}
										{adKey && notInLibrary('ad', r.hash) && (
											<button
												className={`bg-${adColor}-500 hover:bg-${adColor}-700 text-white text-xs rounded inline px-1`}
												onClick={() => addAd(r.hash)}
											>
												{btnIcon(r.adAvailable)}
												Add&nbsp;to&nbsp;AD&nbsp;library
											</button>
										)}

										{/* TB */}
										{tbKey && inLibrary('tb', r.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white text-xs rounded inline px-1"
												onClick={() => deleteTb(r.hash)}
											>
												<FaTimes className="mr-2 inline" />
												TB ({hashAndProgress[`tb:${r.hash}`] + '%'})
											</button>
										)}
										{tbKey && notInLibrary('tb', r.hash) && (
											<button
												className={`bg-[#04BF8A] hover:bg-[#095842] text-white text-xs rounded inline px-1`}
												onClick={() => addTb(r.hash)}
											>
												{btnIcon(r.tbAvailable)}
												Add&nbsp;to&nbsp;TB&nbsp;library
											</button>
										)}

										{(r.rdAvailable || r.adAvailable || r.tbAvailable) && (
											<button
												className="bg-sky-500 hover:bg-sky-700 text-white text-xs rounded inline px-1"
												onClick={() => handleShowInfo(r)}
											>
												👀 Look Inside
											</button>
										)}

										{rdKey && dmmCastToken && castableFileIds.length > 0 && (
											<button
												className="bg-black text-white text-xs rounded inline px-1"
												onClick={() => handleCast(r.hash, castableFileIds)}
											>
												Cast✨
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
