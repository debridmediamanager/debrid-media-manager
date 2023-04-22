import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import useLocalStorage from '@/hooks/localStorage';
import { deleteMagnet, getMagnetStatus, restartMagnet } from '@/services/allDebrid';
import { createShortUrl } from '@/services/hashlists';
import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	getUserTorrentsList,
	selectFiles,
} from '@/services/realDebrid';
import { runConcurrentFunctions } from '@/utils/batch';
import { CachedTorrentInfo } from '@/utils/cachedTorrentInfo';
import { getMediaId } from '@/utils/mediaId';
import { getMediaType } from '@/utils/mediaType';
import getReleaseTags from '@/utils/score';
import { getSelectableFiles, isVideo } from '@/utils/selectable';
import { withAuth } from '@/utils/withAuth';
import { filenameParse, ParsedFilename } from '@ctrl/video-filename-parser';
import lzString from 'lz-string';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';
import { FaArrowLeft, FaArrowRight, FaRecycle, FaShare, FaTrash } from 'react-icons/fa';

const ONE_GIGABYTE = 1024 * 1024 * 1024;
const ITEMS_PER_PAGE = 100;

interface UserTorrent {
	id: string;
	filename: string;
	title: string;
	hash: string;
	bytes: number;
	progress: number;
	status: string;
	added: string;
	score: number;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
}

interface SortBy {
	column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added' | 'score';
	direction: 'asc' | 'desc';
}

function TorrentsPage() {
	const router = useRouter();
	const [query, setQuery] = useState('');
	const [currentPage, setCurrentPage] = useState(1);

	// loading states
	const [rdLoading, setRdLoading] = useState(true);
	const [adLoading, setAdLoading] = useState(true);
	const [filtering, setFiltering] = useState(false);
	const [grouping, setGrouping] = useState(false);

	const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);
	const [filteredList, setFilteredList] = useState<UserTorrent[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'added', direction: 'desc' });

	// keys
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();

	const [movieCount, setMovieCount] = useState<number>(0);
	const [tvCount, setTvCount] = useState<number>(0);
	const [movieGrouping] = useState<Record<string, number>>({});
	const [tvGroupingByEpisode] = useState<Record<string, number>>({});
	const [tvGroupingByTitle] = useState<Record<string, number>>({});
	const [hasDupes] = useState<Array<string>>([]);

	// stats
	const [totalBytes, setTotalBytes] = useState<number>(0);

	const [_, setTorrentCache] = useLocalStorage<Record<string, CachedTorrentInfo>>(
		'userTorrentsList',
		{}
	);

	const handlePrevPage = useCallback(() => {
		if (router.query.page === '1') return;
		router.push({
			query: { ...router.query, page: currentPage - 1 },
		});
	}, [currentPage, router]);

	const handleNextPage = useCallback(() => {
		router.push({
			query: { ...router.query, page: currentPage + 1 },
		});
	}, [currentPage, router]);

	// pagination query params
	useEffect(() => {
		const { page } = router.query;
		if (!page || Array.isArray(page)) return;
		setCurrentPage(parseInt(page, 10));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router]);

	// fetch list from api
	useEffect(() => {
		const fetchRealDebrid = async () => {
			try {
				if (!rdKey) throw new Error('no_rd_key');
				const torrents = (await getUserTorrentsList(rdKey, 0, 1, 2500, '')).map(
					(torrent) => {
						const mediaType = getMediaType(torrent.filename);
						const info =
							mediaType === 'movie'
								? filenameParse(torrent.filename)
								: filenameParse(torrent.filename, true);
						return {
							score: getReleaseTags(torrent.filename, torrent.bytes / ONE_GIGABYTE)
								.score,
							info,
							mediaType,
							title: getMediaId(info, mediaType, false),
							...torrent,
							id: `rd:${torrent.id}`,
						};
					}
				) as UserTorrent[];

				setUserTorrentsList((prev) => [...prev, ...torrents]);
				setTorrentCache((prev) => ({
					...prev,
					...torrents.reduce<Record<string, CachedTorrentInfo>>((cache, t) => {
						cache[t.hash] = t;
						return cache;
					}, {}),
				}));
			} catch (error) {
				setUserTorrentsList((prev) => [...prev]);
				toast.error('Error fetching user torrents list');
			} finally {
				setRdLoading(false);
			}
		};
		if (rdKey) fetchRealDebrid();
		else setRdLoading(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey]);

	useEffect(() => {
		const fetchAllDebrid = async () => {
			try {
				if (!adKey) throw new Error('no_ad_key');
				const torrents = (await getMagnetStatus(adKey)).data.magnets.map((torrent) => {
					const mediaType = getMediaType(torrent.filename);
					const info =
						mediaType === 'movie'
							? filenameParse(torrent.filename)
							: filenameParse(torrent.filename, true);

					const date = new Date(torrent.uploadDate * 1000);
					// Format date string
					const formattedDate = date.toISOString();

					let status = 'error';
					if (torrent.statusCode >= 0 && torrent.statusCode <= 3) {
						status = 'downloading';
					} else if (torrent.statusCode === 4) {
						status = 'downloaded';
					}

					return {
						score: getReleaseTags(torrent.filename, torrent.size / ONE_GIGABYTE).score,
						info,
						mediaType,
						title: getMediaId(info, mediaType, false),
						id: `ad:${torrent.id}`,
						filename: torrent.filename,
						hash: torrent.hash,
						bytes: torrent.size,
						progress: torrent.processingPerc,
						status,
						added: formattedDate,
					};
				}) as UserTorrent[];

				setUserTorrentsList((prev) => [...prev, ...torrents]);
				setTorrentCache((prev) => ({
					...prev,
					...torrents.reduce<Record<string, CachedTorrentInfo>>((cache, t) => {
						cache[t.hash] = t;
						return cache;
					}, {}),
				}));
			} catch (error) {
				setUserTorrentsList((prev) => [...prev]);
				toast.error('Error fetching AllDebrid torrents list');
			} finally {
				setAdLoading(false);
			}
		};
		if (adKey) fetchAllDebrid();
		else setAdLoading(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [adKey]);

	// aggregate metadata
	useEffect(() => {
		if (rdLoading || adLoading) return;
		setGrouping(true);
		setMovieCount(0);
		setTvCount(0);
		setTotalBytes(0);

		let tmpTotalBytes = 0;
		clearGroupings(movieGrouping);
		clearGroupings(tvGroupingByEpisode);
		for (const t of userTorrentsList) {
			tmpTotalBytes += t.bytes;
			const mediaId = getMediaId(t.info, t.mediaType);
			if (mediaId in getGroupings(t.mediaType)) {
				if (getGroupings(t.mediaType)[mediaId] === 1) hasDupes.push(mediaId);
				getGroupings(t.mediaType)[mediaId]++;
			} else {
				getGroupings(t.mediaType)[mediaId] = 1;
			}
			if (t.mediaType === 'tv') {
				const title = getMediaId(t.info, t.mediaType, true, true);
				if (title in tvGroupingByTitle) {
					tvGroupingByTitle[title]++;
				} else {
					tvGroupingByTitle[title] = 1;
				}
			}
		}

		setMovieCount(Object.keys(movieGrouping).length);
		setTvCount(Object.keys(tvGroupingByTitle).length);
		setTotalBytes(tmpTotalBytes);
		setGrouping(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		userTorrentsList,
		rdLoading,
		adLoading,
		movieGrouping,
		tvGroupingByEpisode,
		tvGroupingByTitle,
		hasDupes,
	]);

	// set the list you see
	useEffect(() => {
		if (rdLoading || adLoading || grouping) return;
		setFiltering(true);
		if (Object.keys(router.query).filter((e) => e !== 'page').length === 0) {
			setFilteredList(userTorrentsList);
			selectPlayableFiles(userTorrentsList);
			deleteFailedTorrents(userTorrentsList);
			setFiltering(false);
			return;
		}
		const { filter: titleFilter, mediaType, status } = router.query;
		let tmpList = userTorrentsList;
		if (status === 'slow') {
			tmpList = tmpList.filter(isTorrentSlow);
			setFilteredList(tmpList);
		}
		if (status === 'dupe') {
			tmpList = tmpList.filter((t) => hasDupes.includes(getMediaId(t.info, t.mediaType)));
			setFilteredList(tmpList);
		}
		if (status === 'non4k') {
			tmpList = tmpList.filter((t) => !/\b2160p|\b4k|\buhd/i.test(t.filename));
			setFilteredList(tmpList);
		}
		if (titleFilter) {
			const decodedTitleFilter = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => decodedTitleFilter === getMediaId(t.info, t.mediaType));
			setFilteredList(tmpList);
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => mediaType === t.mediaType);
			setFilteredList(tmpList);
		}
		selectPlayableFiles(tmpList);
		deleteFailedTorrents(tmpList);
		setFiltering(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		router.query,
		userTorrentsList,
		rdLoading,
		adLoading,
		grouping,
		hasDupes,
		query,
		currentPage,
	]);

	const handleDeleteTorrent = async (id: string, disableToast: boolean = false) => {
		try {
			if (!rdKey && !adKey) throw new Error('no_keys');
			setUserTorrentsList((prevList) => prevList.filter((t) => t.id !== id));
			if (rdKey && id.startsWith('rd:')) await deleteTorrent(rdKey, id.substring(3));
			if (adKey && id.startsWith('ad:')) await deleteMagnet(adKey, id.substring(3));
			if (!disableToast) toast.success(`Torrent deleted (${id})`);
			setTorrentCache((prevCache) => {
				const hash = Object.keys(prevCache).find((key) => prevCache[key].id === id) || '';
				delete prevCache[hash];
				return prevCache;
			});
		} catch (error) {
			if (!disableToast) toast.error(`Error deleting torrent (${id})`);
			throw error;
		}
	};

	function handleSort(column: typeof sortBy.column) {
		setSortBy({
			column,
			direction: sortBy.column === column && sortBy.direction === 'asc' ? 'desc' : 'asc',
		});
	}

	// given a list, filter by query and paginate
	function applyQuickSearch(unfiltered: UserTorrent[]) {
		let regexFilter = new RegExp('', 'i');
		try {
			regexFilter = new RegExp(query.split(' ').join('|'), 'i');
		} catch (error) {
			// do nothing
		}
		return query
			? unfiltered.filter(
					(t) =>
						regexFilter.test(t.filename) ||
						query === t.hash ||
						query === t.id.substring(3)
			  )
			: unfiltered;
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
		return applyQuickSearch(filteredList);
	}

	const getGroupings = (mediaType: UserTorrent['mediaType']) =>
		mediaType === 'tv' ? tvGroupingByEpisode : movieGrouping;

	function clearGroupings(frequencyMap: { [x: string]: number }) {
		for (let key in frequencyMap) {
			delete frequencyMap[key];
		}
	}

	const handleSelectFiles = async (id: string) => {
		try {
			if (!rdKey) throw new Error('no_rd_key');
			const response = await getTorrentInfo(rdKey, id.substring(3));

			const selectedFiles = getSelectableFiles(response.files.filter(isVideo)).map(
				(file) => file.id
			);
			if (selectedFiles.length === 0) {
				handleDeleteTorrent(id);
				throw new Error('no_files_for_selection');
			}

			await selectFiles(rdKey, id.substring(3), selectedFiles);
			setUserTorrentsList((prevList) => {
				const newList = [...prevList];
				const index = newList.findIndex((t) => t.id === id);
				newList[index].status = 'downloading';
				return newList;
			});
			setTorrentCache((prevCache) => {
				const hash = Object.keys(prevCache).find((key) => prevCache[key].id === id) || '';
				prevCache[hash].status = 'downloading';
				return prevCache;
			});
		} catch (error) {
			if ((error as Error).message === 'no_files_for_selection') {
				toast.error(`No files for selection, deleting (${id})`, {
					duration: 5000,
				});
			} else {
				toast.error(`Error selecting files (${id})`);
			}
			throw error;
		}
	};

	function wrapSelectFilesFn(t: UserTorrent) {
		return async () => await handleSelectFiles(t.id);
	}

	async function selectPlayableFiles(torrents: UserTorrent[]) {
		const waitingForSelection = torrents
			.filter(
				(t) =>
					t.status === 'waiting_files_selection' ||
					(t.status === 'magnet_conversion' && t.filename !== 'Magnet')
			)
			.map(wrapSelectFilesFn);
		const [results, errors] = await runConcurrentFunctions(waitingForSelection, 5, 500);
		if (errors.length) {
			toast.error(`Error selecting files on ${errors.length} torrents`);
		}
		if (results.length) {
			toast.success(`Started downloading ${results.length} torrents`);
		}
	}

	async function deleteFailedTorrents(torrents: UserTorrent[]) {
		const failedTorrents = torrents
			.filter(
				(t) =>
					t.status.includes('error') ||
					t.status.includes('dead') ||
					t.status.includes('virus')
			)
			.map(wrapDeleteFn);
		const [results, errors] = await runConcurrentFunctions(failedTorrents, 5, 500);
		if (errors.length) {
			toast.error(`Error deleting ${errors.length} failed torrents`);
		}
		if (results.length) {
			toast.success(`Deleted ${results.length} failed torrents`);
		}
	}

	function wrapDeleteFn(t: UserTorrent) {
		return async () => await handleDeleteTorrent(t.id);
	}

	async function deleteFilteredTorrents() {
		if (!confirm('This will delete all torrents listed. Are you sure?')) return;
		const torrentsToDelete = filteredList.map(wrapDeleteFn);
		const [results, errors] = await runConcurrentFunctions(torrentsToDelete, 5, 500);
		if (errors.length) {
			toast.error(`Error deleting ${errors.length} torrents`);
		}
		if (results.length) {
			toast.success(`Deleted ${results.length} torrents`);
		}
		if (!errors.length && !results.length) {
			toast('No torrents to delete', { icon: '👏' });
		}
	}

	function isTorrentSlow(t: UserTorrent) {
		const oldTorrentAge = 86400000; // One day in milliseconds
		const addedDate = new Date(t.added);
		const now = new Date();
		const ageInMillis = now.getTime() - addedDate.getTime();
		return t.status.toLowerCase() === 'downloading' && ageInMillis >= oldTorrentAge;
	}

	async function generateHashList() {
		toast('The hash list will return a 404 for the first 1-2 minutes', {
			icon: '🔗',
			duration: 30000,
		});
		try {
			const hashList = filteredList.map((t) => ({
				filename: t.filename,
				hash: t.hash,
				bytes: t.bytes,
			}));
			const shortUrl = await createShortUrl(
				`${window.location.protocol}//${
					window.location.host
				}/hashlist#${lzString.compressToEncodedURIComponent(JSON.stringify(hashList))}`
			);
			window.open(shortUrl);
		} catch (error) {
			toast.error(`Error generating hash list, try again later`);
		}
	}

	async function handleShare(t: UserTorrent) {
		const hashList = [
			{
				filename: t.filename,
				hash: t.hash,
				bytes: t.bytes,
			},
		];
		router.push(
			`/hashlist#${lzString.compressToEncodedURIComponent(JSON.stringify(hashList))}`
		);
	}

	const handleReinsertTorrent = async (oldId: string) => {
		try {
			if (!rdKey) throw new Error('no_rd_key');
			const torrent = userTorrentsList.find((t) => t.id === oldId);
			if (!torrent) throw new Error('no_torrent_found');
			const hash = torrent.hash;
			const newId = await addHashAsMagnet(rdKey, hash);
			torrent.id = newId;
			await handleSelectFiles(newId);
			await handleDeleteTorrent(oldId, true);
			toast.success(`Torrent reinserted (${oldId}👉${newId})`);
		} catch (error) {
			toast.error(`Error reinserting torrent (${oldId})`);
			throw error;
		}
	};

	const handleRestartTorrent = async (id: string) => {
		try {
			if (!adKey) throw new Error('no_ad_key');
			await restartMagnet(adKey, id.substring(3));
			toast.success(`Torrent restarted (${id})`);
		} catch (error) {
			toast.error(`Error restarting torrent (${id})`);
			throw error;
		}
	};

	return (
		<div className="mx-4 my-8">
			<Head>
				<title>Debrid Media Manager - Library</title>
			</Head>
			<Toaster position="top-right" />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">
					My Library ({userTorrentsList.length} downloads in total; size:{' '}
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
					className="appearance-none bg-transparent border-none w-full text-gray-700 mr-3 py-1 px-2 leading-tight focus:outline-none"
					type="text"
					id="query"
					placeholder="quick search on filename, hash, or id. supports regex."
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
			</div>
			<div className="mb-4">
				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded ${
						currentPage <= 1 ? 'opacity-60 cursor-not-allowed' : ''
					}`}
					onClick={handlePrevPage}
					disabled={currentPage <= 1}
				>
					<FaArrowLeft />
				</button>
				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded ${
						currentPage >= Math.ceil(sortedData().length / ITEMS_PER_PAGE)
							? 'opacity-60 cursor-not-allowed'
							: ''
					}`}
					onClick={handleNextPage}
					disabled={currentPage >= Math.ceil(sortedData().length / ITEMS_PER_PAGE)}
				>
					<FaArrowRight />
				</button>
				<Link
					href="/library?mediaType=movie"
					className="mr-2 mb-2 bg-sky-800 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded"
				>
					Show {movieCount} movies
				</Link>
				<Link
					href="/library?mediaType=tv"
					className="mr-2 mb-2 bg-sky-800 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded"
				>
					Show {tvCount} TV shows
				</Link>
				<Link
					href="/library?status=slow"
					className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded"
				>
					Show slow torrents
				</Link>
				<Link
					href="/library?status=dupe"
					className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded"
				>
					Show duplicate torrents
				</Link>

				<button
					className={`mr-2 mb-2 bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-4 rounded ${
						Object.keys(router.query).filter(
							(q) => q !== 'mediaType' && router.query.status !== 'dupe'
						).length === 0
							? 'opacity-60 cursor-not-allowed'
							: ''
					}`}
					onClick={deleteFilteredTorrents}
					disabled={
						Object.keys(router.query).filter(
							(q) => q !== 'mediaType' && router.query.status !== 'dupe'
						).length === 0
					}
				>
					Delete torrents
				</button>

				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded ${
						filteredList.length === 0 ? 'opacity-60 cursor-not-allowed' : ''
					}`}
					onClick={generateHashList}
					disabled={filteredList.length === 0}
				>
					Share hash list
				</button>

				{Object.keys(router.query).length !== 0 && (
					<Link
						href="/library"
						className="mr-2 mb-2 bg-yellow-400 hover:bg-yellow-500 text-black py-2 px-4 rounded"
					>
						Clear filter
					</Link>
				)}
			</div>
			<div className="overflow-x-auto">
				{rdLoading || adLoading || grouping || filtering ? (
					<div className="flex justify-center items-center mt-4">
						<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
					</div>
				) : (
					<table className="w-full">
						<thead>
							<tr>
								<th
									className="px-4 py-2 cursor-pointer"
									onClick={() => handleSort('id')}
								>
									ID{` (${sortedData().length}) `}
									{sortBy.column === 'id' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
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
								<th
									className="px-4 py-2 cursor-pointer"
									onClick={() => handleSort('progress')}
								>
									Progress{' '}
									{sortBy.column === 'progress' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th
									className="px-4 py-2 cursor-pointer"
									onClick={() => handleSort('added')}
								>
									Added{' '}
									{sortBy.column === 'added' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th
									className="px-4 py-2 cursor-pointer"
									onClick={() => handleSort('score')}
								>
									Score{' '}
									{sortBy.column === 'score' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th className="px-4 py-2">Actions</th>
							</tr>
						</thead>
						<tbody>
							{sortedData()
								.slice(
									(currentPage - 1) * ITEMS_PER_PAGE,
									(currentPage - 1) * ITEMS_PER_PAGE + ITEMS_PER_PAGE
								)
								.map((torrent) => {
									const groupCount = getGroupings(torrent.mediaType)[
										getMediaId(torrent.info, torrent.mediaType)
									];
									const filterText =
										groupCount > 1 && !router.query.filter
											? `${groupCount - 1} other file${
													groupCount === 1 ? '' : 's'
											  }`
											: '';
									return (
										<tr
											key={torrent.id}
											className="border-t-2 hover:bg-yellow-100"
										>
											<td className="border px-4 py-2">{torrent.id}</td>
											<td className="border px-4 py-2">
												{!['Invalid Magnet', 'Magnet'].includes(
													torrent.filename
												) && (
													<>
														<strong>{torrent.title}</strong>{' '}
														<Link
															className="text-sm text-green-600 hover:text-green-800"
															href={`/library?filter=${getMediaId(
																torrent.info,
																torrent.mediaType
															)}`}
														>
															{filterText}
														</Link>{' '}
														<Link
															target="_blank"
															className="text-sm text-blue-600 hover:text-blue-800"
															href={`/search?query=${getMediaId(
																torrent.info,
																torrent.mediaType
															)}`}
														>
															Search again
														</Link>
														<br />
													</>
												)}
												{torrent.filename}
											</td>
											<td className="border px-4 py-2">
												{(torrent.bytes / ONE_GIGABYTE).toFixed(1)} GB
											</td>
											<td className="border px-4 py-2">
												{torrent.status === 'downloading'
													? `${torrent.progress}%`
													: torrent.status}
											</td>
											<td className="border px-4 py-2">
												{new Date(torrent.added).toLocaleString()}
											</td>
											<td className="border px-4 py-2">
												{torrent.score.toFixed(1)}
											</td>
											<td className="border px-2 py-2">
												<button
													title="Share"
													className="mr-2 mb-2 text-indigo-600"
													onClick={() => handleShare(torrent)}
												>
													<FaShare />
												</button>
												<button
													title="Delete"
													className="mr-2 mb-2 text-red-500"
													onClick={() => handleDeleteTorrent(torrent.id)}
												>
													<FaTrash />
												</button>
												<button
													title="Reinsert"
													className="mr-2 mb-2 text-green-500"
													onClick={() =>
														torrent.id.startsWith('rd')
															? handleReinsertTorrent(torrent.id)
															: handleRestartTorrent(torrent.id)
													}
												>
													<FaRecycle />
												</button>
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

export default withAuth(TorrentsPage);
