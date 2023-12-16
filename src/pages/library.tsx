import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useDownloadsCache } from '@/hooks/cache';
import { UserTorrent, getKeyByStatus, uniqId } from '@/types/userTorrent';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInRd,
	handleReinsertTorrent,
	handleRestartTorrent,
	handleSelectFilesInRd,
} from '@/utils/addMagnet';
import { AsyncFunction, runConcurrentFunctions } from '@/utils/batch';
import { deleteFilteredTorrents } from '@/utils/deleteList';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { fetchAllDebrid, fetchRealDebrid } from '@/utils/fetchTorrents';
import { generateHashList, handleShare } from '@/utils/hashList';
import { localRestore } from '@/utils/localRestore';
import { applyQuickSearch } from '@/utils/quickSearch';
import { showInfo } from '@/utils/showInfo';
import { isFailed, isInProgress, isSlowOrNoLinks } from '@/utils/slow';
import { shortenNumber } from '@/utils/speed';
import { libraryToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import { saveAs } from 'file-saver';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import {
	FaArrowLeft,
	FaArrowRight,
	FaMagnet,
	FaRecycle,
	FaSeedling,
	FaShare,
	FaTrash,
} from 'react-icons/fa';
import Swal from 'sweetalert2';

const ONE_GIGABYTE = 1024 * 1024 * 1024;
const ITEMS_PER_PAGE = 100;

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
	const [helpText, setHelpText] = useState('');

	// keys
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();

	const [movieGrouping] = useState<Record<string, number>>({});
	const [tvGroupingByEpisode] = useState<Record<string, number>>({});
	const [tvGroupingByTitle] = useState<Record<string, number>>({});
	const [sameTitle] = useState<Array<string>>([]);

	// filter counts
	const [slowCount, setSlowCount] = useState(0);
	const [inProgressCount, setInProgressCount] = useState(0);
	const [failedCount, setFailedCount] = useState(0);

	// stats
	const [totalBytes, setTotalBytes] = useState<number>(0);

	// cache
	const [_1, rdUtils, rdCacheAdder, removeFromRdCache] = useDownloadsCache('rd');
	const [_2, adUtils, adCacheAdder, removeFromAdCache] = useDownloadsCache('ad');

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

	const fillTableWithRDLibrary = async function (customLimit?: number) {
		if (!rdKey) {
			setRdLoading(false);
			return;
		}
		fetchRealDebrid(
			rdKey,
			(torrents: UserTorrent[]) => {
				setUserTorrentsList((prev) => {
					const existingIds = new Set(prev.map((torrent) => torrent.id));
					const newTorrents = torrents.filter((torrent) => !existingIds.has(torrent.id));
					return [...prev, ...newTorrents];
				});
				rdCacheAdder.many(
					torrents.map((t) => ({
						id: t.id,
						hash: t.hash,
						status: t.status === 'downloaded' ? 'downloaded' : 'downloading',
						progress: t.progress,
					}))
				);
				setRdLoading(false);
			},
			customLimit
		);
	};

	const fillTableWithADLibrary = async function () {
		if (!adKey) {
			setAdLoading(false);
			return;
		}
		fetchAllDebrid(adKey, (torrents: UserTorrent[]) => {
			setUserTorrentsList((prev) => {
				const existingIds = new Set(prev.map((torrent) => torrent.id));
				const newTorrents = torrents.filter((torrent) => !existingIds.has(torrent.id));
				return [...prev, ...newTorrents];
			});
			adCacheAdder.many(
				torrents.map((t) => ({
					id: t.id,
					hash: t.hash,
					status: t.status === 'downloaded' ? 'downloaded' : 'downloading',
					progress: t.progress,
				}))
			);
			setAdLoading(false);
		});
	};

	// fetch list from api
	useEffect(() => {
		fillTableWithRDLibrary();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey]);

	useEffect(() => {
		fillTableWithADLibrary();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [adKey]);

	// aggregate metadata
	useEffect(() => {
		if (rdLoading || adLoading) return;
		setGrouping(true);
		setTotalBytes(0);
		sameTitle.length = 0; // clear array

		let tmpTotalBytes = 0;
		clearGroupings(movieGrouping);
		clearGroupings(tvGroupingByEpisode);
		const hashes: Map<string, number> = new Map();
		for (const t of userTorrentsList) {
			const key = uniqId(t);
			if (!hashes.has(key)) {
				hashes.set(key, t.bytes);
				tmpTotalBytes += t.bytes;
			} else {
				const prevBytes = hashes.get(key) || 0;
				if (prevBytes < t.bytes) {
					tmpTotalBytes -= prevBytes;
					tmpTotalBytes += t.bytes;
					hashes.set(key, t.bytes);
				}
			}
			if (t.title in getGroupings(t.mediaType)) {
				if (getGroupings(t.mediaType)[t.title] === 1) sameTitle.push(t.title);
				getGroupings(t.mediaType)[t.title]++;
			} else {
				getGroupings(t.mediaType)[t.title] = 1;
			}
			if (t.mediaType === 'tv') {
				const title = t.title;
				if (title in tvGroupingByTitle) {
					tvGroupingByTitle[title]++;
				} else {
					tvGroupingByTitle[title] = 1;
				}
			}
		}

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
	]);

	// set the list you see
	useEffect(() => {
		if (rdLoading || adLoading || grouping) return;
		setFiltering(true);
		if (hasNoQueryParamsBut('page')) {
			setFilteredList(applyQuickSearch(query, userTorrentsList));
			selectPlayableFiles(userTorrentsList);
			// deleteFailedTorrents(userTorrentsList); // disabled because this is BAD!
			setFiltering(false);
			setHelpText(
				[
					'Tip: You can use hash lists to share you library with others anonymously. Click on the button, wait for the page to finish processing, and share the link to your friends.',
					'Tip: You can make a local backup of your library by using the "Local backup" button. This will generate a file containing your whole library that you can use to restore your library later.',
					'Tip: You can restore a local backup by using the "Local restore" button. It will only restore the torrents that are not already in your library.',
					'Tip: The quick search box will filter the list by filename and id. You can use multiple words or even regex to filter your library. This way, you can select multiple torrents and delete them at once, or share them as a hash list.',
					'Have you tried clicking on a torrent? You can see the links, the progress, and the status of the torrent. You can also select the files you want to download.',
					'I don\'t know what to put here, so here\'s a random tip: "The average person walks the equivalent of five times around the world in a lifetime."',
				][Math.floor(Math.random() * 6)]
			);
			return;
		}
		const { filter: titleFilter, mediaType, status } = router.query;

		setSlowCount(userTorrentsList.filter(isSlowOrNoLinks).length);
		setInProgressCount(userTorrentsList.filter(isInProgress).length);
		setFailedCount(userTorrentsList.filter(isFailed).length);

		let tmpList = userTorrentsList;
		if (status === 'slow') {
			tmpList = tmpList.filter(isSlowOrNoLinks);
			setFilteredList(applyQuickSearch(query, tmpList));
			setHelpText(
				'The displayed torrents either do not contain any links or are older than one hour and lack any seeders. You can use the "Delete shown" option to remove them.'
			);
		}
		if (status === 'sametitle') {
			tmpList = tmpList.filter((t) => sameTitle.includes(t.title));
			setFilteredList(applyQuickSearch(query, tmpList));
			setHelpText(
				'Torrents shown have the same title parsed from the torrent name. Use "By size" to retain the larger torrent for each title, or "By date" to retain the more recent torrent. Take note: the parser might not work well for multi-season tv show torrents.'
			);
		}
		if (status === 'inprogress') {
			tmpList = tmpList.filter(isInProgress);
			setFilteredList(applyQuickSearch(query, tmpList));
			setHelpText('Torrents that are still downloading');
		}
		if (status === 'failed') {
			tmpList = tmpList.filter(isFailed);
			setFilteredList(applyQuickSearch(query, tmpList));
			setHelpText('Torrents that have a failure status');
		}
		if (titleFilter) {
			const decodedTitleFilter = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => decodedTitleFilter === t.title);
			setFilteredList(applyQuickSearch(query, tmpList));
			setHelpText(`Torrents shown have the title "${titleFilter}".`);
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => mediaType === t.mediaType);
			setFilteredList(applyQuickSearch(query, tmpList));
			setHelpText(
				`Torrents shown are detected as ${mediaType === 'movie' ? 'movies' : 'tv shows'}.`
			);
		}
		selectPlayableFiles(tmpList);
		setFiltering(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query, userTorrentsList, rdLoading, adLoading, grouping, query, currentPage]);

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

			// If comparison is 0 and the column is 'progress', then compare by the length of the links property
			if (comparison === 0 && sortBy.column === 'progress') {
				comparison = (a.links || []).length - (b.links || []).length;
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

	function wrapSelectFilesFn(t: UserTorrent) {
		return async () => await handleSelectFilesInRd(rdKey!, t.id, removeFromRdCache);
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
			toast.error(`Error selecting files on ${errors.length} torrents`, libraryToastOptions);
		}
		if (results.length) {
			toast.success(`Started downloading ${results.length} torrents`, libraryToastOptions);
		}
	}

	async function handleDeleteShownTorrents() {
		if (
			filteredList.length > 0 &&
			!(
				await Swal.fire({
					title: 'Delete shown',
					text: `This will delete the ${filteredList.length} torrents filtered. Are you sure?`,
					icon: 'warning',
					showCancelButton: true,
					confirmButtonColor: '#3085d6',
					cancelButtonColor: '#d33',
					confirmButtonText: 'Yes, delete!',
				})
			).isConfirmed
		)
			return;
		await deleteFilteredTorrents(filteredList, wrapDeleteFn);
	}

	function wrapDeleteFn(t: UserTorrent) {
		return async () => {
			if (rdKey && t.id.startsWith('rd:')) {
				await handleDeleteRdTorrent(rdKey, t.id, removeFromRdCache);
			}
			if (adKey && t.id.startsWith('ad:')) {
				await handleDeleteAdTorrent(adKey, t.id, removeFromAdCache);
			}
			setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== t.id));
		};
	}

	async function dedupeBySize() {
		const deletePreference = await Swal.fire({
			title: 'Delete by size',
			text: 'Choose which duplicate torrents to delete based on size:',
			icon: 'question',
			showCancelButton: true,
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			denyButtonColor: 'green',
			confirmButtonText: 'Delete Smaller',
			denyButtonText: 'Delete Bigger',
			showDenyButton: true,
			cancelButtonText: `Cancel`,
		});

		// If the user cancels the operation, return without doing anything
		if (deletePreference.isDismissed) return;

		// Determine the preference for deletion
		const deleteBigger = deletePreference.isDenied;

		// Get the key by status
		const getKey = getKeyByStatus(router.query.status as string);
		const dupes: UserTorrent[] = [];
		filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
			let key = getKey(cur);
			if (acc[key]) {
				// Check if current is bigger or smaller based on the user's choice
				const isPreferred = deleteBigger
					? acc[key].bytes < cur.bytes
					: acc[key].bytes > cur.bytes;
				if (isPreferred) {
					dupes.push(acc[key]);
					acc[key] = cur;
				} else {
					dupes.push(cur);
				}
			} else {
				acc[key] = cur;
			}
			return acc;
		}, {});

		// Map duplicates to delete function based on preference
		const toDelete = dupes.map(wrapDeleteFn);
		const [results, errors] = await runConcurrentFunctions(toDelete, 5, 500);

		// Handle toast notifications for errors and results
		if (errors.length) {
			toast.error(`Error deleting ${errors.length} torrents`, libraryToastOptions);
		}
		if (results.length) {
			toast.success(`Deleted ${results.length} torrents`, libraryToastOptions);
		}
		if (!errors.length && !results.length) {
			toast('No torrents to delete', libraryToastOptions);
		}
	}

	async function dedupeByRecency() {
		// New dialog to select whether to delete newer or older torrents
		const deletePreference = await Swal.fire({
			title: 'Delete by date',
			text: 'Choose which duplicate torrents to delete:',
			icon: 'question',
			showCancelButton: true,
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			denyButtonColor: 'green',
			confirmButtonText: 'Delete Older',
			denyButtonText: 'Delete Newer',
			showDenyButton: true,
			cancelButtonText: `Cancel`,
		});

		// If the user cancels the operation, return without doing anything
		if (deletePreference.isDismissed) return;

		// Determine the preference for deletion
		const deleteOlder = deletePreference.isConfirmed;

		// Get the key by status
		const getKey = getKeyByStatus(router.query.status as string);
		const dupes: UserTorrent[] = [];
		filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
			let key = getKey(cur);
			if (acc[key]) {
				// Check if current is newer based on the user's choice
				const isPreferred = deleteOlder
					? acc[key].added > cur.added
					: acc[key].added < cur.added;
				if (isPreferred) {
					dupes.push(acc[key]);
					acc[key] = cur;
				} else {
					dupes.push(cur);
				}
			} else {
				acc[key] = cur;
			}
			return acc;
		}, {});

		// Map duplicates to delete function based on preference
		const toDelete = dupes.map(wrapDeleteFn);
		const [results, errors] = await runConcurrentFunctions(toDelete, 5, 500);

		// Handle toast notifications for errors and results
		if (errors.length) {
			toast.error(`Error deleting ${errors.length} torrents`, libraryToastOptions);
		}
		if (results.length) {
			toast.success(`Deleted ${results.length} torrents`, libraryToastOptions);
		}
		if (!errors.length && !results.length) {
			toast('No torrents to delete', libraryToastOptions);
		}
	}

	function wrapReinsertFn(t: UserTorrent) {
		return async () => {
			if (rdKey && t.id.startsWith('rd:'))
				await handleReinsertTorrent(rdKey, t.id, userTorrentsList, removeFromRdCache);
			if (adKey && t.id.startsWith('ad:')) await handleRestartTorrent(adKey, t.id);
		};
	}

	async function combineSameHash() {
		const dupeHashes: Map<string, UserTorrent[]> = new Map();
		userTorrentsList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
			if (cur.progress !== 100) return acc;
			let key = cur.hash;
			if (acc[key]) {
				if (!dupeHashes.has(key)) {
					dupeHashes.set(key, new Array(acc[key]));
				}
				dupeHashes.get(key)?.push(cur);
			} else {
				acc[key] = cur;
			}
			return acc;
		}, {});
		let dupeHashesCount = 0;
		dupeHashes.forEach((hashes) => {
			dupeHashesCount += hashes.length;
		});
		if (
			dupeHashesCount > 0 &&
			!(
				await Swal.fire({
					title: 'Merge same hash',
					text: `This will combine the ${dupeHashesCount} completed torrents with identical hashes into ${dupeHashes.size} and select all streamable files. Make sure to backup before doing this. Do you want to proceed?`,
					icon: 'warning',
					showCancelButton: true,
					confirmButtonColor: '#3085d6',
					cancelButtonColor: '#d33',
					confirmButtonText: 'Yes, proceed!',
				})
			).isConfirmed
		)
			return;
		let toReinsertAndDelete: AsyncFunction<unknown>[] = [];
		dupeHashes.forEach((sameHashTorrents: UserTorrent[]) => {
			const reinsert = sameHashTorrents.pop();
			if (reinsert) {
				toReinsertAndDelete.push(wrapReinsertFn(reinsert));
				toReinsertAndDelete = toReinsertAndDelete.concat(
					sameHashTorrents.map(wrapDeleteFn)
				);
			}
		});
		const [results, errors] = await runConcurrentFunctions(toReinsertAndDelete, 5, 500);
		if (errors.length) {
			toast.error(`Error with merging ${errors.length} torrents`, libraryToastOptions);
		}
		if (results.length) {
			toast.success(`Merged ${results.length} torrents`, libraryToastOptions);
		}
		if (!errors.length && !results.length) {
			toast('No torrents to merge', libraryToastOptions);
		}
	}

	async function localBackup() {
		toast('Generating a local backup file', libraryToastOptions);
		try {
			const hashList = userTorrentsList.map((t) => ({
				filename: t.filename,
				hash: t.hash,
			}));
			const blob = new Blob([JSON.stringify(hashList, null, 2)], {
				type: 'application/json',
			});
			saveAs(blob, `backup-${Date.now()}.dmm.json`);
		} catch (error) {
			toast.error(`Error creating a backup file`, libraryToastOptions);
			console.error(error);
		}
	}

	async function wrapLocalRestoreFn(debridService: string) {
		return await localRestore((files: any[]) => {
			const utils = debridService === 'rd' ? rdUtils : adUtils;
			const addMagnet = (hash: string) => {
				if (rdKey && debridService === 'rd')
					return handleAddAsMagnetInRd(
						rdKey,
						hash,
						async (id: string) => {
							await handleSelectFilesInRd(rdKey, `rd:${id}`, removeFromRdCache, true);
							rdCacheAdder.single(`rd:${id}`, hash);
						},
						true
					);
				if (adKey && debridService === 'ad')
					return handleAddAsMagnetInAd(
						adKey,
						hash,
						async (id: string) => {
							adCacheAdder.single(`ad:${id}`, hash);
						},
						true
					);
			};

			function wrapAddMagnetFn(hash: string) {
				return async () => await addMagnet(hash);
			}

			const processingPromise = new Promise<{ success: number; error: number }>(
				async (resolve) => {
					toast.loading(`DO NOT REFRESH THE PAGE`, libraryToastOptions);
					const toAdd = files
						.map((f) => f.hash)
						.filter((h) => !utils.inLibrary(h))
						.map(wrapAddMagnetFn);
					const [results, errors] = await runConcurrentFunctions(toAdd, 5, 500);
					resolve({ success: results.length, error: errors.length });
				}
			);

			toast.promise(
				processingPromise,
				{
					loading: `Restoring ${files.length} downloads in your library.`,
					success: ({ success, error }) => {
						window.localStorage.removeItem(`${debridService}:downloads`);
						setTimeout(() => location.reload(), 10000);
						return `Restored ${success} torrents but failed on ${error} others in your ${debridService.toUpperCase()} library. Refreshing the page in 10 seconds.`;
					},
					error: '',
				},
				{
					...libraryToastOptions,
					duration: 10000,
				}
			);
		});
	}

	async function handleAddMagnet(debridService: string) {
		const { value: hash } = await Swal.fire({
			title: `Add magnet to your ${debridService.toUpperCase()} library`,
			input: 'text',
			inputLabel: 'Paste your Magnet link here',
			inputValue: '',
			showCancelButton: true,
			inputValidator: (value) => !value && 'You need to put something!',
		});
		if (rdKey && hash && debridService === 'rd') {
			handleAddAsMagnetInRd(rdKey, hash, async (id: string) => {
				await handleSelectFilesInRd(rdKey, `rd:${id}`, removeFromRdCache, true);
				await fillTableWithRDLibrary(10);
				rdCacheAdder.single(`rd:${id}`, hash, false);
			});
		}
		if (adKey && hash && debridService === 'ad') {
			handleAddAsMagnetInAd(adKey, hash, async (id: string) => {
				await fillTableWithADLibrary();
				adCacheAdder.single(`ad:${id}`, hash, false);
			});
		}
	}

	async function handleCopyMagnet(hash: string) {
		const magnet = `magnet:?xt=urn:btih:${hash}`;
		await navigator.clipboard.writeText(magnet);
		toast.success('Copied magnet url to clipboard', libraryToastOptions);
	}

	const hasNoQueryParamsBut = (...params: string[]) =>
		Object.keys(router.query).filter((p) => !params.includes(p)).length === 0;

	return (
		<div className="mx-4 my-8">
			<Head>
				<title>Debrid Media Manager - Library</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-4">
				<h1 className="text-3xl font-bold">
					My Library 📚 {userTorrentsList.length} torrents{' '}
					{totalBytes / ONE_GIGABYTE / 1024 > 10000
						? '😱' // Fear for more than 10 PB
						: totalBytes / ONE_GIGABYTE / 1024 > 1000
						? '😨' // Fearful surprise for more than 1 PB
						: totalBytes / ONE_GIGABYTE / 1024 > 100
						? '😮' // Surprise for more than 100 TB
						: totalBytes / ONE_GIGABYTE / 1024 > 10
						? '🙂' // Smile for more than 10 TB
						: totalBytes / ONE_GIGABYTE / 1024 > 1
						? '😐' // Neutral for more than 1 TB
						: '🙁'}{' '}
					{/* Sad for 1 TB or less */}
					{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB
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
						setCurrentPage(1);
						setQuery(e.target.value.toLocaleLowerCase());
					}}
				/>
			</div>
			{/* Start of Main Menu */}
			<div className="mb-4 flex">
				<button
					className={`mr-1 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded ${
						currentPage <= 1 ? 'opacity-60 cursor-not-allowed' : ''
					}`}
					onClick={handlePrevPage}
					disabled={currentPage <= 1}
				>
					<FaArrowLeft />
				</button>
				<span className="w-16 text-center">
					{currentPage}/{Math.ceil(sortedData().length / ITEMS_PER_PAGE)}
				</span>
				<button
					className={`ml-1 mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded ${
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
					href="/library?mediaType=movie&page=1"
					className="mr-2 mb-2 bg-yellow-300 hover:bg-yellow-200 text-white font-bold py-1 px-1 rounded"
				>
					🎥
				</Link>
				<Link
					href="/library?mediaType=tv&page=1"
					className="mr-2 mb-2 bg-yellow-300 hover:bg-yellow-200 text-white font-bold py-1 px-1 rounded"
				>
					📺
				</Link>

				{sameTitle.length > 0 && (
					<>
						<Link
							href="/library?status=sametitle&page=1"
							className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded"
						>
							👀 Same title
						</Link>

						<button
							className="mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded"
							onClick={dedupeBySize}
						>
							🧹 Size
						</button>

						<button
							className="mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded"
							onClick={dedupeByRecency}
						>
							🧹 Date
						</button>

						<button
							className={`mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded`}
							onClick={combineSameHash}
						>
							🧬 Same hash
						</button>
					</>
				)}

				{slowCount > 0 && (
					<Link
						href="/library?status=slow&page=1"
						className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded"
					>
						👀 No seeds
					</Link>
				)}

				{inProgressCount > 0 && (
					<Link
						href="/library?status=inprogress&page=1"
						className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded"
					>
						👀 In progress
					</Link>
				)}

				{failedCount > 0 && (
					<Link
						href="/library?status=failed&page=1"
						className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded"
					>
						👀 Failed
					</Link>
				)}

				<button
					className={`mr-2 mb-2 bg-red-600 hover:bg-red-500 text-white font-bold py-1 px-1 rounded`}
					onClick={handleDeleteShownTorrents}
				>
					🗑️ Delete
				</button>

				{/* Add torrent */}
				{rdKey && (
					<button
						className={`mr-2 mb-2 bg-teal-700 hover:bg-teal-600 text-white font-bold py-1 px-1 rounded`}
						onClick={() => handleAddMagnet('rd')}
					>
						🧲 RD Add
					</button>
				)}
				{adKey && (
					<button
						className={`mr-2 mb-2 bg-teal-700 hover:bg-teal-600 text-white font-bold py-1 px-1 rounded`}
						onClick={() => handleAddMagnet('ad')}
					>
						🧲 AD Add
					</button>
				)}

				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded ${
						filteredList.length === 0 ? 'opacity-60 cursor-not-allowed' : ''
					}`}
					onClick={() => generateHashList(filteredList)}
					disabled={filteredList.length === 0}
				>
					🚀 Hash list
				</button>
				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded ${
						userTorrentsList.length === 0 ? 'opacity-60 cursor-not-allowed' : ''
					}`}
					onClick={localBackup}
					disabled={userTorrentsList.length === 0}
				>
					💾 Backup
				</button>
				{rdKey && (
					<button
						className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded`}
						onClick={() => wrapLocalRestoreFn('rd')}
					>
						🪛 RD Restore
					</button>
				)}
				{adKey && (
					<button
						className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded`}
						onClick={() => wrapLocalRestoreFn('ad')}
					>
						🪛 AD Restore
					</button>
				)}

				<button
					className="mr-2 mb-2 bg-yellow-300 hover:bg-yellow-200 text-black py-1 px-1 rounded"
					onClick={() => {
						setQuery('');
						router.push(`/library?page=1`);
					}}
				>
					Reset
				</button>
			</div>
			{/* End of Main Menu */}
			{helpText !== '' && <div className="bg-blue-900">💡 {helpText}</div>}
			<div className="overflow-x-auto">
				{rdLoading || adLoading || grouping || filtering ? (
					<div className="flex justify-center items-center mt-4">
						<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
					</div>
				) : (
					<table className="w-full table-auto">
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
									Status{' '}
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
								<th className="px-4 py-2">Actions</th>
							</tr>
						</thead>
						<tbody>
							{sortedData()
								.slice(
									(currentPage - 1) * ITEMS_PER_PAGE,
									(currentPage - 1) * ITEMS_PER_PAGE + ITEMS_PER_PAGE
								)
								.map((torrent, i) => {
									const groupCount = getGroupings(torrent.mediaType)[
										torrent.title
									];
									const filterText =
										groupCount > 1 && !router.query.filter
											? `${groupCount} of same title`
											: '';
									return (
										<tr
											key={i}
											className="border-t-2 hover:bg-purple-900"
											onClick={() =>
												rdKey && torrent.id.startsWith('rd:')
													? showInfo(rdKey, torrent)
													: null
											} // Add the onClick event here
											title="Click for more info"
										>
											<td className="border px-4 py-2 max-w-0 overflow-hidden">
												{torrent.id}
											</td>
											<td className="border px-4 py-2">
												{!['Invalid Magnet', 'Magnet'].includes(
													torrent.filename
												) && (
													<>
														<span className="cursor-pointer">
															{torrent.mediaType === 'tv'
																? '📺'
																: '🎥'}
														</span>
														&nbsp;<strong>{torrent.title}</strong>{' '}
														{filterText && (
															<Link
																href={`/library?filter=${encodeURIComponent(
																	torrent.title
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
																	torrent.info.title +
																	' ' +
																	(torrent.info.year || '')
																).trim() || torrent.title
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
												{torrent.filename}
											</td>

											<td className="border px-4 py-2">
												{(torrent.bytes / ONE_GIGABYTE).toFixed(1)} GB
											</td>
											{/* <td className="border px-4 py-2">
												{torrent.score.toFixed(1)}
											</td> */}
											<td className="border px-4 py-2">
												{torrent.progress !== 100 ? (
													<>
														<span className="inline-block align-middle">
															{torrent.progress}%&nbsp;
														</span>
														<span className="inline-block align-middle">
															<FaSeedling />
														</span>
														<span className="inline-block align-middle">
															{torrent.seeders}
														</span>
														<br />
														<span className="inline-block align-middle">
															{shortenNumber(torrent.speed)}B/s
														</span>
													</>
												) : (
													`${torrent.links.length} file${
														torrent.links.length === 1 ? '' : 's'
													}`
												)}
											</td>

											<td className="border px-4 py-2">
												{new Date(torrent.added).toLocaleString()}
											</td>
											<td className="border px-2 py-2">
												<button
													title="Share"
													className="cursor-pointer mr-2 mb-2 text-indigo-600"
													onClick={async (e) => {
														e.stopPropagation(); // Prevent showInfo when clicking this button
														router.push(await handleShare(torrent));
													}}
												>
													<FaShare />
												</button>
												<button
													title="Delete"
													className="cursor-pointer mr-2 mb-2 text-red-500"
													onClick={(e) => {
														e.stopPropagation(); // Prevent showInfo when clicking this button
														if (rdKey && torrent.id.startsWith('rd:')) {
															handleDeleteRdTorrent(
																rdKey,
																torrent.id,
																removeFromRdCache
															);
														}
														if (adKey && torrent.id.startsWith('ad:')) {
															handleDeleteAdTorrent(
																adKey,
																torrent.id,
																removeFromAdCache
															);
														}
														setUserTorrentsList((prevList) =>
															prevList.filter(
																(prevTor) =>
																	prevTor.id !== torrent.id
															)
														);
													}}
												>
													<FaTrash />
												</button>
												<button
													title="Reinsert"
													className="cursor-pointer mr-2 mb-2 text-green-500"
													onClick={(e) => {
														e.stopPropagation(); // Prevent showInfo when clicking this button
														if (rdKey && torrent.id.startsWith('rd'))
															handleReinsertTorrent(
																rdKey,
																torrent.id,
																userTorrentsList,
																removeFromRdCache
															);
														if (adKey && torrent.id.startsWith('ad'))
															handleRestartTorrent(adKey, torrent.id);
													}}
												>
													<FaRecycle />
												</button>
												<button
													title="Copy magnet url"
													className="cursor-pointer mr-2 mb-2 text-pink-500"
													onClick={(e) => {
														e.stopPropagation(); // Prevent showInfo when clicking this button
														handleCopyMagnet(torrent.hash);
													}}
												>
													<FaMagnet />
												</button>
												{/* Removed the glasses icon since the row is now clickable */}
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
