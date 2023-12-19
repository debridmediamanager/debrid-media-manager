import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { AdInstantAvailabilityResponse, MagnetFile, adInstantCheck } from '@/services/allDebrid';
import { RdInstantAvailabilityResponse, rdInstantCheck } from '@/services/realDebrid';
import UserTorrentDB from '@/torrent/db';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd } from '@/utils/addMagnet';
import { runConcurrentFunctions } from '@/utils/batch';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid } from '@/utils/fetchTorrents';
import { groupBy } from '@/utils/groupBy';
import { getMediaId } from '@/utils/mediaId';
import { getTypeByName } from '@/utils/mediaType';
import getReleaseTags from '@/utils/score';
import { isVideo } from '@/utils/selectable';
import { genericToastOptions } from '@/utils/toastOptions';
import { ParsedFilename, filenameParse } from '@ctrl/video-filename-parser';
import lzString from 'lz-string';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { FaDownload, FaTimes } from 'react-icons/fa';

const ONE_GIGABYTE = 1024 * 1024 * 1024;

interface TorrentHash {
	filename: string;
	hash: string;
	bytes: number;
}

interface UserTorrent extends TorrentHash {
	title: string;
	score: number;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
	noVideos: boolean;
	rdAvailable: boolean;
	adAvailable: boolean;
}

interface SortBy {
	column: 'filename' | 'title' | 'bytes' | 'score';
	direction: 'asc' | 'desc';
}

const instantCheckInRd = async (
	rdKey: string,
	hashes: string[],
	setSearchResults: Dispatch<SetStateAction<UserTorrent[]>>
): Promise<number> => {
	let instantCount = 0;
	const setInstantFromRd = (resp: RdInstantAvailabilityResponse) => {
		setSearchResults((prevSearchResults) => {
			const newSearchResults = [...prevSearchResults];
			for (const torrent of newSearchResults) {
				if (torrent.noVideos) continue;
				if (torrent.hash in resp === false) continue;
				if ('rd' in resp[torrent.hash] === false) continue;
				const variants = resp[torrent.hash]['rd'];
				if (!variants.length) continue;
				torrent.noVideos = variants.reduce((noVideo, variant) => {
					if (!noVideo) return false;
					return !Object.values(variant).some((file) => isVideo({ path: file.filename }));
				}, true);
				// because it has variants and there's at least 1 video file
				if (!torrent.noVideos) {
					torrent.rdAvailable = true;
					instantCount += 1;
				}
			}
			return newSearchResults;
		});
	};

	for (const hashGroup of groupBy(100, hashes)) {
		if (rdKey) await rdInstantCheck(rdKey, hashGroup).then(setInstantFromRd);
	}

	return instantCount;
};

const instantCheckInAd = async (
	adKey: string,
	hashes: string[],
	setSearchResults: Dispatch<SetStateAction<UserTorrent[]>>
): Promise<number> => {
	let instantCount = 0;
	const setInstantFromAd = (resp: AdInstantAvailabilityResponse) => {
		setSearchResults((prevSearchResults) => {
			const newSearchResults = [...prevSearchResults];
			for (const magnetData of resp.data.magnets) {
				const masterHash = magnetData.hash;
				const torrent = newSearchResults.find((r) => r.hash === masterHash);
				if (!torrent) continue;
				if (torrent.noVideos) continue;
				if (!magnetData.files) continue;

				const checkVideoInFiles = (files: MagnetFile[]): boolean => {
					return files.reduce((noVideo: boolean, curr: MagnetFile) => {
						if (!noVideo) return false; // If we've already found a video, no need to continue checking
						if (!curr.n) return false; // If 'n' property doesn't exist, it's not a video
						if (curr.e) {
							// If 'e' property exists, check it recursively
							return checkVideoInFiles(curr.e);
						}
						return !isVideo({ path: curr.n });
					}, true);
				};

				torrent.noVideos = checkVideoInFiles(magnetData.files);
				if (!torrent.noVideos) {
					torrent.adAvailable = magnetData.instant;
					instantCount += 1;
				}
			}
			return newSearchResults;
		});
	};

	for (const hashGroup of groupBy(100, hashes)) {
		if (adKey) await adInstantCheck(adKey, hashGroup).then(setInstantFromAd);
	}
	return instantCount;
};

const torrentDB = new UserTorrentDB();

function HashlistPage() {
	const router = useRouter();
	const [query, setQuery] = useState('');
	const [loading, setLoading] = useState(true);
	const [filtering, setFiltering] = useState(false);
	const [grouping, setGrouping] = useState(false);

	const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);
	const [filteredList, setFilteredList] = useState<UserTorrent[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'title', direction: 'asc' });

	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();

	const [movieCount, setMovieCount] = useState<number>(0);
	const [tvCount, setTvCount] = useState<number>(0);
	const [movieGrouping] = useState<Record<string, number>>({});
	const [tvGroupingByEpisode] = useState<Record<string, number>>({});
	const [tvGroupingByTitle] = useState<Record<string, number>>({});
	const [hasDupes] = useState<Array<string>>([]);
	const [totalBytes, setTotalBytes] = useState<number>(0);

	// fetch list from api
	async function getUserTorrentsList(): Promise<TorrentHash[]> {
		const hash = window.location.hash;
		if (!hash) return [];
		const jsonString = lzString.decompressFromEncodedURIComponent(hash.substring(1));
		return JSON.parse(jsonString) as TorrentHash[];
	}
	async function fetchUserTorrentsList() {
		try {
			const torrents = (await getUserTorrentsList()).map((torrent) => {
				const mediaType = getTypeByName(torrent.filename);
				const info =
					mediaType === 'movie'
						? filenameParse(torrent.filename)
						: filenameParse(torrent.filename, true);
				return {
					score: getReleaseTags(torrent.filename, torrent.bytes / ONE_GIGABYTE).score,
					info,
					mediaType,
					title: getMediaId(info, mediaType, false) || torrent.filename,
					...torrent,
				};
			}) as UserTorrent[];

			setUserTorrentsList(torrents);

			if (!torrents.length) return;
			// const hashArr = torrents.map((r) => r.hash);
			// if (rdKey) wrapLoading('RD', instantCheckInRd(rdKey, hashArr, setUserTorrentsList));
			// if (adKey) wrapLoading('AD', instantCheckInAd(adKey, hashArr, setUserTorrentsList));
		} catch (error) {
			setUserTorrentsList([]);
			toast.error('Error fetching user torrents list');
		} finally {
			setLoading(false);
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
	const notInLibrary = (hash: string) => !(hash in hashAndProgress);

	async function initialize() {
		await torrentDB.initializeDB();
		await Promise.all([fetchUserTorrentsList(), fetchHashAndProgress()]);
	}
	useEffect(() => {
		if (userTorrentsList.length !== 0) return;
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey, adKey]);

	// aggregate metadata
	useEffect(() => {
		setGrouping(true);
		setMovieCount(0);
		setTvCount(0);
		setTotalBytes(0);

		let tmpTotalBytes = 0;
		clearGroupings(movieGrouping);
		clearGroupings(tvGroupingByEpisode);
		for (const t of userTorrentsList) {
			tmpTotalBytes += t.bytes;
			if (t.title in getGroupings(t.mediaType)) {
				if (getGroupings(t.mediaType)[t.title] === 1) hasDupes.push(t.title);
				getGroupings(t.mediaType)[t.title]++;
			} else {
				getGroupings(t.mediaType)[t.title] = 1;
			}
			if (t.mediaType === 'tv') {
				if (t.title in tvGroupingByTitle) {
					tvGroupingByTitle[t.title]++;
				} else {
					tvGroupingByTitle[t.title] = 1;
				}
			}
		}

		setMovieCount(Object.keys(movieGrouping).length);
		setTvCount(Object.keys(tvGroupingByTitle).length);
		setTotalBytes(tmpTotalBytes);
		setGrouping(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [userTorrentsList]);

	// set the list you see
	async function filterOutAlreadyDownloaded(unfiltered: UserTorrent[]) {
		if (unfiltered.length <= 1) return unfiltered;
		const hashes = await torrentDB.hashes();
		return unfiltered.filter((t) => !hashes.has(t.hash));
	}
	function applyQuickSearch(unfiltered: UserTorrent[]) {
		let regexFilters: RegExp[] = [];
		for (const q of query.split(' ')) {
			try {
				regexFilters.push(new RegExp(q, 'i'));
			} catch (error) {
				continue;
			}
		}
		return query
			? unfiltered.filter((t) => regexFilters.every((regex) => regex.test(t.filename)))
			: unfiltered;
	}
	async function filterList() {
		setFiltering(true);
		const notYetDownloaded = await filterOutAlreadyDownloaded(userTorrentsList);
		if (Object.keys(router.query).length === 0) {
			setFilteredList(applyQuickSearch(notYetDownloaded));
			setFiltering(false);
			return;
		}
		const { filter: titleFilter, mediaType } = router.query;
		let tmpList = notYetDownloaded;
		if (titleFilter) {
			const decodedTitleFilter = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => decodedTitleFilter === t.title);
			setFilteredList(applyQuickSearch(tmpList));
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => mediaType === t.mediaType);
			setFilteredList(applyQuickSearch(tmpList));
		}
		setFiltering(false);
	}
	useEffect(() => {
		filterList();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, userTorrentsList, movieGrouping, tvGroupingByEpisode, router.query]);

	function handleSort(column: typeof sortBy.column) {
		setSortBy({
			column,
			direction: sortBy.column === column && sortBy.direction === 'asc' ? 'desc' : 'asc',
		});
	}

	function sortedData() {
		if (!sortBy.column) {
			return filteredList;
		}
		filteredList.sort((a, b) => {
			const isAsc = sortBy.direction === 'asc';
			let comparison = 0;
			if (a[sortBy.column] > b[sortBy.column]) {
				comparison = 1;
			} else if (a[sortBy.column] < b[sortBy.column]) {
				comparison = -1;
			}
			return isAsc ? comparison : comparison * -1;
		});
		return filteredList;
	}

	const getGroupings = (mediaType: UserTorrent['mediaType']) =>
		mediaType === 'tv' ? tvGroupingByEpisode : movieGrouping;

	function clearGroupings(frequencyMap: { [x: string]: number }) {
		for (let key in frequencyMap) {
			delete frequencyMap[key];
		}
	}

	function wrapDownloadFilesInRdFn(t: UserTorrent) {
		return async () => await addRd(t.hash);
	}
	async function downloadNonDupeTorrentsInRd() {
		const libraryHashes = await torrentDB.hashes();
		const yetToDownload = filteredList
			.filter((t) => !libraryHashes.has(t.hash))
			.map(wrapDownloadFilesInRdFn);
		const [results, errors] = await runConcurrentFunctions(yetToDownload, 5, 500);
		await fetchRealDebrid(
			rdKey!,
			async (torrents) => {
				await torrentDB.addAll(torrents);
				await fetchHashAndProgress();
			},
			results.length + 1
		);
		await fetchHashAndProgress();
		if (errors.length) {
			toast.error(
				`Error downloading files on ${errors.length} torrents`,
				genericToastOptions
			);
		}
		if (results.length) {
			toast.success(`Started downloading ${results.length} torrents`, genericToastOptions);
		}
		if (!errors.length && !results.length) {
			toast('Everything has been downloaded', { icon: '👏' });
		}
	}

	function wrapDownloadFilesInAdFn(t: UserTorrent) {
		return async () => await addAd(t.hash);
	}
	async function downloadNonDupeTorrentsInAd() {
		const libraryHashes = await torrentDB.hashes();
		const yetToDownload = filteredList
			.filter((t) => !libraryHashes.has(t.hash))
			.map(wrapDownloadFilesInAdFn);
		const [results, errors] = await runConcurrentFunctions(yetToDownload, 5, 500);
		if (errors.length) {
			toast.error(`Error downloading files on ${errors.length} torrents`);
		}
		if (results.length) {
			toast.success(`Started downloading ${results.length} torrents`);
		}
		if (!errors.length && !results.length) {
			toast('Everything has been downloaded', { icon: '👏' });
		}
	}

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
		await fetchAllDebrid(adKey!, async (torrents) => {
			await torrentDB.addAll(torrents);
			await fetchHashAndProgress(hash);
		});
	}

	async function deleteRd(hash: string) {
		const torrent = await torrentDB.getLatestByHash(hash);
		if (!torrent) return;
		await handleDeleteRdTorrent(rdKey!, torrent.id);
		await torrentDB.deleteByHash(hash);
		await fetchHashAndProgress();
	}

	async function deleteAd(hash: string) {
		const torrent = await torrentDB.getLatestByHash(hash);
		if (!torrent) return;
		await handleDeleteAdTorrent(adKey!, torrent.id);
		await torrentDB.deleteByHash(hash);
		await fetchHashAndProgress();
	}

	return (
		<div className="mx-4 my-8">
			<Head>
				<title>
					Debrid Media Manager - Hash list:{' '}
					{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB
				</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">
					Share this page ({userTorrentsList.length} files in total; size:{' '}
					{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB)
				</h1>
				<Link
					href="/"
					className="text-2xl bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			<div className="flex items-center border-b border-b-2 border-gray-500 py-2 mb-4">
				<input
					className="appearance-none bg-transparent border-none w-full text-white mr-3 py-1 px-2 leading-tight focus:outline-none"
					type="text"
					id="query"
					placeholder="quick search on filename, hash, or id; supports regex"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value.toLocaleLowerCase());
					}}
				/>
			</div>
			<div className="mb-4">
				<Link
					href="/hashlist?mediaType=movie"
					className="mr-2 mb-2 bg-sky-800 hover:bg-sky-700 text-white font-bold py-1 px-2 rounded"
				>
					Show {movieCount} movies
				</Link>
				<Link
					href="/hashlist?mediaType=tv"
					className="mr-2 mb-2 bg-sky-800 hover:bg-sky-700 text-white font-bold py-1 px-2 rounded"
				>
					Show {tvCount} TV shows
				</Link>
				{rdKey && (
					<button
						className={`mr-2 mb-2 bg-blue-700 hover:bg-blue-600 text-white font-bold py-1 px-2 rounded ${
							filteredList.length === 0 || !rdKey
								? 'opacity-60 cursor-not-allowed'
								: ''
						}`}
						onClick={downloadNonDupeTorrentsInRd}
						disabled={filteredList.length === 0 || !rdKey}
					>
						Download all in Real-Debrid
					</button>
				)}
				{adKey && (
					<button
						className={`mr-2 mb-2 bg-blue-700 hover:bg-blue-600 text-white font-bold py-1 px-2 rounded ${
							filteredList.length === 0 || !adKey
								? 'opacity-60 cursor-not-allowed'
								: ''
						}`}
						onClick={downloadNonDupeTorrentsInAd}
						disabled={filteredList.length === 0 || !adKey}
					>
						Download all in AllDebrid
					</button>
				)}

				{Object.keys(router.query).length !== 0 && (
					<Link
						href="/hashlist"
						className="mr-2 mb-2 bg-yellow-400 hover:bg-yellow-500 text-black py-1 px-2 rounded"
					>
						Reset
					</Link>
				)}

				{(rdKey || adKey) && (
					<span className="px-2.5 py-1 text-s bg-green-100 text-green-800 mr-2">
						<strong>
							{userTorrentsList.length - filteredList.length} torrents hidden
						</strong>{' '}
						because its filtered/already in your library
					</span>
				)}
			</div>
			<div className="overflow-x-auto">
				{loading || grouping || filtering ? (
					<div className="flex justify-center items-center mt-4">
						<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
					</div>
				) : (
					<table className="w-full">
						<thead>
							<tr>
								<th
									className="px-4 py-2 cursor-pointer"
									onClick={() => handleSort('title')}
								>
									Title{' '}
									{sortBy.column === 'title' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th
									className="px-4 py-2 cursor-pointer"
									onClick={() => handleSort('bytes')}
								>
									Size{' '}
									{sortBy.column === 'bytes' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th className="px-4 py-2">Actions</th>
							</tr>
						</thead>
						<tbody>
							{sortedData().map((t, i) => {
								const groupCount = getGroupings(t.mediaType)[t.filename];
								const filterText =
									groupCount > 1 && !router.query.filter
										? `${groupCount - 1} other file${
												groupCount === 1 ? '' : 's'
										  }`
										: '';
								return (
									<tr
										key={i}
										className={`
									hover:bg-purple-900
									border-t-2
									${isDownloaded(t.hash) ? 'bg-green-900' : isDownloading(t.hash) ? 'bg-red-900' : ''}
								`}
									>
										<td className="border px-4 py-2">
											{!['Invalid Magnet', 'Magnet'].includes(t.filename) && (
												<>
													<span className="cursor-pointer">
														{t.mediaType === 'tv' ? '📺' : '🎥'}
													</span>
													&nbsp;<strong>{t.title}</strong>{' '}
													{filterText && (
														<Link
															href={`/library?filter=${encodeURIComponent(
																t.title
															)}`}
															className="inline-block bg-green-600 hover:bg-green-800 text-white font-bold py-0 px-1 rounded text-xs cursor-pointer"
															onClick={(e) => e.stopPropagation()}
														>
															{filterText}
														</Link>
													)}
													<Link
														href={`/search?query=${encodeURIComponent(
															(
																t.info.title +
																' ' +
																(t.info.year || '')
															).trim() || t.title
														)}`}
														target="_blank"
														className="inline-block bg-blue-600 hover:bg-blue-800 text-white font-bold py-0 px-1 rounded text-xs cursor-pointer ml-1"
														onClick={(e) => e.stopPropagation()}
													>
														Search again
													</Link>
													<br />
												</>
											)}
											{t.filename}
										</td>

										<td className="border px-4 py-2">
											{(t.bytes / ONE_GIGABYTE).toFixed(1)} GB
										</td>
										<td className="border px-4 py-2">
											{rdKey && isDownloading(t.hash) && (
												<button
													className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded"
													onClick={() => deleteRd(t.hash)}
												>
													<FaTimes />
													RD ({hashAndProgress[t.hash] + '%'})
												</button>
											)}
											{rdKey && notInLibrary(t.hash) && (
												<button
													className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded"
													onClick={() => addRd(t.hash)}
												>
													<FaDownload />
													RD
												</button>
											)}

											{adKey && isDownloading(t.hash) && (
												<button
													className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded"
													onClick={() => deleteAd(t.hash)}
												>
													<FaTimes />
													AD ({hashAndProgress[t.hash] + '%'})
												</button>
											)}
											{adKey && notInLibrary(t.hash) && (
												<button
													className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded"
													onClick={() => addAd(t.hash)}
												>
													<FaDownload />
													AD
												</button>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}

const HashlistPageNoSSR = dynamic(() => Promise.resolve(HashlistPage), { ssr: false });

export default HashlistPageNoSSR;
