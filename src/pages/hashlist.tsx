import { useLibraryCache } from '@/contexts/LibraryCacheContext';
import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import { deleteMagnetAd, getMagnetStatus, uploadMagnet } from '@/services/allDebrid';
import { EnrichedHashlistTorrent, Hashlist, HashlistTorrent } from '@/services/mediasearch';
import {
	checkCachedStatus,
	createTorrent,
	getTorrentList,
	TorBoxRateLimitError,
} from '@/services/torbox';
import { TorBoxTorrentInfo } from '@/services/types';
import UserTorrentDB from '@/torrent/db';
import { handleAddAsMagnetInRd } from '@/utils/addMagnet';
import { runConcurrentFunctions } from '@/utils/batch';
import {
	handleDeleteAdTorrent,
	handleDeleteRdTorrent,
	handleDeleteTbTorrent,
} from '@/utils/deleteTorrent';
import {
	convertToAllDebridUserTorrent,
	convertToTbUserTorrent,
	convertToUserTorrent,
} from '@/utils/fetchTorrents';
import {
	checkDatabaseAvailabilityAd2,
	checkDatabaseAvailabilityRd2,
	checkDatabaseAvailabilityTb2,
	wrapLoading,
} from '@/utils/instantChecks';
import { getMediaId } from '@/utils/mediaId';
import { getTypeByName } from '@/utils/mediaType';
import getReleaseTags from '@/utils/score';
import { genericToastOptions } from '@/utils/toastOptions';
import { generateTokenAndHash } from '@/utils/token';
import { filenameParse } from '@ctrl/video-filename-parser';
import {
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Download,
	Film,
	Shuffle,
	Tv,
	X,
} from 'lucide-react';
import lzString from 'lz-string';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';

const ONE_GIGABYTE = 1024 * 1024 * 1024;
const ITEMS_PER_PAGE = 100;

interface SortBy {
	column: 'hash' | 'filename' | 'title' | 'bytes' | 'score';
	direction: 'asc' | 'desc';
}

const torrentDB = new UserTorrentDB();

function HashlistPage() {
	const router = useRouter();
	const [query, setQuery] = useState('');

	const [hashlistTitle, setHashlistTitle] = useState<string>('');
	const [userTorrentsList, setUserTorrentsList] = useState<EnrichedHashlistTorrent[]>([]);
	const [filteredList, setFilteredList] = useState<EnrichedHashlistTorrent[]>([]);
	const [showOnlyAvailable, setShowOnlyAvailable] = useState(true);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'hash', direction: 'asc' });

	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const tbKey = useTorBoxAccessToken();
	const { addTorrent: addToCache, removeTorrent: removeFromCache } = useLibraryCache();

	const [currentPage, setCurrentPage] = useState(1);
	const [movieCount, setMovieCount] = useState<number>(0);
	const [tvCount, setTvCount] = useState<number>(0);
	const [movieGrouping] = useState<Record<string, number>>({});
	const [tvGroupingByEpisode] = useState<Record<string, number>>({});
	const [tvGroupingByTitle] = useState<Record<string, number>>({});
	const [hasDupes] = useState<Array<string>>([]);
	const [totalBytes, setTotalBytes] = useState<number>(0);

	// Hashlist navigation state (for browsing hashlists from /hashlists page)
	const [navState, setNavState] = useState<{
		files: string[];
		names: string[];
		currentIndex: number;
	} | null>(null);
	const [navLoading, setNavLoading] = useState(false);
	const [mounted, setMounted] = useState(false);

	// Load navigation state from sessionStorage (client-side only)
	useEffect(() => {
		setMounted(true);
		const stored = sessionStorage.getItem('hashlistNav');
		if (stored) {
			try {
				setNavState(JSON.parse(stored));
			} catch {
				// Invalid JSON, ignore
			}
		}
	}, []);

	async function navigateToHashlist(index: number) {
		if (!navState || index < 0 || index >= navState.files.length) return;

		setNavLoading(true);
		try {
			const response = await fetch(navState.files[index]);
			const html = await response.text();
			const match = html.match(/src="https:\/\/debridmediamanager\.com\/hashlist#([^"]+)"/);
			if (match && match[1]) {
				// Update navigation state
				const newNavState = { ...navState, currentIndex: index };
				sessionStorage.setItem('hashlistNav', JSON.stringify(newNavState));
				setNavState(newNavState);
				// Navigate to new hashlist
				window.location.hash = match[1];
				window.location.reload();
			}
		} catch (err) {
			console.error('Failed to load hashlist:', err);
		} finally {
			setNavLoading(false);
		}
	}

	function handleNavPrevious() {
		if (navState && navState.currentIndex > 0) {
			navigateToHashlist(navState.currentIndex - 1);
		}
	}

	function handleNavNext() {
		if (navState && navState.currentIndex < navState.files.length - 1) {
			navigateToHashlist(navState.currentIndex + 1);
		}
	}

	function handleNavRandom() {
		if (!navState || navState.files.length <= 1) return;
		let newIndex;
		do {
			newIndex = Math.floor(Math.random() * navState.files.length);
		} while (newIndex === navState.currentIndex);
		navigateToHashlist(newIndex);
	}

	function clearNavState() {
		sessionStorage.removeItem('hashlistNav');
		setNavState(null);
	}

	async function initialize() {
		await torrentDB.initializeDB();
		await Promise.all([fetchUserTorrentsList(), fetchHashAndProgress()]);
	}

	useEffect(() => {
		if (userTorrentsList.length !== 0) return;
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey, adKey, tbKey]);

	async function decodeJsonStringFromUrl(): Promise<string> {
		const hash = window.location.hash;
		if (!hash) return '';
		const jsonString = lzString.decompressFromEncodedURIComponent(hash.substring(1));
		return jsonString;
	}

	async function readHashlist(): Promise<HashlistTorrent[]> {
		const jsonString = await decodeJsonStringFromUrl();
		if (jsonString.charAt(0) !== '[') {
			const hashlist = JSON.parse(jsonString) as Hashlist;
			setHashlistTitle(hashlist.title);
			return hashlist.torrents;
		}

		const torrents = JSON.parse(jsonString) as HashlistTorrent[];
		setHashlistTitle('Share this page');
		return torrents;
	}

	async function fetchUserTorrentsList() {
		try {
			const torrents = (await readHashlist())
				.map((torrent) => {
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
						rdAvailable: false,
						adAvailable: false,
						tbAvailable: false,
						noVideos: false,
						files: [],
						...torrent,
					};
				})
				// Filter out movies without a valid year; TV shows don't need one
				.filter(
					(t) => t.mediaType === 'tv' || (t.info.year && Number(t.info.year) > 0)
				) as EnrichedHashlistTorrent[];
			if (!torrents.length) return;
			setUserTorrentsList(torrents);

			const hashArr = torrents.map((r) => r.hash);
			if (rdKey) {
				const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
				wrapLoading(
					'RD',
					checkDatabaseAvailabilityRd2(
						tokenWithTimestamp,
						tokenHash,
						rdKey,
						hashArr,
						setUserTorrentsList
					)
				);
			}
			if (adKey) {
				const [tokenWithTimestamp, tokenHash] = await generateTokenAndHash();
				wrapLoading(
					'AD',
					checkDatabaseAvailabilityAd2(
						tokenWithTimestamp,
						tokenHash,
						hashArr,
						setUserTorrentsList
					)
				);
			}
			if (tbKey)
				wrapLoading(
					'TB',
					checkDatabaseAvailabilityTb2(tbKey, hashArr, setUserTorrentsList)
				);
		} catch (error) {
			console.error('Error fetching user torrents list:', error);
			setUserTorrentsList([]);
			toast.error('Failed to fetch user torrents.');
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
		// ensure tmpList is also unique in terms of hash
		tmpList = tmpList.filter((t, i, self) => self.findIndex((s) => s.hash === t.hash) === i);

		// Filter for instantly available torrents if enabled and keys are present
		if (showOnlyAvailable && (rdKey || adKey || tbKey)) {
			tmpList = tmpList.filter((t) => t.rdAvailable || t.adAvailable || t.tbAvailable);
		}

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
	}, [
		query,
		userTorrentsList,
		movieGrouping,
		tvGroupingByEpisode,
		router.query,
		showOnlyAvailable,
	]);

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

	function currentPageData() {
		return sortedData().slice(
			(currentPage - 1) * ITEMS_PER_PAGE,
			(currentPage - 1) * ITEMS_PER_PAGE + ITEMS_PER_PAGE
		);
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
		if (yetToDownload.length === 0) {
			toast.custom(
				(t) => (
					<div className="flex items-center rounded-lg bg-gray-800 px-4 py-3 text-white shadow-lg">
						<CheckCircle className="mr-2 h-5 w-5 text-green-500" />
						<span>Everything already downloaded</span>
					</div>
				),
				genericToastOptions
			);
			return;
		}

		const progressToast = toast.loading(
			`Downloading 0/${yetToDownload.length} torrents...`,
			genericToastOptions
		);

		const [results, errors] = await runConcurrentFunctions(
			yetToDownload,
			4,
			0,
			(completed, total, errorCount) => {
				const message =
					errorCount > 0
						? `Downloading ${completed}/${total} torrents (${errorCount} errors)...`
						: `Downloading ${completed}/${total} torrents...`;
				toast.loading(message, { id: progressToast });
			}
		);

		// Update the progress toast to show final result
		if (errors.length && results.length) {
			toast.error(`Downloaded ${results.length}; ${errors.length} failed.`, {
				id: progressToast,
				...genericToastOptions,
			});
		} else if (errors.length) {
			toast.error(`Failed to download ${errors.length} torrents.`, {
				id: progressToast,
				...genericToastOptions,
			});
		} else if (results.length) {
			toast.success(`Started ${results.length} downloads.`, {
				id: progressToast,
				...genericToastOptions,
			});
		} else {
			toast.dismiss(progressToast);
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
		if (yetToDownload.length === 0) {
			toast.custom(
				(t) => (
					<div className="flex items-center rounded-lg bg-gray-800 px-4 py-3 text-white shadow-lg">
						<CheckCircle className="mr-2 h-5 w-5 text-green-500" />
						<span>Everything already downloaded</span>
					</div>
				),
				genericToastOptions
			);
			return;
		}

		const progressToast = toast.loading(`Downloading 0/${yetToDownload.length} torrents...`);

		const [results, errors] = await runConcurrentFunctions(
			yetToDownload,
			4,
			0,
			(completed, total, errorCount) => {
				const message =
					errorCount > 0
						? `Downloading ${completed}/${total} torrents (${errorCount} errors)...`
						: `Downloading ${completed}/${total} torrents...`;
				toast.loading(message, { id: progressToast });
			}
		);

		// Update the progress toast to show final result
		if (errors.length && results.length) {
			toast.error(`Downloaded ${results.length}; ${errors.length} failed.`, {
				id: progressToast,
			});
		} else if (errors.length) {
			toast.error(`Failed to download ${errors.length} torrents.`, { id: progressToast });
		} else if (results.length) {
			toast.success(`Started ${results.length} downloads.`, { id: progressToast });
		} else {
			toast.dismiss(progressToast);
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
		if (yetToDownload.length === 0) {
			toast.custom(
				(t) => (
					<div className="flex items-center rounded-lg bg-gray-800 px-4 py-3 text-white shadow-lg">
						<CheckCircle className="mr-2 h-5 w-5 text-green-500" />
						<span>Everything already downloaded</span>
					</div>
				),
				genericToastOptions
			);
			return;
		}

		const progressToast = toast.loading(`Downloading 0/${yetToDownload.length} torrents...`);

		const [results, errors] = await runConcurrentFunctions(
			yetToDownload,
			4,
			0,
			(completed, total, errorCount) => {
				const message =
					errorCount > 0
						? `Downloading ${completed}/${total} torrents (${errorCount} errors)...`
						: `Downloading ${completed}/${total} torrents...`;
				toast.loading(message, { id: progressToast });
			}
		);

		// Update the progress toast to show final result
		if (errors.length && results.length) {
			toast.error(`Downloaded ${results.length}; ${errors.length} failed.`, {
				id: progressToast,
			});
		} else if (errors.length) {
			toast.error(`Failed to download ${errors.length} torrents.`, { id: progressToast });
		} else if (results.length) {
			toast.success(`Started ${results.length} downloads.`, { id: progressToast });
		} else {
			toast.dismiss(progressToast);
		}
	}

	async function addRd(hash: string) {
		await handleAddAsMagnetInRd(
			rdKey!,
			hash,
			async (info) => {
				const userTorrent = convertToUserTorrent({
					...info,
					id: info.id,
					filename: info.filename,
					bytes: info.bytes,
					status: info.status,
					added: info.added,
					links: info.links,
					hash: info.hash,
				});
				await torrentDB.addAll([userTorrent]);
				addToCache(userTorrent);
				await fetchHashAndProgress(hash);
			},
			true
		);
	}

	async function addAd(hash: string) {
		try {
			// AllDebrid removed /magnet/instant, so the upload *is* the cache
			// probe: `ready` tells us whether it was already cached, and a miss
			// has to be deleted again because uploading added it to the account.
			const magnetUri = hash.startsWith('magnet:?') ? hash : `magnet:?xt=urn:btih:${hash}`;
			const resp = await uploadMagnet(adKey!, [magnetUri]);
			if (resp.magnets.length === 0 || resp.magnets[0].error) {
				toast.error('Failed to add hash to AD.', genericToastOptions);
				return;
			}
			if (!resp.magnets[0].ready) {
				if (resp.magnets[0].id) {
					await deleteMagnetAd(adKey!, resp.magnets[0].id).catch(() => {});
				}
				toast.error('Torrent not instant in AD; skipped.', genericToastOptions);
				return;
			}
			if (resp.magnets[0].id) {
				const statusResp = await getMagnetStatus(adKey!, String(resp.magnets[0].id));
				if (statusResp.data?.magnets?.[0]) {
					const userTorrent = convertToAllDebridUserTorrent(statusResp.data.magnets[0]);
					await torrentDB.addAll([userTorrent]);
					addToCache(userTorrent);
					await fetchHashAndProgress(hash);
					toast.success('Torrent added to AD.', genericToastOptions);
				}
			}
		} catch (error) {
			console.error('Error adding magnet to AllDebrid:', error);
			toast.error('Failed to add hash to AD.', genericToastOptions);
		}
	}

	async function deleteRd(hash: string) {
		const torrents = await torrentDB.getAllByHash(hash);
		for (const t of torrents) {
			if (!t.id.startsWith('rd:')) continue;
			await handleDeleteRdTorrent(rdKey!, t.id);
			await torrentDB.deleteByHash('rd', hash);
			removeFromCache(t.id); // Update global cache
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
			removeFromCache(t.id); // Update global cache
			setHashAndProgress((prev) => {
				const newHashAndProgress = { ...prev };
				delete newHashAndProgress[`ad:${hash}`];
				return newHashAndProgress;
			});
		}
	}

	async function addTb(hash: string) {
		try {
			// Check if instant first
			const instantResp = await checkCachedStatus(
				{ hash: [hash], format: 'object', list_files: true },
				tbKey!
			);
			const cachedData = instantResp.data as any;
			if (!cachedData?.[hash]) {
				toast.error('Torrent not instant in TorBox; skipped.', genericToastOptions);
				return;
			}

			// Add the magnet
			const magnetUri = hash.startsWith('magnet:?') ? hash : `magnet:?xt=urn:btih:${hash}`;
			const resp = await createTorrent(tbKey!, { magnet: magnetUri });
			if (!resp.success || !resp.data?.torrent_id) {
				toast.error('Failed to add hash to TorBox.', genericToastOptions);
				return;
			}

			const torrentInfo = await getTorrentList(tbKey!, { id: resp.data.torrent_id });
			if (torrentInfo.success && torrentInfo.data) {
				const info = torrentInfo.data as TorBoxTorrentInfo;
				const userTorrent = convertToTbUserTorrent(info);
				await torrentDB.addAll([userTorrent]);
				addToCache(userTorrent);
				await fetchHashAndProgress(hash);
				toast.success('Torrent added to TorBox.', genericToastOptions);
			}
		} catch (error) {
			console.error('Error adding magnet to TorBox:', error);
			if (error instanceof TorBoxRateLimitError) {
				toast.error(
					'TorBox rate limit exceeded. Please wait and try again.',
					genericToastOptions
				);
			} else {
				toast.error('Failed to add hash to TorBox.', genericToastOptions);
			}
		}
	}

	async function deleteTb(hash: string) {
		const torrents = await torrentDB.getAllByHash(hash);
		for (const t of torrents) {
			if (!t.id.startsWith('tb:')) continue;
			await handleDeleteTbTorrent(tbKey!, t.id);
			await torrentDB.deleteByHash('tb', hash);
			removeFromCache(t.id); // Update global cache
			setHashAndProgress((prev) => {
				const newHashAndProgress = { ...prev };
				delete newHashAndProgress[`tb:${hash}`];
				return newHashAndProgress;
			});
		}
	}

	const handlePrevPage = useCallback(() => {
		setCurrentPage((prev) => prev - 1);
	}, []);

	const handleNextPage = useCallback(() => {
		setCurrentPage((prev) => prev + 1);
	}, []);

	return (
		<div className="mx-2 my-1 min-h-screen bg-gray-900 text-gray-100">
			<Head>
				<title>{`Debrid Media Manager - Hash list (${userTorrentsList.length} files)`}</title>
			</Head>
			<Toaster position="bottom-right" />

			{/* Hashlist Navigation Bar (when browsing from /hashlists) */}
			{mounted && navState && (
				<div className="mb-2 flex items-center justify-between border-b border-gray-700 bg-gray-800 px-2 py-2">
					<div className="flex items-center gap-2">
						<button
							onClick={handleNavPrevious}
							disabled={navState.currentIndex <= 0 || navLoading}
							className={`rounded border-2 border-indigo-500 bg-indigo-900/30 p-1.5 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
								navState.currentIndex <= 0 || navLoading
									? 'cursor-not-allowed opacity-50'
									: ''
							}`}
							title="Previous Hashlist"
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<button
							onClick={handleNavRandom}
							disabled={navState.files.length <= 1 || navLoading}
							className={`rounded border-2 border-purple-500 bg-purple-900/30 p-1.5 text-purple-100 transition-colors hover:bg-purple-800/50 ${
								navState.files.length <= 1 || navLoading
									? 'cursor-not-allowed opacity-50'
									: ''
							}`}
							title="Random Hashlist"
						>
							<Shuffle className="h-4 w-4" />
						</button>
						<button
							onClick={handleNavNext}
							disabled={
								navState.currentIndex >= navState.files.length - 1 || navLoading
							}
							className={`rounded border-2 border-indigo-500 bg-indigo-900/30 p-1.5 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
								navState.currentIndex >= navState.files.length - 1 || navLoading
									? 'cursor-not-allowed opacity-50'
									: ''
							}`}
							title="Next Hashlist"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
						<span className="ml-2 text-sm text-gray-300">
							{navLoading
								? 'Loading...'
								: `${navState.names[navState.currentIndex]} (${navState.currentIndex + 1}/${navState.files.length})`}
						</span>
					</div>
					<button
						onClick={clearNavState}
						className="rounded border-2 border-red-500 bg-red-900/30 p-1.5 text-red-100 transition-colors hover:bg-red-800/50"
						title="Exit Browser Mode"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			)}

			<div className="mb-2 flex items-center justify-between">
				<h1 className="text-xl font-bold text-white">
					{hashlistTitle} ({userTorrentsList.length} files in total; size:{' '}
					{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB)
				</h1>
				<Link
					href="/"
					className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>
			<div className="mb-4 flex items-center border-b-2 border-gray-600 py-2">
				<input
					className="mr-3 w-full appearance-none border-none bg-transparent px-2 py-1 leading-tight text-gray-100 focus:outline-none"
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
				<button
					className={`mb-2 mr-1 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-1 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
						currentPage <= 1 ? 'cursor-not-allowed opacity-60' : ''
					}`}
					onClick={handlePrevPage}
					disabled={currentPage <= 1}
				>
					<ChevronLeft className="h-4 w-4" />
				</button>
				<span className="w-16 text-center">
					{currentPage}/{Math.max(1, Math.ceil(sortedData().length / ITEMS_PER_PAGE))}
				</span>
				<button
					className={`mb-2 ml-1 mr-2 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-1 text-xs text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
						currentPage >= Math.ceil(sortedData().length / ITEMS_PER_PAGE)
							? 'cursor-not-allowed opacity-60'
							: ''
					}`}
					onClick={handleNextPage}
					disabled={currentPage >= Math.ceil(sortedData().length / ITEMS_PER_PAGE)}
				>
					<ChevronRight className="h-4 w-4" />
				</button>
				<Link
					href="/hashlist?mediaType=movie"
					className="mb-2 mr-2 rounded border-2 border-sky-500 bg-sky-900/30 px-2 py-1 text-sky-100 transition-colors hover:bg-sky-800/50"
				>
					{movieCount} Movies
				</Link>
				<Link
					href="/hashlist?mediaType=tv"
					className="mb-2 mr-2 rounded border-2 border-sky-500 bg-sky-900/30 px-2 py-1 text-sky-100 transition-colors hover:bg-sky-800/50"
				>
					{tvCount} TV Shows
				</Link>
				{mounted && (rdKey || adKey || tbKey) && (
					<button
						className={`mb-2 mr-2 rounded border-2 ${
							showOnlyAvailable
								? 'border-green-500 bg-green-900/30 text-green-100'
								: 'border-gray-500 bg-gray-900/30 text-gray-100'
						} px-2 py-1 transition-colors hover:bg-opacity-70`}
						onClick={() => {
							setShowOnlyAvailable(!showOnlyAvailable);
							setCurrentPage(1);
						}}
					>
						{showOnlyAvailable ? 'Show All' : 'Show Instant'}
					</button>
				)}
				{mounted && rdKey && (
					<>
						<button
							className={`mb-2 mr-2 rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-blue-100 transition-colors hover:bg-blue-800/50 ${
								filteredList.length === 0 || !rdKey
									? 'cursor-not-allowed opacity-60'
									: ''
							}`}
							onClick={downloadNonDupeTorrentsInRd}
							disabled={filteredList.length === 0 || !rdKey}
						>
							RD Download ({filteredList.length})
						</button>
					</>
				)}
				{mounted && adKey && (
					<>
						<button
							className={`mb-2 mr-2 rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-blue-100 transition-colors hover:bg-blue-800/50 ${
								filteredList.length === 0 || !adKey
									? 'cursor-not-allowed opacity-60'
									: ''
							}`}
							onClick={downloadNonDupeTorrentsInAd}
							disabled={filteredList.length === 0 || !adKey}
						>
							AD Download ({filteredList.length})
						</button>
					</>
				)}
				{mounted && tbKey && (
					<>
						<button
							className={`mb-2 mr-2 rounded border-2 border-purple-500 bg-purple-900/30 px-2 py-1 text-purple-100 transition-colors hover:bg-purple-800/50 ${
								filteredList.length === 0 || !tbKey
									? 'cursor-not-allowed opacity-60'
									: ''
							}`}
							onClick={downloadNonDupeTorrentsInTb}
							disabled={filteredList.length === 0 || !tbKey}
						>
							TB Download ({filteredList.length})
						</button>
					</>
				)}

				{Object.keys(router.query).length !== 0 && (
					<Link
						href="/hashlist"
						className="mb-2 mr-2 rounded border-2 border-yellow-500 bg-yellow-900/30 px-2 py-1 text-yellow-100 transition-colors hover:bg-yellow-800/50"
					>
						Reset
					</Link>
				)}

				{mounted && !rdKey && !adKey && !tbKey && (
					<>
						<span className="mb-2 mr-2 rounded px-2 py-1 text-white">
							Login to RD/AD/TB to download
						</span>
					</>
				)}

				{mounted && (rdKey || adKey || tbKey) && (
					<span className="text-s mr-2 bg-green-100 px-2.5 py-1 text-green-800">
						<strong>{userTorrentsList.length - filteredList.length}</strong> hidden
					</span>
				)}
			</div>
			<div className="overflow-x-auto">
				<table className="w-full">
					<thead>
						<tr className="border-b border-gray-700">
							<th
								className="cursor-pointer px-4 py-2 text-gray-300"
								onClick={() => handleSort('title')}
							>
								Title{' '}
								{sortBy.column === 'title' &&
									(sortBy.direction === 'asc' ? '↑' : '↓')}
							</th>
							<th
								className="cursor-pointer px-4 py-2 text-gray-300"
								onClick={() => handleSort('bytes')}
							>
								Size{' '}
								{sortBy.column === 'bytes' &&
									(sortBy.direction === 'asc' ? '↑' : '↓')}
							</th>
							<th className="px-4 py-2 text-gray-300">Actions</th>
						</tr>
					</thead>
					<tbody>
						{currentPageData().map((t, i) => {
							const groupCount = getGroupings(t.mediaType)[t.filename];
							const filterText =
								groupCount > 1 && !router.query.filter
									? `${groupCount - 1} other file${groupCount === 1 ? '' : 's'}`
									: '';
							return (
								<tr
									key={i}
									className={`border-b border-gray-800 hover:bg-gray-800/50 ${
										isDownloaded('rd', t.hash) ||
										isDownloaded('ad', t.hash) ||
										isDownloaded('tb', t.hash)
											? 'bg-green-900'
											: isDownloading('rd', t.hash) ||
												  isDownloading('ad', t.hash) ||
												  isDownloading('tb', t.hash)
												? 'bg-red-900'
												: ''
									} `}
								>
									<td className="border-0 px-4 py-2">
										{!['Invalid Magnet', 'Magnet'].includes(t.filename) && (
											<>
												<span className="cursor-pointer">
													{t.mediaType === 'tv' ? (
														<Tv className="inline-block h-4 w-4 text-cyan-400" />
													) : (
														<Film className="inline-block h-4 w-4 text-yellow-400" />
													)}
												</span>
												&nbsp;<strong>{t.title}</strong>{' '}
												{filterText && (
													<Link
														href={`/library?filter=${encodeURIComponent(
															t.title
														)}`}
														className="inline-block cursor-pointer rounded border-2 border-green-500 bg-green-900/30 px-1 py-0 text-xs text-green-100 transition-colors hover:bg-green-800/50"
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
													className="ml-1 inline-block cursor-pointer rounded border-2 border-blue-500 bg-blue-900/30 px-1 py-0 text-xs text-blue-100 transition-colors hover:bg-blue-800/50"
													onClick={(e) => e.stopPropagation()}
												>
													Search again
												</Link>
												<br />
											</>
										)}
										{t.filename}
									</td>

									<td className="border-0 px-4 py-2">
										{(t.bytes / ONE_GIGABYTE).toFixed(1)} GB
									</td>
									<td className="border-0 px-4 py-2">
										{mounted && rdKey && isDownloading('rd', t.hash) && (
											<button
												className="rounded border-2 border-red-500 bg-red-900/30 px-2 py-1 text-red-100 transition-colors hover:bg-red-800/50"
												onClick={() => deleteRd(t.hash)}
											>
												<X className="mr-1 inline h-3 w-3" />
												RD ({hashAndProgress[`rd:${t.hash}`] || 0}%)
											</button>
										)}
										{mounted &&
											rdKey &&
											!t.rdAvailable &&
											notInLibrary('rd', t.hash) && (
												<button
													className="rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-blue-100 transition-colors hover:bg-blue-800/50"
													onClick={() => addRd(t.hash)}
												>
													<Download className="mr-1 inline h-3 w-3" />
													RD
												</button>
											)}
										{mounted &&
											rdKey &&
											t.rdAvailable &&
											notInLibrary('rd', t.hash) && (
												<button
													className="rounded border-2 border-green-500 bg-green-900/30 px-2 py-1 text-green-100 transition-colors hover:bg-green-800/50"
													onClick={() => addRd(t.hash)}
												>
													<Download className="mr-1 inline h-3 w-3" />
													RD
												</button>
											)}

										{mounted && adKey && isDownloading('ad', t.hash) && (
											<button
												className="ml-2 rounded border-2 border-red-500 bg-red-900/30 px-2 py-1 text-red-100 transition-colors hover:bg-red-800/50"
												onClick={() => deleteAd(t.hash)}
											>
												<X className="mr-1 inline h-3 w-3" />
												AD ({hashAndProgress[`ad:${t.hash}`] + '%'})
											</button>
										)}
										{mounted &&
											adKey &&
											!t.adAvailable &&
											notInLibrary('ad', t.hash) && (
												<button
													className="ml-2 rounded border-2 border-blue-500 bg-blue-900/30 px-2 py-1 text-blue-100 transition-colors hover:bg-blue-800/50"
													onClick={() => addAd(t.hash)}
												>
													<Download className="mr-1 inline h-3 w-3" />
													AD
												</button>
											)}
										{mounted &&
											adKey &&
											t.adAvailable &&
											notInLibrary('ad', t.hash) && (
												<button
													className="ml-2 rounded border-2 border-green-500 bg-green-900/30 px-2 py-1 text-green-100 transition-colors hover:bg-green-800/50"
													onClick={() => addAd(t.hash)}
												>
													<Download className="mr-1 inline h-3 w-3" />
													AD
												</button>
											)}

										{mounted && tbKey && isDownloading('tb', t.hash) && (
											<button
												className="ml-2 rounded border-2 border-red-500 bg-red-900/30 px-2 py-1 text-red-100 transition-colors hover:bg-red-800/50"
												onClick={() => deleteTb(t.hash)}
											>
												<X className="mr-1 inline h-3 w-3" />
												TB ({hashAndProgress[`tb:${t.hash}`] || 0}%)
											</button>
										)}
										{mounted &&
											tbKey &&
											!t.tbAvailable &&
											notInLibrary('tb', t.hash) && (
												<button
													className="ml-2 rounded border-2 border-purple-500 bg-purple-900/30 px-2 py-1 text-purple-100 transition-colors hover:bg-purple-800/50"
													onClick={() => addTb(t.hash)}
												>
													<Download className="mr-1 inline h-3 w-3" />
													TB
												</button>
											)}
										{mounted &&
											tbKey &&
											t.tbAvailable &&
											notInLibrary('tb', t.hash) && (
												<button
													className="ml-2 rounded border-2 border-green-500 bg-green-900/30 px-2 py-1 text-green-100 transition-colors hover:bg-green-800/50"
													onClick={() => addTb(t.hash)}
												>
													<Download className="mr-1 inline h-3 w-3" />
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
			{/* Bottom pagination */}
			<div className="mt-4 flex items-center">
				<button
					className={`mr-1 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-1 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
						currentPage <= 1 ? 'cursor-not-allowed opacity-60' : ''
					}`}
					onClick={handlePrevPage}
					disabled={currentPage <= 1}
				>
					<ChevronLeft className="h-4 w-4" />
				</button>
				<span className="w-16 text-center">
					{currentPage}/{Math.max(1, Math.ceil(sortedData().length / ITEMS_PER_PAGE))}
				</span>
				<button
					className={`ml-1 rounded border-2 border-indigo-500 bg-indigo-900/30 px-1 py-1 text-xs text-indigo-100 transition-colors hover:bg-indigo-800/50 ${
						currentPage >= Math.ceil(sortedData().length / ITEMS_PER_PAGE)
							? 'cursor-not-allowed opacity-60'
							: ''
					}`}
					onClick={handleNextPage}
					disabled={currentPage >= Math.ceil(sortedData().length / ITEMS_PER_PAGE)}
				>
					<ChevronRight className="h-4 w-4" />
				</button>
			</div>
			{/* Spacer for floating library indicator */}
			<div className="pb-20" />
		</div>
	);
}

export default HashlistPage;
