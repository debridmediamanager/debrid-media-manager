import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxApiKey } from '@/hooks/auth';
import { getTorrentInfo } from '@/services/realDebrid';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus, keyByStatus, uniqId } from '@/torrent/userTorrent';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInRd,
	handleAddMultipleHashesInAd,
	handleAddMultipleHashesInRd,
	handleAddMultipleHashesInTb,
	handleCopyMagnet,
	handleReinsertTorrentinRd,
	handleRestartTorrent,
	handleSelectFilesInRd,
	handleRestartTorBoxTorrent
} from '@/utils/addMagnet';
import { AsyncFunction, runConcurrentFunctions } from '@/utils/batch';
import { deleteFilteredTorrents } from '@/utils/deleteList';
import { handleDeleteAdTorrent, handleDeleteRdTorrent, handleDeleteTbTorrent } from '@/utils/deleteTorrent';
import { extractHashes } from '@/utils/extractHashes';
import { fetchAllDebrid, fetchRealDebrid, getRdStatus, fetchTorBox } from '@/utils/fetchTorrents';
import { generateHashList, handleShare } from '@/utils/hashList';
import { checkForUncachedInRd } from '@/utils/instantChecks';
import { localRestore } from '@/utils/localRestore';
import { applyQuickSearch } from '@/utils/quickSearch';
import { torrentPrefix } from '@/utils/results';
import { checkArithmeticSequenceInFilenames, isVideo } from '@/utils/selectable';
import { defaultPlayer } from '@/utils/settings';
import { showInfoForAD, showInfoForRD, showInfoForTB } from '@/utils/showInfo';
import { isFailed, isInProgress, isSlowOrNoLinks } from '@/utils/slow';
import { shortenNumber } from '@/utils/speed';
import { libraryToastOptions, magnetToastOptions, searchToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import { filenameParse } from '@ctrl/video-filename-parser';
import { saveAs } from 'file-saver';
import { every, some } from 'lodash';
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
	column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added';
	direction: 'asc' | 'desc';
}

const torrentDB = new UserTorrentDB();

function TorrentsPage() {
	const router = useRouter();
	const [query, setQuery] = useState('');
	const [currentPage, setCurrentPage] = useState(1);

	// loading states
	const [loading, setLoading] = useState(true);
	const [rdSyncing, setRdSyncing] = useState(true);
	const [adSyncing, setAdSyncing] = useState(true);
	const [tbSyncing, setTbSyncing] = useState(true);
	const [filtering, setFiltering] = useState(false);
	const [grouping, setGrouping] = useState(false);

	const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);
	const [filteredList, setFilteredList] = useState<UserTorrent[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'added', direction: 'desc' });
	const [helpText, setHelpText] = useState('');
	const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set());

	// keys
	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const tbKey = useTorBoxApiKey();

	const [defaultGrouping] = useState<Record<string, number>>({});
	const [movieGrouping] = useState<Record<string, number>>({});
	const [tvGroupingByEpisode] = useState<Record<string, number>>({});
	const [tvGroupingByTitle] = useState<Record<string, number>>({});
	const [sameTitleOrHash] = useState<Set<string>>(new Set());
	const [uncachedRdHashes, setUncachedRdHashes] = useState<Set<string>>(new Set());
	const [uncachedAdIDs, setUncachedAdIDs] = useState<string[]>([]);

	// filter counts
	const [slowCount, setSlowCount] = useState(0);
	const [inProgressCount, setInProgressCount] = useState(0);
	const [failedCount, setFailedCount] = useState(0);

	// stats
	const [totalBytes, setTotalBytes] = useState<number>(0);

	const relevantList = selectedTorrents.size
		? userTorrentsList.filter((t) => selectedTorrents.has(t.id))
		: filteredList;

	// add hash to library
	useEffect(() => {
		const { addMagnet } = router.query;
		if (!addMagnet) return;
		router.push(`/library?page=1`);
		const hashes = extractHashes(addMagnet as string);
		if (hashes.length !== 1) return;
		if (rdKey)
			handleAddMultipleHashesInRd(rdKey, hashes, async () => await fetchLatestRDTorrents(2));
		if (adKey)
			handleAddMultipleHashesInAd(adKey, hashes, async () => await fetchLatestADTorrents());
		if (tbKey)
			handleAddMultipleHashesInTb(tbKey, hashes, async () => await fetchLatestTBTorrents());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router]);

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

	const fetchLatestRDTorrents = async function (customLimit?: number) {
		const oldTorrents = await torrentDB.all();
		const oldIds = new Set(
			oldTorrents.map((torrent) => torrent.id).filter((id) => id.startsWith('rd:'))
		);
		const inProgressIds = new Set(
			oldTorrents
				.filter(isInProgress)
				.map((t) => t.id)
				.filter((id) => id.startsWith('rd:'))
		);
		const newIds = new Set();

		if (!rdKey) {
			setLoading(false);
			setRdSyncing(false);
		} else {
			await fetchRealDebrid(
				rdKey,
				async (torrents: UserTorrent[]) => {
					// add all new torrents to the database
					torrents.forEach((torrent) => newIds.add(torrent.id));
					const newTorrents = torrents.filter((torrent) => !oldIds.has(torrent.id));
					setUserTorrentsList((prev) => {
						return [...prev, ...newTorrents];
					});
					await torrentDB.addAll(newTorrents);

					// refresh the torrents that are in progress
					const inProgressTorrents = torrents.filter(
						(torrent) =>
							torrent.status === UserTorrentStatus.waiting ||
							torrent.status === UserTorrentStatus.downloading ||
							inProgressIds.has(torrent.id)
					);
					setUserTorrentsList((prev) => {
						for (const t of inProgressTorrents) {
							const idx = prev.findIndex((i) => i.id === t.id);
							if (idx >= 0) {
								const newList = [...prev];
								newList[idx] = t;
								return newList;
							}
						}
						return prev;
					});
					await torrentDB.addAll(inProgressTorrents);

					setLoading(false);
				},
				customLimit
			);
			setRdSyncing(false);

			// this is just a small sync
			if (customLimit) return;

			toast.success(
				`Updated ${newIds.size} torrents in your Real-Debrid library`,
				libraryToastOptions
			);
		}

		const toDelete = Array.from(oldIds).filter((id) => !newIds.has(id));
		await Promise.all(
			toDelete.map(async (id) => {
				setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== id));
				await torrentDB.deleteById(id);
				setSelectedTorrents((prev) => {
					prev.delete(id);
					return new Set(prev);
				});
			})
		);
	};

	const fetchLatestADTorrents = async function () {
		const oldTorrents = await torrentDB.all();
		const oldIds = new Set(
			oldTorrents.map((torrent) => torrent.id).filter((id) => id.startsWith('ad:'))
		);
		const inProgressIds = new Set(
			oldTorrents
				.filter(isInProgress)
				.map((t) => t.id)
				.filter((id) => id.startsWith('ad:'))
		);
		const newIds = new Set();

		if (!adKey) {
			setLoading(false);
			setAdSyncing(false);
		} else {
			await fetchAllDebrid(adKey, async (torrents: UserTorrent[]) => {
				// add all new torrents to the database
				torrents.forEach((torrent) => newIds.add(torrent.id));
				const newTorrents = torrents.filter((torrent) => !oldIds.has(torrent.id));
				setUserTorrentsList((prev) => {
					return [...prev, ...newTorrents];
				});
				await torrentDB.addAll(newTorrents);

				// refresh the torrents that are in progress
				const inProgressTorrents = torrents.filter(
					(torrent) =>
						torrent.status === UserTorrentStatus.waiting ||
						torrent.status === UserTorrentStatus.downloading ||
						inProgressIds.has(torrent.id)
				);
				setUserTorrentsList((prev) => {
					return prev.map((t) => {
						const found = inProgressTorrents.find((i) => i.id === t.id);
						if (found) {
							return found;
						}
						return t;
					});
				});
				await torrentDB.addAll(inProgressTorrents);

				setLoading(false);
			});
			setAdSyncing(false);
			toast.success(
				`Updated ${newIds.size} torrents in your AllDebrid library`,
				libraryToastOptions
			);
		}

		const toDelete = Array.from(oldIds).filter((id) => !newIds.has(id));
		await Promise.all(
			toDelete.map(async (id) => {
				setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== id));
				await torrentDB.deleteById(id);
				setSelectedTorrents((prev) => {
					prev.delete(id);
					return new Set(prev);
				});
			})
		);
	};

	const fetchLatestTBTorrents = async function () {
		const oldTorrents = await torrentDB.all();
		const oldIds = new Set(
			oldTorrents.map((torrent) => torrent.id).filter((id) => id.startsWith('tb:'))
		);
		const inProgressIds = new Set(
			oldTorrents
				.filter(isInProgress)
				.map((t) => t.id)
				.filter((id) => id.startsWith('tb:'))
		);
		const newIds = new Set();

		if (!tbKey) {
			setLoading(false);
			setTbSyncing(false);
		} else {
			await fetchTorBox(tbKey, async (torrents: UserTorrent[]) => {
				// add all new torrents to the database
				torrents.forEach((torrent) => newIds.add(torrent.id));
				const newTorrents = torrents.filter((torrent) => !oldIds.has(torrent.id));
				setUserTorrentsList((prev) => {
					return [...prev, ...newTorrents];
				});
				await torrentDB.addAll(newTorrents);

				// refresh the torrents that are in progress
				const inProgressTorrents = torrents.filter(
					(torrent) =>
						torrent.download_state === "downloading" ||
						torrent.download_state === "stalled (no seeds)" ||
						torrent.download_state === "checkingResumeData" ||
						torrent.download_state === "metaDL" ||
						torrent.download_state === "paused" ||
						inProgressIds.has(torrent.id)
				);
				setUserTorrentsList((prev) => {
					return prev.map((t) => {
						const found = inProgressTorrents.find((i) => i.id === t.id);
						if (found) {
							return found;
						}
						return t;
					});
				});
				await torrentDB.addAll(inProgressTorrents);

				setLoading(false);
			});
			setTbSyncing(false);
			toast.success(
				`Updated ${newIds.size} torrents in your TorBox library`,
				libraryToastOptions
			);
		}

		const toDelete = Array.from(oldIds).filter((id) => !newIds.has(id));
		await Promise.all(
			toDelete.map(async (id) => {
				setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== id));
				await torrentDB.deleteById(id);
				setSelectedTorrents((prev) => {
					prev.delete(id);
					return new Set(prev);
				});
			})
		);
	};

	// fetch list from api
	async function initialize() {
		await torrentDB.initializeDB();
		let torrents = await torrentDB.all();
		if (torrents.length) {
			// set userTorrentsList based on unique ids
			setUserTorrentsList((prev) => {
				const deleted = prev.filter((p) => !torrents.some((t) => t.id === p.id));
				prev = prev.filter((p) => !deleted.some((d) => d.id === p.id));
				const newTorrents = torrents.filter((t) => !prev.some((p) => p.id === t.id));
				return [...prev, ...newTorrents];
			});
			setLoading(false);
		}
		await Promise.all([fetchLatestRDTorrents(), fetchLatestADTorrents(), fetchLatestTBTorrents()]);
		await selectPlayableFiles(userTorrentsList);
	}
	useEffect(() => {
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey, adKey, tbKey]);

	// aggregate metadata
	useEffect(() => {
		if (loading) return;
		setGrouping(true);
		setTotalBytes(0);
		sameTitleOrHash.clear();

		let tmpTotalBytes = 0;
		clearGroupings(defaultGrouping);
		clearGroupings(movieGrouping);
		clearGroupings(tvGroupingByEpisode);
		const keyMap: Map<string, number> = new Map();

		for (const t of userTorrentsList) {
			if (t.status === UserTorrentStatus.error) continue;
			else if (t.serviceStatus === 'magnet_conversion') continue;

			const key = uniqId(t);
			if (!keyMap.has(key)) {
				keyMap.set(key, t.bytes);
				tmpTotalBytes += t.bytes;
			} else {
				sameTitleOrHash.add(t.title);
				const prevBytes = keyMap.get(key) || 0;
				if (prevBytes < t.bytes) {
					tmpTotalBytes -= prevBytes;
					tmpTotalBytes += t.bytes;
					keyMap.set(key, t.bytes);
				}
			}
			if (t.title in getGroupings(t.mediaType)) {
				if (getGroupings(t.mediaType)[t.title] === 1) sameTitleOrHash.add(t.title);
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
		loading,
		defaultGrouping,
		movieGrouping,
		tvGroupingByEpisode,
		tvGroupingByTitle,
	]);

	useEffect(() => {
		if (!rdKey || rdSyncing) return;
		const hashes = new Set(
			userTorrentsList
				.filter((r) => r.id.startsWith('rd:') && r.status === UserTorrentStatus.finished)
				.map((r) => r.hash)
		);
		const hashesArr = Array.from(hashes);
		hashesArr.sort();
		checkForUncachedInRd(rdKey, userTorrentsList, setUncachedRdHashes, torrentDB)
			.then((nonVideoHashes) => {
				setUserTorrentsList((prev) => {
					return prev.map((t) => {
						if (t.id.startsWith('rd:') && nonVideoHashes.has(t.hash)) {
							t.mediaType = 'other';
							t.info = undefined;
							t.title = t.filename;
						}
						return t;
					});
				});
				return userTorrentsList.filter((t) => nonVideoHashes.has(t.hash));
			})
			.then((nonVideoTorrents) => {
				return Promise.all(nonVideoTorrents.map((t) => torrentDB.add(t)));
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey, rdSyncing]);

	useEffect(() => {
		if (!adKey || adSyncing) return;
		const uncachedIDs = userTorrentsList
			.filter((r) => r.id.startsWith('ad:') && r.serviceStatus === '11')
			.map((r) => r.id);
		setUncachedAdIDs(uncachedIDs);
		uncachedIDs.length &&
			toast.success(
				`Found ${uncachedIDs.length} uncached torrents in AllDebrid`,
				searchToastOptions
			);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [adKey, adSyncing]);

	// set the list you see
	const tips = [
		'Tip: You can use hash lists to share your library with others anonymously. Click on the button, wait for the page to finish processing, and share the link to your friends.',
		'Tip: You can make a local backup of your library by using the "Local backup" button. This will generate a file containing your whole library that you can use to restore your library later.',
		'Tip: You can restore a local backup by using the "Local restore" button. It will only restore the torrents that are not already in your library.',
		'Tip: The quick search box will filter the list by filename and id. You can use multiple words or even regex to filter your library. This way, you can select multiple torrents and delete them at once, or share them as a hash list.',
		'Have you tried clicking on a torrent? You can see the links, the progress, and the status of the torrent. You can also select the files you want to download.',
		'TorBox seeds back! Make sure you do too!',
		'I don\'t know what to put here, so here\'s a random tip: "The average person walks the equivalent of five times around the world in a lifetime."',
	];
	function setHelpTextBasedOnTime() {
		const date = new Date();
		const minute = date.getMinutes();
		const index = minute % tips.length;
		const randomTip = tips[index];
		if (helpText !== 'hide') setHelpText(randomTip);
	}

	// filter the list
	useEffect(() => {
		if (loading || grouping) return;
		setFiltering(true);
		setSlowCount(userTorrentsList.filter(isSlowOrNoLinks).length);
		setInProgressCount(userTorrentsList.filter(isInProgress).length);
		setFailedCount(userTorrentsList.filter(isFailed).length);
		if (hasNoQueryParamsBut('page')) {
			setFilteredList(applyQuickSearch(query, userTorrentsList));
			// deleteFailedTorrents(userTorrentsList); // disabled because this is BAD!
			setFiltering(false);
			setHelpTextBasedOnTime();
			return;
		}
		const { filter: titleFilter, mediaType, status } = router.query;
		let tmpList = userTorrentsList;
		if (status === 'slow') {
			tmpList = tmpList.filter(isSlowOrNoLinks);
			setFilteredList(applyQuickSearch(query, tmpList));
			if (helpText !== 'hide')
				setHelpText(
					'The displayed torrents either do not contain any links or are older than one hour and lack any seeders. You can use the "Delete shown" option to remove them.'
				);
		}
		if (status === 'sametitleorhash') {
			tmpList = tmpList.filter((t) => sameTitleOrHash.has(t.title));
			setFilteredList(applyQuickSearch(query, tmpList));
			if (helpText !== 'hide')
				setHelpText(
					'Torrents shown have the same title parsed from the torrent name. Use "By size" to retain the larger torrent for each title, or "By date" to retain the more recent torrent. Take note: the parser might not work well for multi-season tv show torrents.'
				);
		}
		if (status === 'inprogress') {
			tmpList = tmpList.filter(isInProgress);
			setFilteredList(applyQuickSearch(query, tmpList));
			if (helpText !== 'hide') setHelpText('Torrents that are still downloading');
		}
		if (status === 'failed') {
			tmpList = tmpList.filter(isFailed);
			setFilteredList(applyQuickSearch(query, tmpList));
			if (helpText !== 'hide') setHelpText('Torrents that have a failure status');
		}
		if (status === 'uncached') {
			tmpList = tmpList.filter(
				(t) =>
					(t.status === UserTorrentStatus.finished &&
						t.id.startsWith('rd:') &&
						uncachedRdHashes.has(t.hash)) ||
					(t.id.startsWith('ad:') && uncachedAdIDs.includes(t.id))
			);
			setFilteredList(applyQuickSearch(query, tmpList));
			if (helpText !== 'hide') setHelpText('Torrents that are no longer cached');
		}
		if (status === 'selected') {
			tmpList = tmpList.filter((t) => selectedTorrents.has(t.id));
			setFilteredList(applyQuickSearch(query, tmpList));
			if (helpText !== 'hide') setHelpText('Torrents that you have selected');
		}
		if (titleFilter) {
			const decodedTitleFilter = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => decodedTitleFilter === t.title);
			setFilteredList(applyQuickSearch(query, tmpList));
			if (helpText !== 'hide') setHelpText(`Torrents shown have the title "${titleFilter}".`);
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => mediaType === t.mediaType);
			setFilteredList(applyQuickSearch(query, tmpList));
			if (helpText !== 'hide')
				setHelpText(
					`Torrents shown are detected as ${['movies', 'TV shows', 'non-movie/TV content'][['movie', 'tv', 'other'].indexOf(mediaType as string)]}.`
				);
		}
		setFiltering(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query, userTorrentsList, loading, grouping, query, currentPage, uncachedRdHashes]);

	function handleSort(column: typeof sortBy.column) {
		setSortBy({
			column,
			direction: sortBy.column === column && sortBy.direction === 'asc' ? 'desc' : 'asc',
		});
	}

	function sortedData() {
		return filteredList.sort((a, b) => {
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
	}

	function currentPageData() {
		return sortedData().slice(
			(currentPage - 1) * ITEMS_PER_PAGE,
			(currentPage - 1) * ITEMS_PER_PAGE + ITEMS_PER_PAGE
		);
	}

	const getGroupings = (mediaType: UserTorrent['mediaType']) => {
		switch (mediaType) {
			case 'movie':
				return movieGrouping;
			case 'tv':
				return tvGroupingByEpisode;
			default:
				return defaultGrouping;
		}
	};

	function clearGroupings(frequencyMap: { [x: string]: number }) {
		for (let key in frequencyMap) {
			delete frequencyMap[key];
		}
	}

	function wrapSelectFilesFn(t: UserTorrent) {
		return async () => {
			await handleSelectFilesInRd(rdKey!, t.id);
			t.status = UserTorrentStatus.downloading;
			torrentDB.add(t);
		};
	}

	async function selectPlayableFiles(torrents: UserTorrent[]) {
		const waitingForSelection = torrents
			.filter((t) => t.serviceStatus === 'waiting_files_selection')
			.map(wrapSelectFilesFn);
		const [results, errors] = await runConcurrentFunctions(waitingForSelection, 5, 500);
		if (errors.length) {
			toast.error(`Error selecting files on ${errors.length} torrents`, libraryToastOptions);
		}
		if (results.length) {
			toast.success(`Started downloading ${results.length} torrents`, libraryToastOptions);
		}
	}

	async function handleReinsertTorrents() {
		if (
			relevantList.length > 0 &&
			!(
				await Swal.fire({
					title: 'Reinsert shown',
					text: `This will reinsert the ${relevantList.length} torrents filtered. Are you sure?`,
					icon: 'warning',
					showCancelButton: true,
					confirmButtonColor: '#3085d6',
					cancelButtonColor: '#d33',
					confirmButtonText: 'Yes, reinsert!',
				})
			).isConfirmed
		)
			return;
		const toReinsert = relevantList.map(wrapReinsertFn);
		const [results, errors] = await runConcurrentFunctions(toReinsert, 5, 500);
		if (errors.length) {
			toast.error(`Error reinserting ${errors.length} torrents`, magnetToastOptions);
		}
		if (results.length) {
			resetSelection();
			await fetchLatestRDTorrents(Math.ceil(relevantList.length * 1.1));
			await fetchLatestADTorrents();
			await fetchLatestTBTorrents();
			toast.success(`Reinserted ${results.length} torrents`, magnetToastOptions);
		}
		if (!errors.length && !results.length) {
			toast('No torrents to reinsert', magnetToastOptions);
		}
	}

	async function handleDeleteShownTorrents() {
		if (
			relevantList.length > 0 &&
			!(
				await Swal.fire({
					title: 'Delete shown',
					text: `This will delete the ${relevantList.length} torrents filtered. Are you sure?`,
					icon: 'warning',
					showCancelButton: true,
					confirmButtonColor: '#3085d6',
					cancelButtonColor: '#d33',
					confirmButtonText: 'Yes, delete!',
				})
			).isConfirmed
		)
			return;
		await deleteFilteredTorrents(relevantList, wrapDeleteFn);
		resetSelection();
	}

	function wrapDeleteFn(t: UserTorrent) {
		return async () => {
			const oldId = t.id;
			if (rdKey && t.id.startsWith('rd:')) {
				await handleDeleteRdTorrent(rdKey, t.id);
			}
			if (adKey && t.id.startsWith('ad:')) {
				await handleDeleteAdTorrent(adKey, t.id);
			}
			setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== oldId));
			await torrentDB.deleteById(oldId);
			setSelectedTorrents((prev) => {
				prev.delete(oldId);
				return new Set(prev);
			});
		};
	}

	function wrapReinsertFn(t: UserTorrent) {
		return async () => {
			try {
				const oldId = t.id;
				if (rdKey && t.id.startsWith('rd:')) {
					await handleReinsertTorrentinRd(rdKey, t);
					setUserTorrentsList((prev) => prev.filter((torrent) => torrent.id !== oldId));
					await torrentDB.deleteById(oldId);
					setSelectedTorrents((prev) => {
						prev.delete(oldId);
						return new Set(prev);
					});
				}
				if (adKey && t.id.startsWith('ad:')) {
					await handleRestartTorrent(adKey, t.id);
				}
			} catch (error) {
				throw error;
			}
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
		const getKey = keyByStatus(router.query.status as string);
		const dupes: UserTorrent[] = [];
		filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
			let key = getKey(cur);
			if (acc[key]) {
				// Check if current is bigger or smaller based on the user's choice
				const isPreferred = deleteBigger
					? acc[key].bytes > cur.bytes
					: acc[key].bytes < cur.bytes;
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
		if (router.query.status === 'sametitleorhash') resetFilters();
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
		const getKey = keyByStatus(router.query.status as string);
		const dupes: UserTorrent[] = [];
		filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
			let key = getKey(cur);
			if (acc[key]) {
				// Check if current is newer based on the user's choice
				const isPreferred = deleteOlder
					? acc[key].added < cur.added
					: acc[key].added > cur.added;
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
		if (router.query.status === 'sametitleorhash') resetFilters();
	}

	async function combineSameHash() {
		const dupeHashes: Map<string, UserTorrent[]> = new Map();
		filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
			if (cur.status !== UserTorrentStatus.finished) return acc;
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
					icon: 'question',
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
				toReinsertAndDelete.push(
					wrapReinsertFn(reinsert),
					...sameHashTorrents.map(wrapDeleteFn)
				);
			}
		});
		const [results, errors] = await runConcurrentFunctions(toReinsertAndDelete, 5, 500);
		if (errors.length) {
			toast.error(`Error with merging ${errors.length} torrents`, libraryToastOptions);
		}
		if (results.length) {
			await fetchLatestRDTorrents(Math.ceil(results.length * 1.1));
			await fetchLatestADTorrents();
			await fetchLatestTBTorrents();
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
			const allHashes = new Set(userTorrentsList.map((t) => t.hash));
			const addMagnet = (hash: string) => {
				if (rdKey && debridService === 'rd') return handleAddAsMagnetInRd(rdKey, hash);
				if (adKey && debridService === 'ad') return handleAddAsMagnetInAd(adKey, hash);
			};

			function wrapAddMagnetFn(hash: string) {
				return async () => await addMagnet(hash);
			}

			const processingPromise = new Promise<{ success: number; error: number }>(
				async (resolve) => {
					toast.loading(`DO NOT REFRESH THE PAGE`, libraryToastOptions);
					const notAddingCount = files.filter((f) => allHashes.has(f.hash)).length;
					if (notAddingCount > 0)
						toast.error(
							`${notAddingCount} torrents are already in your library`,
							libraryToastOptions
						);
					const toAdd = files
						.map((f) => f.hash)
						.filter((h) => !allHashes.has(h))
						.map(wrapAddMagnetFn);
					const concurrencyCount = 5;
					const refreshTorrents = async (_: number) => {
						await new Promise((r) => setTimeout(r, 500));
					};
					const [results, errors] = await runConcurrentFunctions(
						toAdd,
						concurrencyCount,
						refreshTorrents
					);
					if (results.length) {
						await fetchLatestRDTorrents(Math.ceil(results.length * 1.1));
						await fetchLatestADTorrents();
						await fetchLatestTBTorrents();
					}
					resolve({ success: results.length, error: errors.length });
				}
			);

			toast.promise(
				processingPromise,
				{
					loading: `Restoring ${files.length} downloads in your library.`,
					success: ({ success, error }) => {
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
		const { value: hashesStr } = await Swal.fire({
			title: `Add magnet to your ${debridService.toUpperCase()} library`,
			input: 'textarea',
			inputLabel: 'Paste your Magnet link(s) here',
			inputValue: '',
			showCancelButton: true,
			inputValidator: (value) => !value && 'You need to put something!',
		});
		if (!hashesStr) return;
		const hashes = extractHashes(hashesStr);
		if (rdKey && hashes && debridService === 'rd') {
			handleAddMultipleHashesInRd(
				rdKey,
				hashes,
				async () => await fetchLatestRDTorrents(Math.ceil(hashes.length * 1.1))
			);
		}
		if (adKey && hashes && debridService === 'ad') {
			handleAddMultipleHashesInAd(adKey, hashes, async () => await fetchLatestADTorrents());
		}
		if (tbKey && hashes && debridService === "tb") {
			handleAddMultipleHashesInTb(tbKey, hashes, async () => fetchLatestTBTorrents());
		}
	}

	const hasNoQueryParamsBut = (...params: string[]) =>
		Object.keys(router.query).filter((p) => !params.includes(p)).length === 0;

	const resetFilters = () => {
		setQuery('');
		setSortBy({ column: 'added', direction: 'desc' });
		router.push(`/library?page=1`);
	};

	const selectShown = () => {
		setSelectedTorrents((prev) => {
			currentPageData().forEach((t) => prev.add(t.id));
			return new Set(prev);
		});
	};

	const resetSelection = () => {
		setSelectedTorrents(new Set());
	};

	const handleSelectTorrent = async (id: string) => {
		if (selectedTorrents.has(id)) {
			setSelectedTorrents((prev) => {
				prev.delete(id);
				return new Set(prev);
			});
		} else {
			setSelectedTorrents((prev) => {
				prev.add(id);
				return new Set(prev);
			});
		}
	};

	const handleChangeType = async (t: UserTorrent) => {
		t.mediaType = t.mediaType === 'movie' ? 'tv' : t.mediaType === 'tv' ? 'other' : 'movie';
		setUserTorrentsList((prev) => {
			const idx = prev.findIndex((i) => i.id === t.id);
			if (idx >= 0) {
				// Create a copy of the array and modify the copy
				const newList = [...prev];
				newList[idx].mediaType = t.mediaType;
				return newList;
			}
			return prev;
		});
		await torrentDB.add(t);
	};

	const handleShowInfoForRD = async (t: UserTorrent) => {
		const info = await getTorrentInfo(rdKey!, t.id.substring(3));
		if (t.status === UserTorrentStatus.waiting || t.status === UserTorrentStatus.downloading) {
			setUserTorrentsList((prev) => {
				const idx = prev.findIndex((i) => i.id === t.id);
				if (idx >= 0) {
					const newList = [...prev];
					newList[idx].progress = info.progress;
					newList[idx].seeders = info.seeders;
					newList[idx].speed = info.speed;
					newList[idx].status = getRdStatus(info);
					newList[idx].serviceStatus = info.status;
					newList[idx].links = info.links;
					const selectedFiles = info.files.filter((f) => f.selected);
					newList[idx].selectedFiles = selectedFiles.map((f, idx) => ({
						fileId: f.id,
						filename: f.path,
						filesize: f.bytes,
						link: selectedFiles.length === info.links.length ? info.links[idx] : '',
					}));
					return newList;
				}
				return prev;
			});
			await torrentDB.add(t);
		}

		const filenames = info.files.map((f) => f.path);
		const torrentAndFiles = [t.filename, ...filenames];
		const hasEpisodes = checkArithmeticSequenceInFilenames(filenames);

		if (
			t.mediaType !== 'other' &&
			(every(torrentAndFiles, (f) => !isVideo({ path: f })) ||
				(info.progress === 100 &&
					info.files.filter((f) => f.selected).length !== info.links.length &&
					info.links.length === 1))
		) {
			setUserTorrentsList((prev) => {
				const idx = prev.findIndex((i) => i.id === t.id);
				if (idx >= 0) {
					const newList = [...prev];
					newList[idx].mediaType = 'other';
					newList[idx].title = newList[idx].filename;
					newList[idx].info = undefined;
					return newList;
				}
				return prev;
			});
			await torrentDB.add(t);
		} else if (
			t.mediaType === 'movie' &&
			(hasEpisodes ||
				some(torrentAndFiles, (f) => /s\d\d\d?.?e\d\d\d?/i.test(f)) ||
				some(torrentAndFiles, (f) => /season.?\d+/i.test(f)) ||
				some(torrentAndFiles, (f) => /episodes?\s?\d+/i.test(f)) ||
				some(torrentAndFiles, (f) => /\b[a-fA-F0-9]{8}\b/.test(f)))
		) {
			setUserTorrentsList((prev) => {
				const idx = prev.findIndex((i) => i.id === t.id);
				if (idx >= 0) {
					const newList = [...prev];
					newList[idx].mediaType = 'tv';
					newList[idx].info = filenameParse(t.filename, true);
					return newList;
				}
				return prev;
			});
			await torrentDB.add(t);
		} else if (
			t.mediaType === 'tv' &&
			!hasEpisodes &&
			every(torrentAndFiles, (f) => !/s\d\d\d?.?e\d\d\d?/i.test(f)) &&
			every(torrentAndFiles, (f) => !/season.?\d+/i.test(f)) &&
			every(torrentAndFiles, (f) => !/episodes?\s?\d+/i.test(f)) &&
			every(torrentAndFiles, (f) => !/\b[a-fA-F0-9]{8}\b/.test(f))
		) {
			setUserTorrentsList((prev) => {
				const idx = prev.findIndex((i) => i.id === t.id);
				if (idx >= 0) {
					const newList = [...prev];
					newList[idx].mediaType = 'movie';
					newList[idx].info = filenameParse(t.filename);
					return newList;
				}
				return prev;
			});
			await torrentDB.add(t);
		}

		showInfoForRD(
			window.localStorage.getItem('settings:player') || defaultPlayer,
			rdKey!,
			info
		);
	};

	const handleShowInfoForAD = async (t: UserTorrent) => {
		let player = window.localStorage.getItem('settings:player') || defaultPlayer;
		if (player === 'realdebrid') {
			alert('No player selected');
		}
		showInfoForAD(
			window.localStorage.getItem('settings:player') || defaultPlayer,
			rdKey!,
			t.adData!
		);
	};

	const handleShowInfoForTB = async (t: UserTorrent) => {
		let player = window.localStorage.getItem('settings:player') || defaultPlayer;
		if (player === 'realdebrid') {
			alert('No player selected');
		}
		showInfoForTB(
			window.localStorage.getItem('settings:player') || defaultPlayer,
			tbKey!,
			t.tbData!
		)
	}

	return (
		<div className="mx-2 my-1">
			<Head>
				<title>Debrid Media Manager - Library</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex justify-between items-center mb-2">
				<h1 className="text-xl font-bold">
					Library 📚{' '}
					<span className="text-sm whitespace-nowrap">
						{userTorrentsList.length} torrents{' '}
						{rdSyncing || adSyncing
							? '💭' // Thinking if syncing
							: totalBytes / ONE_GIGABYTE / 1024 > 10000
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
					</span>
					<span className="text-sm whitespace-nowrap">
						{(totalBytes / ONE_GIGABYTE / 1024).toFixed(1)} TB
					</span>
				</h1>

				<Link
					href="/"
					className="text-sm bg-cyan-800 hover:bg-cyan-700 text-white py-1 px-2 rounded whitespace-nowrap"
				>
					Go Home
				</Link>
			</div>
			<div className="flex items-center border-b-2 border-gray-500 py-0 mb-4">
				<input
					className="appearance-none bg-transparent border-none w-full text-xs text-white mr-3 py-1 px-2 leading-tight focus:outline-none"
					type="text"
					id="query"
					placeholder="search by filename/hash/id, supports regex"
					value={query}
					onChange={(e) => {
						setCurrentPage(1);
						setQuery(e.target.value.toLocaleLowerCase());
					}}
				/>
			</div>
			{/* Start of Main Menu */}
			<div className="mb-0 flex overflow-x-auto">
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
					className={`ml-1 mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded text-xs ${
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
					className="mr-2 mb-2 bg-yellow-300 hover:bg-yellow-200 text-black py-1 px-1 rounded text-xs"
				>
					🎥 Movies
				</Link>
				<Link
					href="/library?mediaType=tv&page=1"
					className="mr-2 mb-2 bg-yellow-300 hover:bg-yellow-200 text-black py-1 px-1 rounded text-xs"
				>
					📺 TV&nbsp;shows
				</Link>
				<Link
					href="/library?mediaType=other&page=1"
					className="mr-2 mb-2 bg-yellow-300 hover:bg-yellow-200 text-black py-1 px-1 rounded text-xs"
				>
					🗂️ Others
				</Link>
				<button
					className="mr-2 mb-2 bg-yellow-300 hover:bg-yellow-200 text-black py-1 px-1 rounded text-xs"
					onClick={() => resetFilters()}
				>
					Reset
				</button>

				{selectedTorrents.size > 0 && (
					<Link
						href="/library?status=selected&page=1"
						className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded text-xs"
					>
						👀 Selected ({selectedTorrents.size})
					</Link>
				)}
				{uncachedAdIDs.length + uncachedRdHashes.size > 0 && (
					<Link
						href="/library?status=uncached&page=1"
						className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded text-xs"
					>
						👀 Uncached
					</Link>
				)}
				{sameTitleOrHash.size > 0 && (
					<Link
						href="/library?status=sametitleorhash&page=1"
						className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded text-xs"
					>
						👀 Same&nbsp;title
					</Link>
				)}

				{inProgressCount > 0 && (
					<Link
						href="/library?status=inprogress&page=1"
						className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded text-xs"
					>
						👀 In&nbsp;progress
					</Link>
				)}
				{slowCount > 0 && (
					<Link
						href="/library?status=slow&page=1"
						className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded text-xs"
					>
						👀 No&nbsp;seeds
					</Link>
				)}
				{failedCount > 0 && (
					<Link
						href="/library?status=failed&page=1"
						className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded text-xs"
					>
						👀 Failed
					</Link>
				)}
			</div>
			{/* 2nd row menu */}
			<div className="mb-4 flex overflow-x-auto">
				<button
					className="mr-2 mb-2 bg-orange-200 hover:bg-orange-400 text-black py-1 px-1 rounded text-[0.6rem]"
					onClick={() => selectShown()}
				>
					✅ Select Shown
				</button>

				<button
					className="mr-2 mb-2 bg-orange-200 hover:bg-orange-400 text-black py-1 px-1 rounded text-[0.6rem]"
					onClick={() => resetSelection()}
				>
					❌ Unselect All
				</button>
				<button
					className={`mr-2 mb-2 bg-green-600 hover:bg-green-500 text-white font-bold py-1 px-1 rounded text-[0.6rem]`}
					onClick={handleReinsertTorrents}
				>
					🔄 Reinsert{selectedTorrents.size ? ` (${selectedTorrents.size})` : ' List'}
				</button>
				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded text-[0.6rem]`}
					onClick={() => generateHashList(relevantList)}
				>
					🚀 Share{selectedTorrents.size ? ` (${selectedTorrents.size})` : ' List'}
				</button>
				<button
					className={`mr-2 mb-2 bg-red-600 hover:bg-red-500 text-white font-bold py-1 px-1 rounded text-[0.6rem]`}
					onClick={handleDeleteShownTorrents}
				>
					🗑️ Delete{selectedTorrents.size ? ` (${selectedTorrents.size})` : ' List'}
				</button>

				{rdKey && (
					<>
						<button
							className={`mr-2 mb-2 bg-teal-700 hover:bg-teal-600 text-white font-bold py-1 px-1 rounded text-[0.6rem]`}
							onClick={() => handleAddMagnet('rd')}
						>
							🧲 RD&nbsp;Add
						</button>
						<button
							className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded text-[0.6rem]`}
							onClick={() => wrapLocalRestoreFn('rd')}
						>
							🪛 RD Restore
						</button>
					</>
				)}
				{adKey && (
					<>
						<button
							className={`mr-2 mb-2 bg-teal-700 hover:bg-teal-600 text-white font-bold py-1 px-1 rounded text-[0.6rem]`}
							onClick={() => handleAddMagnet('ad')}
						>
							🧲 AD&nbsp;Add
						</button>
						<button
							className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded text-[0.6rem]`}
							onClick={() => wrapLocalRestoreFn('ad')}
						>
							🪛 AD Restore
						</button>
					</>
				)}

				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded text-[0.6rem]`}
					onClick={localBackup}
				>
					💾 Backup
				</button>

				{(router.query.status === 'sametitleorhash' ||
					(router.query.filter && filteredList.length > 1)) && (
					<>
						<button
							className="mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded text-[0.6rem]"
							onClick={dedupeBySize}
						>
							Size 🧹
						</button>

						<button
							className="mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded text-[0.6rem]"
							onClick={dedupeByRecency}
						>
							Date 🧹
						</button>

						<button
							className={`mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded text-[0.6rem]`}
							onClick={combineSameHash}
						>
							Hash 🧹
						</button>
					</>
				)}
			</div>
			{/* End of Main Menu */}
			{helpText && helpText !== 'hide' && (
				<div className="bg-blue-900 text-xs p-2 my-1 rounded" onClick={() => setHelpText('hide')}>
					💡 {helpText}
				</div>
			)}
			<div className="overflow-x-auto">
				{loading || grouping || filtering ? (
					<div className="flex justify-center items-center mt-4">
						<div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
					</div>
				) : (
					<table className="w-full table-fixed">
						<thead>
							<tr className="whitespace-nowrap text-xs">
								<th
									className="min-w-8 max-w-8 w-8 px-1 py-0 cursor-pointer"
									onClick={() => handleSort('id')}
								>
									Select
									{selectedTorrents.size
										? ` (${selectedTorrents.size})`
										: ''}{' '}
									{sortBy.column === 'id' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th
									className="min-w-96 w-[500px] max-w-[500px] px-1 py-0 cursor-pointer"
									onClick={() => handleSort('title')}
								>
									Title ({filteredList.length}){' '}
									{sortBy.column === 'title' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th
									className="min-w-20 max-w-20 w-20 px-1 py-0 cursor-pointer"
									onClick={() => handleSort('bytes')}
								>
									Size{' '}
									{sortBy.column === 'bytes' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th
									className="min-w-20 max-w-20 w-20 px-1 py-0 cursor-pointer"
									onClick={() => handleSort('progress')}
								>
									Status{' '}
									{sortBy.column === 'progress' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th
									className="min-w-24 max-w-28 w-24 px-1 py-0 cursor-pointer"
									onClick={() => handleSort('added')}
								>
									Added{' '}
									{sortBy.column === 'added' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th>
								<th className="min-w-24 max-w-28 w-24 px-1 py-0">Actions</th>
							</tr>
						</thead>
						<tbody>
							{currentPageData().map((torrent) => {
								const groupCount = getGroupings(torrent.mediaType)[torrent.title];
								const filterText =
									groupCount > 1 && !router.query.filter
										? `${groupCount} of same title`
										: '';
								return (
									<tr
										key={torrent.id}
										className={`align-middle lg:hover:bg-purple-900 ${
											selectedTorrents.has(torrent.id) ? `bg-green-800` : ``
										}`}
									>
										<td
											onClick={() => handleSelectTorrent(torrent.id)}
											className="px-1 py-1 text-sm truncate text-center"
										>
											{selectedTorrents.has(torrent.id) ? `✅` : `➕`}
										</td>
										<td
											onClick={() => {
												if (torrent.id.startsWith("rd:")) {
													handleShowInfoForRD(torrent);
												} else if (torrent.id.startsWith("ad:")) {
													handleShowInfoForAD(torrent);
												} else if (torrent.id.startsWith("tb:")) {
													handleShowInfoForTB(torrent);
												}
											}}
											className="px-1 py-1 text-sm truncate"
										>
											{!['Invalid Magnet', 'Magnet', 'noname'].includes(
												torrent.filename
											) && (
												<>
													<div
														className="cursor-pointer inline-block"
														onClick={(e) => {
															e.stopPropagation();
															handleChangeType(torrent);
														}}
													>
														{
															['🎥', '📺', '🗂️'][
																['movie', 'tv', 'other'].indexOf(
																	torrent.mediaType
																)
															]
														}
													</div>
													&nbsp;<strong>{torrent.filename}</strong>{' '}
													{filterText && (
														<Link
															href={`/library?filter=${encodeURIComponent(
																torrent.title
															)}`}
															className="inline-block bg-orange-500 hover:bg-orange-700 text-white font-bold py-0 px-1 rounded text-xs cursor-pointer"
															onClick={(e) => e.stopPropagation()}
														>
															{filterText}
														</Link>
													)}
													{torrent.info && (
														<Link
															href={`/search?query=${encodeURIComponent(
																(
																	torrent.info.title +
																	' ' +
																	(torrent.info.year || '')
																).trim() || torrent.title
															)}`}
															target="_blank"
															className="inline-block bg-blue-600 hover:bg-blue-800 text-white font-bold py-0 px-1 mr-2 rounded text-xs cursor-pointer ml-1"
															onClick={(e) => e.stopPropagation()}
														>
															Search again
														</Link>
													)}{' '}
													<br />
												</>
											)}
											{rdKey && adKey && torrentPrefix(torrent.id)}{' '}
											{torrent.filename === torrent.hash
												? 'Magnet'
												: torrent.filename}
											{torrent.filename === torrent.hash ||
											torrent.filename === 'Magnet'
												? ` (${torrent.status})`
												: ''}
										</td>

										<td
											onClick={() => {
												if (torrent.id.startsWith("rd:")) {
													handleShowInfoForRD(torrent);
												} else if (torrent.id.startsWith("ad:")) {
													handleShowInfoForAD(torrent);
												} else if (torrent.id.startsWith("tb:")) {
													handleShowInfoForTB(torrent);
												}
											}}
											className="px-1 py-1 text-xs text-center"
										>
											{(torrent.bytes / ONE_GIGABYTE).toFixed(1)} GB
										</td>
										<td
											onClick={() => {
												if (torrent.id.startsWith("rd:")) {
													handleShowInfoForRD(torrent);
												} else if (torrent.id.startsWith("ad:")) {
													handleShowInfoForAD(torrent);
												} else if (torrent.id.startsWith("tb:")) {
													handleShowInfoForTB(torrent);
												}
											}}
											className="px-1 py-1 text-xs text-center"
										>
											{torrent.status !== UserTorrentStatus.finished ? (
												<>
													<span className="inline-block align-middle">
														{torrent.progress.toFixed(2)}%&nbsp;
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
												`${torrent.links.length} 📂`
											)}
										</td>

										<td
											onClick={() => {
												if (torrent.id.startsWith("rd:")) {
													handleShowInfoForRD(torrent);
												} else if (torrent.id.startsWith("ad:")) {
													handleShowInfoForAD(torrent);
												} else if (torrent.id.startsWith("tb:")) {
													handleShowInfoForTB(torrent);
												}
											}}
											className="px-1 py-1 text-xs text-center"
										>
											{new Date(torrent.added).toLocaleString()}
										</td>
										<td
											onClick={() => {
												if (torrent.id.startsWith("rd:")) {
													handleShowInfoForRD(torrent);
												} else if (torrent.id.startsWith("ad:")) {
													handleShowInfoForAD(torrent);
												} else if (torrent.id.startsWith("tb:")) {
													handleShowInfoForTB(torrent);
												}
											}}
											className="px-1 py-1 flex place-content-center"
										>
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
												onClick={async (e) => {
													e.stopPropagation();
													if (rdKey && torrent.id.startsWith('rd:')) {
														await handleDeleteRdTorrent(
															rdKey,
															torrent.id
														);
													}
													if (adKey && torrent.id.startsWith('ad:')) {
														await handleDeleteAdTorrent(
															adKey,
															torrent.id
														);
													}
													if (tbKey && torrent.id.startsWith('tb:')) {
														await handleDeleteTbTorrent(
															tbKey,
															torrent.id
														)
													}
													setUserTorrentsList((prevList) =>
														prevList.filter(
															(prevTor) => prevTor.id !== torrent.id
														)
													);
													await torrentDB.deleteById(torrent.id);
													setSelectedTorrents((prev) => {
														prev.delete(torrent.id);
														return new Set(prev);
													});
												}}
											>
												<FaTrash />
											</button>

											<button
												title="Copy magnet url"
												className="cursor-pointer mr-2 mb-2 text-pink-500"
												onClick={(e) => {
													e.stopPropagation();
													handleCopyMagnet(torrent.hash);
												}}
											>
												<FaMagnet />
											</button>

											<button
												title="Reinsert"
												className="cursor-pointer mr-2 mb-2 text-green-500"
												onClick={async (e) => {
													e.stopPropagation();
													try {
														const oldId = torrent.id;
														if (rdKey && torrent.id.startsWith('rd:')) {
															await handleReinsertTorrentinRd(
																rdKey,
																torrent
															);
															await fetchLatestRDTorrents(2);
															setUserTorrentsList((prev) =>
																prev.filter(
																	(torrent) =>
																		torrent.id !== oldId
																)
															);
															await torrentDB.deleteById(oldId);
															setSelectedTorrents((prev) => {
																prev.delete(oldId);
																return new Set(prev);
															});
														}
														if (adKey && torrent.id.startsWith('ad:')) {
															await handleRestartTorrent(
																adKey,
																torrent.id
															);
															await fetchLatestADTorrents();
														}
														if (tbKey && torrent.id.startsWith('tb:')) {
															await fetchLatestTBTorrents();
														}
													} catch (error) {
														console.error(error);
													}
												}}
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
