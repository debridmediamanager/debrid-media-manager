import TvSearchResults from '@/components/TvSearchResults';
import Poster from '@/components/poster';
import { showInfoForRD } from '@/components/showInfo';
import { showSubscribeModal } from '@/components/subscribe';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { SearchApiResponse, SearchResult } from '@/services/mediasearch';
import { TorrentInfoResponse } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd, handleCopyMagnet } from '@/utils/addMagnet';
import { submitAvailability } from '@/utils/availability';
import { handleCastTvShow } from '@/utils/castApiClient';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import {
	getColorScale,
	getExpectedEpisodeCount,
	getQueryForEpisodeCount,
} from '@/utils/episodeUtils';
import { convertToUserTorrent, fetchAllDebrid } from '@/utils/fetchTorrents';
import { instantCheckInAd, instantCheckInRd, wrapLoading } from '@/utils/instantChecks';
import { applyQuickSearch2 } from '@/utils/quickSearch';
import { sortByMedian } from '@/utils/results';
import { isVideo } from '@/utils/selectable';
import { defaultEpisodeSize, defaultPlayer } from '@/utils/settings';
import { castToastOptions, searchToastOptions } from '@/utils/toastOptions';
import { generateTokenAndHash } from '@/utils/token';
import { withAuth } from '@/utils/withAuth';
import axios, { AxiosError } from 'axios';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FunctionComponent, useEffect, useMemo, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';

type ShowInfo = {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	season_count: number;
	season_names: string[];
	imdb_score: number;
	season_episode_counts: Record<number, number>;
};

const torrentDB = new UserTorrentDB();

const TvSearch: FunctionComponent = () => {
	const player = window.localStorage.getItem('settings:player') || defaultPlayer;
	const episodeMaxSize =
		window.localStorage.getItem('settings:episodeMaxSize') || defaultEpisodeSize;
	const onlyTrustedTorrents =
		window.localStorage.getItem('settings:onlyTrustedTorrents') === 'true';
	const defaultTorrentsFilter =
		window.localStorage.getItem('settings:defaultTorrentsFilter') ?? '';

	const [showInfo, setShowInfo] = useState<ShowInfo | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [searchState, setSearchState] = useState<string>('loading');
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [filteredResults, setFilteredResults] = useState<SearchResult[]>([]);
	const [errorMessage, setErrorMessage] = useState('');
	const [query, setQuery] = useState(defaultTorrentsFilter);
	const [descLimit, setDescLimit] = useState(100);
	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const [onlyShowCached, setOnlyShowCached] = useState<boolean>(false);
	const [currentPage, setCurrentPage] = useState(0);
	const [totalUncachedCount, setTotalUncachedCount] = useState<number>(0);
	const [hasMoreResults, setHasMoreResults] = useState(true);
	const [hashAndProgress, setHashAndProgress] = useState<Record<string, number>>({});

	const router = useRouter();
	const { imdbid, seasonNum } = router.query;

	const expectedEpisodeCount = useMemo(
		() =>
			getExpectedEpisodeCount(
				seasonNum as string | undefined,
				showInfo?.season_episode_counts || {}
			),
		[seasonNum, showInfo]
	);

	useEffect(() => {
		if (!imdbid || !seasonNum) return;

		const fetchShowInfo = async () => {
			try {
				const response = await axios.get(`/api/info/show?imdbid=${imdbid}`);
				setShowInfo(response.data);

				if (parseInt(seasonNum as string) > response.data.season_count) {
					router.push(`/show/${imdbid}/1`);
				}
			} catch (error) {
				console.error('Error fetching show info:', error);
				setErrorMessage('Failed to fetch show information');
			} finally {
				setIsLoading(false);
			}
		};

		fetchShowInfo();
	}, [imdbid, seasonNum, router]);

	async function initialize() {
		await torrentDB.initializeDB();
		await Promise.all([
			fetchData(imdbid as string, parseInt(seasonNum as string), 0),
			fetchHashAndProgress(),
		]);
	}

	useEffect(() => {
		if (!imdbid || !seasonNum || isLoading) return;
		initialize();
	}, [imdbid, seasonNum, isLoading]);

	async function fetchData(imdbId: string, seasonNum: number, page: number = 0) {
		const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
		if (page === 0) {
			setSearchResults([]);
			setTotalUncachedCount(0);
		}
		setErrorMessage('');
		setSearchState('loading');
		try {
			const response = await axios.get<SearchApiResponse>(
				`/api/torrents/tv?imdbId=${imdbId}&seasonNum=${seasonNum}&dmmProblemKey=${tokenWithTimestamp}&solution=${tokenHash}&onlyTrusted=${onlyTrustedTorrents}&maxSize=${episodeMaxSize}&page=${page}`
			);

			if (response.status !== 200) {
				setSearchState(response.headers.status ?? 'loaded');
				return;
			}

			if (response.data.results?.length) {
				const results = response.data.results;
				setSearchResults((prevResults) => {
					const newResults = [
						...prevResults,
						...results.map((r) => ({
							...r,
							rdAvailable: false,
							adAvailable: false,
							noVideos: false,
							files: [],
						})),
					];
					return newResults.sort((a, b) => {
						const aAvailable = a.rdAvailable || a.adAvailable;
						const bAvailable = b.rdAvailable || b.adAvailable;
						if (aAvailable !== bAvailable) {
							return aAvailable ? -1 : 1;
						}
						return b.fileSize - a.fileSize;
					});
				});
				setHasMoreResults(results.length > 0);
				toast(`Found ${results.length} results`, searchToastOptions);

				const hashArr = results.map((r) => r.hash);
				const instantChecks = [];
				if (rdKey) {
					const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
					instantChecks.push(
						wrapLoading(
							'RD',
							instantCheckInRd(
								tokenWithTimestamp,
								tokenHash,
								imdbId,
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
				const newUncachedCount = hashArr.length - counts.reduce((acc, cur) => acc + cur, 0);
				setTotalUncachedCount((prev) => prev + newUncachedCount);
			} else {
				if (page === 0) {
					setSearchResults([]);
				}
				setHasMoreResults(false);
				toast(`No${page === 0 ? '' : ' more'} results found`, searchToastOptions);
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
				setHasMoreResults(false);
			}
		} finally {
			setSearchState('loaded');
		}
	}

	useEffect(() => {
		if (searchResults.length === 0) return;
		const filteredResults = applyQuickSearch2(query, searchResults);
		setFilteredResults(filteredResults);
	}, [query, searchResults]);

	async function fetchHashAndProgress(hash?: string) {
		const torrents = await torrentDB.all();
		const records: Record<string, number> = {};
		for (const t of torrents) {
			if (hash && t.hash !== hash) continue;
			records[`${t.id.substring(0, 3)}${t.hash}`] = t.progress;
		}
		setHashAndProgress((prev) => ({ ...prev, ...records }));
	}

	async function addRd(hash: string) {
		await handleAddAsMagnetInRd(rdKey!, hash, async (info: TorrentInfoResponse) => {
			const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
			await Promise.all([
				submitAvailability(tokenWithTimestamp, tokenHash, info, imdbid as string),
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
			host: '',
			split: 0,
			status: 'downloaded',
			added: '',
			ended: '',
			speed: 0,
			seeders: 0,
		} as TorrentInfoResponse;
		rdKey && showInfoForRD(player, rdKey!, info, imdbid as string, 'tv');
	};

	async function handleCast(hash: string, fileIds: string[]) {
		await toast.promise(
			handleCastTvShow(imdbid as string, rdKey!, hash, fileIds),
			{
				loading: `Casting ${fileIds.length} episodes`,
				success: 'Casting successful',
				error: 'Casting failed',
			},
			castToastOptions
		);
	}

	const getFirstAvailableRdTorrent = () => {
		return searchResults.find((r) => r.rdAvailable && !r.noVideos);
	};

	const backdropStyle = showInfo?.backdrop
		? {
				backgroundImage: `linear-gradient(to bottom, hsl(0, 0%, 12%,0.5) 0%, hsl(0, 0%, 12%,0) 50%, hsl(0, 0%, 12%,0.5) 100%), url(${showInfo.backdrop})`,
				backgroundPosition: 'center',
				backgroundSize: 'screen',
			}
		: {};

	if (isLoading) {
		return <div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">Loading...</div>;
	}

	if (!showInfo) {
		return (
			<div className="mx-2 my-1 min-h-screen bg-gray-900 text-white">
				No show information available
			</div>
		);
	}

	return (
		<div className="min-h-screen max-w-full bg-gray-900 text-gray-100">
			<Head>
				<title>
					Debrid Media Manager - TV Show - {showInfo.title} - Season {seasonNum}
				</title>
			</Head>
			<Toaster position="bottom-right" />

			<div
				className="grid auto-cols-auto grid-flow-col auto-rows-auto gap-2"
				style={backdropStyle}
			>
				{(showInfo.poster && (
					<Image
						width={200}
						height={300}
						src={showInfo.poster}
						alt="Show poster"
						className="row-span-5 shadow-lg"
					/>
				)) || <Poster imdbId={imdbid as string} title={showInfo.title} />}

				<div className="flex justify-end p-2">
					<Link
						href="/"
						className="h-fit w-fit rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
					>
						Go Home
					</Link>
				</div>

				<h2 className="text-xl font-bold [text-shadow:_0_2px_0_rgb(0_0_0_/_80%)]">
					{showInfo.title} - Season {seasonNum}
				</h2>

				<div className="h-fit w-fit bg-slate-900/75" onClick={() => setDescLimit(0)}>
					{descLimit > 0
						? showInfo.description.substring(0, descLimit) + '..'
						: showInfo.description}{' '}
					{showInfo.imdb_score > 0 && (
						<div className="inline text-yellow-100">
							<Link href={`https://www.imdb.com/title/${imdbid}/`} target="_blank">
								IMDB Score:{' '}
								{showInfo.imdb_score < 10
									? showInfo.imdb_score
									: showInfo.imdb_score / 10}
							</Link>
						</div>
					)}
				</div>

				<div className="flex items-center overflow-x-auto">
					{Array.from(
						{ length: showInfo.season_count },
						(_, i) => showInfo.season_count - i
					).map((season, idx) => {
						const color = parseInt(seasonNum as string) === season ? 'red' : 'yellow';
						return (
							<Link
								key={idx}
								href={`/show/${imdbid}/${season}`}
								className={`inline-flex items-center border-2 p-1 text-xs border-${color}-500 bg-${color}-900/30 text-${color}-100 hover:bg-${color}-800/50 mb-1 mr-2 rounded transition-colors`}
							>
								<span role="img" aria-label="tv show" className="mr-2">
									📺
								</span>{' '}
								<span className="whitespace-nowrap">
									{showInfo.season_names && showInfo.season_names[season - 1]
										? showInfo.season_names[season - 1]
										: `Season ${season}`}
								</span>
							</Link>
						);
					})}
				</div>

				<div>
					<button
						className="haptic-sm mb-1 mr-2 mt-0 rounded border-2 border-rose-500 bg-rose-900/30 p-1 text-xs text-rose-100 transition-colors hover:bg-rose-800/50"
						onClick={() => {
							showSubscribeModal();
						}}
					>
						🔔Subscribe
					</button>
					{rdKey && getFirstAvailableRdTorrent() && (
						<button
							className="haptic-sm mb-1 mr-2 mt-0 rounded border-2 border-green-500 bg-green-900/30 p-1 text-xs text-green-100 transition-colors hover:bg-green-800/50"
							onClick={() => addRd(getFirstAvailableRdTorrent()!.hash)}
						>
							<b>⚡Instant RD</b>
						</button>
					)}
					{onlyShowCached && totalUncachedCount > 0 && (
						<button
							className="haptic-sm mb-1 mr-2 mt-0 rounded border-2 border-blue-500 bg-blue-900/30 p-1 text-xs text-blue-100 transition-colors hover:bg-blue-800/50"
							onClick={() => {
								setOnlyShowCached(false);
							}}
						>
							Show {totalUncachedCount} uncached
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
				{getColorScale(expectedEpisodeCount).map((scale, idx) => (
					<span
						key={idx}
						className={`bg-${scale.color} cursor-pointer whitespace-nowrap rounded px-2 py-1 text-xs text-white`}
						onClick={() => {
							const queryText = getQueryForEpisodeCount(
								scale.threshold,
								expectedEpisodeCount
							);
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

			<TvSearchResults
				filteredResults={filteredResults}
				expectedEpisodeCount={expectedEpisodeCount}
				onlyShowCached={onlyShowCached}
				episodeMaxSize={episodeMaxSize}
				rdKey={rdKey}
				adKey={adKey}
				player={player}
				hashAndProgress={hashAndProgress}
				handleShowInfo={handleShowInfo}
				handleCast={handleCast}
				handleCopyMagnet={handleCopyMagnet}
				addRd={addRd}
				addAd={addAd}
				deleteRd={deleteRd}
				deleteAd={deleteAd}
			/>

			{searchResults.length > 0 && searchState === 'loaded' && hasMoreResults && (
				<button
					className="haptic my-4 w-full rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 font-medium text-gray-100 shadow-md transition-colors duration-200 hover:bg-gray-700/50 hover:shadow-lg"
					onClick={() => {
						setCurrentPage((prev) => prev + 1);
						fetchData(imdbid as string, parseInt(seasonNum as string), currentPage + 1);
					}}
				>
					Show More Results
				</button>
			)}
		</div>
	);
};

export default withAuth(TvSearch);
