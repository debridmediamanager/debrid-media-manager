import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxApiKey } from '@/hooks/auth';
import { EnrichedHashlistTorrent, HashlistTorrent } from '@/services/mediasearch';
import UserTorrentDB from '@/torrent/db';
import { handleAddAsMagnetInAd, handleAddAsMagnetInRd, handleAddAsMagnetInTb } from '@/utils/addMagnet';
import { runConcurrentFunctions } from '@/utils/batch';
import { handleDeleteAdTorrent, handleDeleteRdTorrent, handleDeleteTbTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid, fetchTorBox } from '@/utils/fetchTorrents';
import { instantCheckInAd2, instantCheckInRd2, instantHashListCheckInTb, wrapLoading } from '@/utils/instantChecks';
import { getMediaId } from '@/utils/mediaId';
import { getTypeByName } from '@/utils/mediaType';
import getReleaseTags from '@/utils/score';
import { genericToastOptions } from '@/utils/toastOptions';
import { filenameParse } from '@ctrl/video-filename-parser';
import lzString from 'lz-string';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { FaDownload, FaTimes } from 'react-icons/fa';

const ONE_GIGABYTE = 1024 * 1024 * 1024;

interface SortBy {
	column: 'hash' | 'filename' | 'title' | 'bytes' | 'score';
	direction: 'asc' | 'desc';
}

const torrentDB = new UserTorrentDB();

function HashlistPage() {
	const router = useRouter();
	const [query, setQuery] = useState('');

	const [userTorrentsList, setUserTorrentsList] = useState<EnrichedHashlistTorrent[]>([]);
	const [filteredList, setFilteredList] = useState<EnrichedHashlistTorrent[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'hash', direction: 'asc' });
	const [isClient, setIsClient] = useState(false)

	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const tbKey = useTorBoxApiKey();

	const [movieCount, setMovieCount] = useState<number>(0);
	const [tvCount, setTvCount] = useState<number>(0);
	const [movieGrouping] = useState<Record<string, number>>({});
	const [tvGroupingByEpisode] = useState<Record<string, number>>({});
	const [tvGroupingByTitle] = useState<Record<string, number>>({});
	const [hasDupes] = useState<Array<string>>([]);
	const [totalBytes, setTotalBytes] = useState<number>(0);

	async function initialize() {
		await torrentDB.initializeDB();
		await Promise.all([fetchUserTorrentsList(), fetchHashAndProgress()]);
	}

	useEffect(() => {
		if (userTorrentsList.length !== 0) return;
		initialize();
		setIsClient(true)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey, adKey, tbKey]);

	// fetch list from api
	async function getUserTorrentsList(): Promise<HashlistTorrent[]> {
		const hash = window.location.hash;
		if (!hash) return [];
		const jsonString = lzString.decompressFromEncodedURIComponent(hash.substring(1));
		return JSON.parse(jsonString) as HashlistTorrent[];
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
			}) as EnrichedHashlistTorrent[];
			if (!torrents.length) return;

			setUserTorrentsList(torrents);

			const hashArr = torrents.map((r) => r.hash);
			if (rdKey) wrapLoading('RD', instantCheckInRd2(rdKey, hashArr, setUserTorrentsList));
			if (adKey) wrapLoading('AD', instantCheckInAd2(adKey, hashArr, setUserTorrentsList));
			if (tbKey) wrapLoading('TorBox cache', instantHashListCheckInTb(tbKey, hashArr, setUserTorrentsList))
		} catch (error) {
			setUserTorrentsList([]);
			toast.error('Error fetching user torrents list');
		}
	}

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

	// aggregate metadata
	useEffect(() => {
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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [userTorrentsList]);

	// set the list you see
	async function filterOutAlreadyDownloaded(unfiltered: EnrichedHashlistTorrent[]) {
		if (unfiltered.length <= 1) return unfiltered;
		const hashes = await torrentDB.hashes();
		return unfiltered.filter((t) => !hashes.has(t.hash));
	}
	function applyQuickSearch(unfiltered: EnrichedHashlistTorrent[]) {
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
		const notYetDownloaded = await filterOutAlreadyDownloaded(userTorrentsList);
		let tmpList = notYetDownloaded;
		tmpList = tmpList.filter((t) => t.rdAvailable || t.adAvailable);
		// ensure tmpList is also unique in terms of hash
		tmpList = tmpList.filter((t, i, self) => self.findIndex((s) => s.hash === t.hash) === i);
		if (Object.keys(router.query).length === 0) {
			setFilteredList(applyQuickSearch(tmpList));
			return;
		}
		const { filter: titleFilter, mediaType } = router.query;
		if (titleFilter) {
			const decodedTitleFilter = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => decodedTitleFilter === t.title);
			setFilteredList(applyQuickSearch(tmpList));
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => mediaType === t.mediaType);
			setFilteredList(applyQuickSearch(tmpList));
		}
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
		// Check if sortBy.column is not set
		// if (sortBy.column === 'hash') {
		// 	// Randomize the list
		// 	return filteredList.sort(() => Math.random() - 0.5);
		// }
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

	const getGroupings = (mediaType: EnrichedHashlistTorrent['mediaType']) =>
		mediaType === 'tv' ? tvGroupingByEpisode : movieGrouping;

	function clearGroupings(frequencyMap: { [x: string]: number }) {
		for (let key in frequencyMap) {
			delete frequencyMap[key];
		}
	}

	function wrapDownloadFilesInRdFn(t: EnrichedHashlistTorrent) {
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

	function wrapDownloadFilesInAdFn(t: EnrichedHashlistTorrent) {
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

	function wrapDownloadFilesInTbFn(t: EnrichedHashlistTorrent) {
		return async () => await addTb(t.hash);
	}
	async function downloadNonDupeTorrentsInTb() {
		const libraryHashes = await torrentDB.hashes();
		const yetToDownload = filteredList
			.filter((t) => !libraryHashes.has(t.hash))
			.map(wrapDownloadFilesInTbFn);
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

	async function addTb(hash: string) {
		await handleAddAsMagnetInTb(tbKey!, hash);
		await fetchTorBox(tbKey!, async (torrents) => {
			await torrentDB.addAll(torrents);
			await fetchHashAndProgress(hash);
		});
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

	return (
		<div className="mx-2 my-1">
			<Head>
				<title>
					{`Debrid Media Manager - Hash list: ${(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB`}
				</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-2">
				<h1 className="text-xl font-bold">
					Share this page ({userTorrentsList.length} files in total; size:{' '}
					{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB)
				</h1>
				<Link
					href="/"
					className="text-sm bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded"
				>
					Go Home
				</Link>
			</div>
			<div className="flex items-center border-b-2 border-gray-500 py-2 mb-4">
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
				{isClient && rdKey ? (
					<button
						className={`mr-2 mb-2 bg-blue-700 hover:bg-blue-600 text-white font-bold py-1 px-2 rounded ${
							filteredList.length === 0 || !rdKey
								? 'opacity-60 cursor-not-allowed'
								: ''
						}`}
						onClick={downloadNonDupeTorrentsInRd}
						disabled={filteredList.length === 0 || !rdKey}
					>
						Download {filteredList.length} in Real-Debrid
					</button>
				) : null}
				{isClient && adKey && (
					<button
						className={`mr-2 mb-2 bg-blue-700 hover:bg-blue-600 text-white font-bold py-1 px-2 rounded ${
							filteredList.length === 0 || !adKey
								? 'opacity-60 cursor-not-allowed'
								: ''
						}`}
						onClick={downloadNonDupeTorrentsInAd}
						disabled={filteredList.length === 0 || !adKey}
					>
						Download {filteredList.length} in AllDebrid
					</button>
				)}
				{isClient && tbKey && (
					<button
						className={`mr-2 mb-2 bg-[#04BF8A] hover:bg-[#095842] text-white font-bold py-1 px-2 rounded ${
							filteredList.length === 0 || !tbKey
								? 'opacity-60 cursor-not-allowed'
								: ''
						}`}
						onClick={downloadNonDupeTorrentsInTb}
						disabled={filteredList.length === 0 || !tbKey}
					>
						Download {filteredList.length} in TorBox
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

				{isClient && (rdKey || adKey || tbKey) && (
					<span className="py-1 px-2 text-md bg-green-100 text-green-800 mr-2 mb-2 rounded h-full">
						<strong>
							{userTorrentsList.length - filteredList.length} torrents hidden
						</strong>{' '}
						because its already in your library or its not cached in RD/AD/TB
					</span>
				)}
			</div>
			<div className="overflow-x-auto">
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
									? `${groupCount - 1} other file${groupCount === 1 ? '' : 's'}`
									: '';
							return (
								<tr
									key={i}
									className={`
									hover:bg-purple-900
									border-t-2
									${
										isDownloaded('rd', t.hash) || isDownloaded('ad', t.hash)
											? 'bg-green-900'
											: isDownloading('rd', t.hash) ||
												  isDownloading('ad', t.hash)
												? 'bg-red-900'
												: ''
									}
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
										{isClient && rdKey && isDownloading('rd', t.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded"
												onClick={() => deleteRd(t.hash)}
											>
												<FaTimes />
												RD ({hashAndProgress[`rd:${t.hash}`] + '%'})
											</button>
										)}
										{isClient && rdKey && !t.rdAvailable && notInLibrary('rd', t.hash) && (
											<button
												className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded"
												onClick={() => addRd(t.hash)}
											>
												<FaDownload />
												RD
											</button>
										)}
										{isClient && rdKey && t.rdAvailable && notInLibrary('rd', t.hash) && (
											<button
												className="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded"
												onClick={() => addRd(t.hash)}
											>
												<FaDownload />
												RD
											</button>
										)}

										{isClient && adKey && isDownloading('ad', t.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded"
												onClick={() => deleteAd(t.hash)}
											>
												<FaTimes />
												AD ({hashAndProgress[`ad:${t.hash}`] + '%'})
											</button>
										)}
										{isClient && adKey && !t.adAvailable && notInLibrary('ad', t.hash) && (
											<button
												className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded"
												onClick={() => addAd(t.hash)}
											>
												<FaDownload />
												AD
											</button>
										)}
										{isClient && adKey && t.adAvailable && notInLibrary('ad', t.hash) && (
											<button
												className="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded"
												onClick={() => addAd(t.hash)}
											>
												<FaDownload />
												AD
											</button>
										)}

										{isClient && tbKey && isDownloading('tb', t.hash) && (
											<button
												className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded"
												onClick={() => deleteTb(t.hash)}
											>
												<FaTimes />
												TB ({hashAndProgress[`tb:${t.hash}`] + '%'})
											</button>
										)}
										{isClient && tbKey && !t.tbAvailable && notInLibrary('tb', t.hash) && (
											<button
												className="bg-[#04BF8A] hover:bg-[#095842] text-white font-bold py-1 px-2 rounded"
												onClick={() => addTb(t.hash)}
											>
												<FaDownload />
												TB
											</button>
										)}
										{isClient && tbKey && t.tbAvailable && notInLibrary('tb', t.hash) && (
											<button
												className="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded"
												onClick={() => addTb(t.hash)}
											>
												<FaDownload />
												TB
											</button>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export default HashlistPage;
