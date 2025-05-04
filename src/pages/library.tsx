import LibraryActionButtons from '@/components/LibraryActionButtons';
import LibraryHelpText from '@/components/LibraryHelpText';
import LibraryMenuButtons from '@/components/LibraryMenuButtons';
import LibrarySize from '@/components/LibrarySize';
import LibraryTableHeader from '@/components/LibraryTableHeader';
import LibraryTorrentRow from '@/components/LibraryTorrentRow';
import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { proxyUnrestrictLink } from '@/services/realDebrid';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInRd,
	handleAddMultipleHashesInAd,
	handleAddMultipleHashesInRd,
	handleReinsertTorrentinRd,
	handleRestartTorrent,
} from '@/utils/addMagnet';
import { AsyncFunction, runConcurrentFunctions } from '@/utils/batch';
import { deleteFilteredTorrents } from '@/utils/deleteList';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { extractHashes } from '@/utils/extractHashes';
import { generateHashList } from '@/utils/hashList';
import { fetchLatestADTorrents, fetchLatestRDTorrents } from '@/utils/libraryFetching';
import { initializeLibrary } from '@/utils/libraryInitialization';
import { handleSelectTorrent, resetSelection, selectShown } from '@/utils/librarySelection';
import { handleChangeType } from '@/utils/libraryTypeManagement';
import { localRestore } from '@/utils/localRestore';
import { normalize } from '@/utils/mediaId';
import { quickSearchLibrary } from '@/utils/quickSearch';
import { isFailed, isInProgress, isSlowOrNoLinks } from '@/utils/slow';
import { libraryToastOptions, magnetToastOptions, searchToastOptions } from '@/utils/toastOptions';
import { getHashOfTorrent } from '@/utils/torrentFile';
import { handleShowInfoForAD, handleShowInfoForRD } from '@/utils/torrentInfo';
import { withAuth } from '@/utils/withAuth';
import { saveAs } from 'file-saver';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import Swal from 'sweetalert2';

const ITEMS_PER_PAGE = 100;

interface SortBy {
	column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added';
	direction: 'asc' | 'desc';
}

const torrentDB = new UserTorrentDB();

function TorrentsPage() {
	const router = useRouter();
	const {
		title: titleFilter,
		tvTitle: tvTitleFilter,
		hash: hashFilter,
		mediaType,
		status,
	} = router.query;
	const [query, setQuery] = useState('');
	const [currentPage, setCurrentPage] = useState(1);

	// loading states
	const [loading, setLoading] = useState(true);
	const [rdSyncing, setRdSyncing] = useState(true);
	const [adSyncing, setAdSyncing] = useState(true);
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

	const [defaultTitleGrouping] = useState<Record<string, number>>({});
	const [movieTitleGrouping] = useState<Record<string, number>>({});
	const [tvGroupingByEpisode] = useState<Record<string, number>>({});
	const [tvGroupingByTitle] = useState<Record<string, number>>({});
	const [hashGrouping] = useState<Record<string, number>>({});
	const [sameTitle] = useState<Set<string>>(new Set());
	const [sameHash] = useState<Set<string>>(new Set());

	const [uncachedRdHashes, setUncachedRdHashes] = useState<Set<string>>(new Set());
	const [uncachedAdIDs, setUncachedAdIDs] = useState<string[]>([]);
	const [shouldDownloadMagnets] = useState(
		() =>
			typeof window !== 'undefined' &&
			window.localStorage.getItem('settings:downloadMagnets') === 'true'
	);

	// filter counts
	const [slowCount, setSlowCount] = useState(0);
	const [inProgressCount, setInProgressCount] = useState(0);
	const [failedCount, setFailedCount] = useState(0);

	// stats
	const [totalBytes, setTotalBytes] = useState<number>(0);

	const relevantList = selectedTorrents.size
		? userTorrentsList.filter((t) => selectedTorrents.has(t.id))
		: filteredList;

	// generate STRM files for each video in torrent
	useEffect(() => {
		if (typeof window !== 'undefined' && rdKey) {
			(window as any).generateStrmFiles = async (filename: string, links: string[]) => {
				for (const link of links) {
					try {
						// Get unrestricted link first
						const resp = await proxyUnrestrictLink(rdKey, link);

						// Get filename from Real-Debrid response
						const nameWithoutExt = resp.filename.substring(
							0,
							resp.filename.lastIndexOf('.')
						);

						// If streamable, use just the name without extension
						// If not streamable, keep the original extension
						const strmName = resp.streamable
							? `${nameWithoutExt}.strm`
							: `${resp.filename}.strm`;

						// Create STRM file with just the direct URL
						const blob = new Blob([resp.download], { type: 'text/plain' });
						const strmLink = document.createElement('a');
						strmLink.href = URL.createObjectURL(blob);
						strmLink.download = strmName;
						strmLink.click();
						URL.revokeObjectURL(strmLink.href);
					} catch (e) {
						console.error(e);
					}
				}
			};
		}
	}, [rdKey]);

	// export download links list
	useEffect(() => {
		if (typeof window !== 'undefined' && rdKey) {
			(window as any).exportLinks = async (filename: string, links: string[]) => {
				let textContent = '';
				for (const link of links) {
					try {
						const resp = await proxyUnrestrictLink(rdKey, link);
						textContent += resp.download + '\n';
					} catch (e) {
						console.error(e);
					}
				}
				const blob = new Blob([textContent], { type: 'text/plain' });
				const link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = `${filename}.txt`;
				link.click();
				URL.revokeObjectURL(link.href);
			};
		}
	}, [rdKey]);

	// add hash to library
	useEffect(() => {
		const { addMagnet } = router.query;
		if (!addMagnet) return;
		router.push(`/library?page=1`);
		const hashes = extractHashes(addMagnet as string);
		if (hashes.length !== 1) return;

		if (rdKey)
			handleAddMultipleHashesInRd(
				rdKey,
				hashes,
				async () => await triggerFetchLatestRDTorrents(2)
			);
		if (adKey)
			handleAddMultipleHashesInAd(
				adKey,
				hashes,
				async () => await triggerFetchLatestADTorrents()
			);
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

	// pressing arrow keys to navigate
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'ArrowLeft') {
				handlePrevPage();
			}
			if (e.key === 'ArrowRight') {
				handleNextPage();
			}
			const queryBox = document.getElementById('query');
			if (!queryBox?.matches(':focus') && /^[a-zA-Z]$/.test(e.key)) {
				document.getElementById('query')?.focus();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [handlePrevPage, handleNextPage]);

	const triggerFetchLatestRDTorrents = async (customLimit?: number) => {
		await fetchLatestRDTorrents(
			rdKey,
			torrentDB,
			setUserTorrentsList,
			setLoading,
			setRdSyncing,
			setSelectedTorrents,
			customLimit
		);
	};

	const triggerFetchLatestADTorrents = async () => {
		await fetchLatestADTorrents(
			adKey,
			torrentDB,
			setUserTorrentsList,
			setLoading,
			setAdSyncing,
			setSelectedTorrents
		);
	};

	useEffect(() => {
		initialize();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey, adKey]);

	// aggregate metadata
	useEffect(() => {
		if (loading) return;

		setGrouping(true);
		setTotalBytes(0);
		sameTitle.clear();
		sameHash.clear();

		// title grouping
		clearGroupings(defaultTitleGrouping);
		clearGroupings(movieTitleGrouping);
		clearGroupings(tvGroupingByEpisode);
		// tv show title grouping
		clearGroupings(tvGroupingByTitle);
		// hash grouping
		clearGroupings(hashGrouping);

		for (const t of userTorrentsList) {
			if (/^Magnet/.test(t.title)) continue;

			// group by hash
			if (t.hash in hashGrouping) {
				if (hashGrouping[t.hash] === 1) sameHash.add(t.hash);
				hashGrouping[t.hash]++;
			} else {
				hashGrouping[t.hash] = 1;
				setTotalBytes((prev) => prev + t.bytes);
			}

			/// group by title
			const titleId = normalize(t.title);
			if (titleId in getTitleGroupings(t.mediaType)) {
				if (getTitleGroupings(t.mediaType)[titleId] === 1) sameTitle.add(titleId);
				getTitleGroupings(t.mediaType)[titleId]++;
			} else {
				getTitleGroupings(t.mediaType)[titleId] = 1;
			}

			/// group by tv title
			if (t.mediaType === 'tv' && t.info?.title) {
				const tvShowTitleId = normalize(t.info.title);
				if (tvShowTitleId in tvGroupingByTitle) {
					tvGroupingByTitle[tvShowTitleId]++;
				} else {
					tvGroupingByTitle[tvShowTitleId] = 1;
				}
			}
		}
		setGrouping(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		userTorrentsList,
		loading,
		defaultTitleGrouping,
		movieTitleGrouping,
		tvGroupingByEpisode,
		tvGroupingByTitle,
	]);

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
			setFilteredList(quickSearchLibrary(query, userTorrentsList));
			// deleteFailedTorrents(userTorrentsList); // disabled because this is BAD!
			setFiltering(false);
			setHelpTextBasedOnTime();
			return;
		}
		let tmpList = userTorrentsList;
		if (status === 'slow') {
			tmpList = tmpList.filter(isSlowOrNoLinks);
			setFilteredList(quickSearchLibrary(query, tmpList));
			if (helpText !== 'hide')
				setHelpText(
					'The displayed torrents are older than one hour and lack any seeders. You can use the "Delete shown" option to remove them.'
				);
		}
		if (status === 'inprogress') {
			tmpList = tmpList.filter(isInProgress);
			setFilteredList(quickSearchLibrary(query, tmpList));
			if (helpText !== 'hide') setHelpText('Torrents that are still downloading');
		}
		if (status === 'failed') {
			tmpList = tmpList.filter(isFailed);
			setFilteredList(quickSearchLibrary(query, tmpList));
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
			setFilteredList(quickSearchLibrary(query, tmpList));
			if (helpText !== 'hide') setHelpText('Torrents that are no longer cached');
		}
		if (status === 'selected') {
			tmpList = tmpList.filter((t) => selectedTorrents.has(t.id));
			setFilteredList(quickSearchLibrary(query, tmpList));
			if (helpText !== 'hide') setHelpText('Torrents that you have selected');
		}
		if (titleFilter) {
			const decoded = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => normalize(t.title) === decoded);
			setFilteredList(quickSearchLibrary(query, tmpList));
		}
		if (tvTitleFilter) {
			const decoded = decodeURIComponent(tvTitleFilter as string);
			tmpList = tmpList.filter(
				(t) => t.mediaType === 'tv' && t.info?.title && normalize(t.info.title) === decoded
			);
			setFilteredList(quickSearchLibrary(query, tmpList));
		}
		if (hashFilter) {
			const hashVal = hashFilter as string;
			tmpList = tmpList.filter((t) => t.hash === hashVal);
			setFilteredList(quickSearchLibrary(query, tmpList));
		}
		if (status === 'sametitle') {
			tmpList = tmpList.filter((t) => sameTitle.has(normalize(t.title)));
			setFilteredList(quickSearchLibrary(query, tmpList));
		}
		if (status === 'samehash') {
			tmpList = tmpList.filter((t) => sameHash.has(t.hash));
			setFilteredList(quickSearchLibrary(query, tmpList));
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => mediaType === t.mediaType);
			setFilteredList(quickSearchLibrary(query, tmpList));
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

			if (sortBy.column === 'title') {
				const titleA = a[sortBy.column] as string;
				const titleB = b[sortBy.column] as string;
				const lowerA = titleA.toLowerCase();
				const lowerB = titleB.toLowerCase();

				if (lowerA === lowerB) {
					comparison = titleA < titleB ? -1 : 1; // Uppercase first
				} else {
					comparison = lowerA < lowerB ? -1 : 1;
				}
			} else {
				if (a[sortBy.column] > b[sortBy.column]) {
					comparison = 1;
				} else if (a[sortBy.column] < b[sortBy.column]) {
					comparison = -1;
				}
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

	const getTitleGroupings = (mediaType: UserTorrent['mediaType']) => {
		switch (mediaType) {
			case 'movie':
				return movieTitleGrouping;
			case 'tv':
				return tvGroupingByEpisode;
			default:
				return defaultTitleGrouping;
		}
	};

	function clearGroupings(frequencyMap: { [x: string]: number }) {
		for (let key in frequencyMap) {
			delete frequencyMap[key];
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
					confirmButtonColor: '#0891b2',
					cancelButtonColor: '#374151',
					confirmButtonText: 'Yes, reinsert!',
					background: '#111827',
					color: '#f3f4f6',
					customClass: {
						popup: 'bg-gray-900',
						htmlContainer: 'text-gray-100',
					},
				})
			).isConfirmed
		)
			return;
		const toReinsert = relevantList.map(wrapReinsertFn);
		const [results, errors] = await runConcurrentFunctions(toReinsert, 4, 0);
		if (errors.length) {
			toast.error(`Error reinserting ${errors.length} torrents`, magnetToastOptions);
		}
		if (results.length) {
			resetSelection(setSelectedTorrents);
			await triggerFetchLatestRDTorrents(Math.ceil(relevantList.length * 1.1));
			await triggerFetchLatestADTorrents();
			toast.success(`Reinserted ${results.length} torrents`, magnetToastOptions);
		}
		if (!errors.length && !results.length) {
			toast('No torrents to reinsert', magnetToastOptions);
		}
	}

	async function handleGenerateHashlist() {
		// get title from input popup
		const { value: title } = await Swal.fire({
			title: 'Enter a title for the hash list',
			input: 'text',
			inputPlaceholder: 'Enter a title',
			inputAttributes: {
				autocapitalize: 'off',
			},
			showCancelButton: true,
			confirmButtonColor: '#0891b2',
			cancelButtonColor: '#374151',
			background: '#111827',
			color: '#f3f4f6',
			customClass: {
				popup: 'bg-gray-900',
				htmlContainer: 'text-gray-100',
				input: 'bg-gray-800 text-gray-100 border border-gray-700 rounded p-2 placeholder-gray-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500',
			},
		});
		if (!title) return;
		generateHashList(title, relevantList);
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
					confirmButtonColor: '#0891b2',
					cancelButtonColor: '#374151',
					confirmButtonText: 'Yes, delete!',
					background: '#111827',
					color: '#f3f4f6',
					customClass: {
						popup: 'bg-gray-900',
						htmlContainer: 'text-gray-100',
					},
				})
			).isConfirmed
		)
			return;
		await deleteFilteredTorrents(relevantList, wrapDeleteFn);
		resetSelection(setSelectedTorrents);
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
					await handleReinsertTorrentinRd(rdKey, t, true);
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
			confirmButtonColor: '#0891b2',
			cancelButtonColor: '#374151',
			denyButtonColor: '#059669',
			confirmButtonText: 'Delete Smaller',
			denyButtonText: 'Delete Bigger',
			showDenyButton: true,
			cancelButtonText: `Cancel`,
			background: '#111827',
			color: '#f3f4f6',
			customClass: {
				popup: 'bg-gray-900',
				htmlContainer: 'text-gray-100',
			},
		});

		// If the user cancels the operation, return without doing anything
		if (deletePreference.isDismissed) return;

		// Determine the preference for deletion
		const deleteBigger = deletePreference.isDenied;

		// Get the key by status
		const getKey = (torrent: UserTorrent) => normalize(torrent.title);
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
		const [results, errors] = await runConcurrentFunctions(toDelete, 4, 0);

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
			confirmButtonColor: '#0891b2',
			cancelButtonColor: '#374151',
			denyButtonColor: '#059669',
			confirmButtonText: 'Delete Older',
			denyButtonText: 'Delete Newer',
			showDenyButton: true,
			cancelButtonText: `Cancel`,
			background: '#111827',
			color: '#f3f4f6',
			customClass: {
				popup: 'bg-gray-900',
				htmlContainer: 'text-gray-100',
			},
		});

		// If the user cancels the operation, return without doing anything
		if (deletePreference.isDismissed) return;

		// Determine the preference for deletion
		const deleteOlder = deletePreference.isConfirmed;

		// Get the key by status
		const getKey = (torrent: UserTorrent) => normalize(torrent.title);
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
		const [results, errors] = await runConcurrentFunctions(toDelete, 4, 0);

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
					confirmButtonColor: '#0891b2',
					cancelButtonColor: '#374151',
					confirmButtonText: 'Yes, proceed!',
					background: '#111827',
					color: '#f3f4f6',
					customClass: {
						popup: 'bg-gray-900',
						htmlContainer: 'text-gray-100',
					},
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
		const [results, errors] = await runConcurrentFunctions(toReinsertAndDelete, 4, 0);
		if (errors.length) {
			toast.error(`Error with merging ${errors.length} torrents`, libraryToastOptions);
		}
		if (results.length) {
			await triggerFetchLatestRDTorrents(Math.ceil(results.length * 1.1));
			await triggerFetchLatestADTorrents();
			toast.success(`Merged ${results.length} torrents`, libraryToastOptions);
		}
		if (!errors.length && !results.length) {
			toast('No torrents to merge', libraryToastOptions);
		}
	}

	async function localBackup() {
		const backupChoice = await Swal.fire({
			title: 'Backup Library',
			text: 'Choose which torrents to backup:',
			icon: 'question',
			showCancelButton: true,
			confirmButtonColor: '#0891b2',
			cancelButtonColor: '#374151',
			denyButtonColor: '#059669',
			confirmButtonText: 'All Torrents',
			denyButtonText: 'Filtered List',
			showDenyButton: true,
			cancelButtonText: 'Cancel',
			background: '#111827',
			color: '#f3f4f6',
			customClass: {
				popup: 'bg-gray-900',
				htmlContainer: 'text-gray-100',
			},
		});

		if (backupChoice.isDismissed) return;

		const listToBackup = backupChoice.isConfirmed ? userTorrentsList : filteredList;
		const backupType = backupChoice.isConfirmed ? 'full' : 'filtered';

		toast('Generating a local backup file', libraryToastOptions);
		try {
			const hashList = listToBackup.map((t) => ({
				filename: t.filename,
				hash: t.hash,
			}));
			const blob = new Blob([JSON.stringify(hashList, null, 2)], {
				type: 'application/json',
			});
			saveAs(blob, `backup-${backupType}-${Date.now()}.dmm.json`);
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
					const concurrencyCount = 1;
					const [results, errors] = await runConcurrentFunctions(
						toAdd,
						concurrencyCount,
						0
					);
					if (results.length) {
						await triggerFetchLatestRDTorrents(Math.ceil(results.length * 1.1));
						await triggerFetchLatestADTorrents();
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
		const { value: input, dismiss } = await Swal.fire({
			title: `Add to your ${debridService.toUpperCase()} library`,
			html: `
				<div class="bg-gray-900 p-4 rounded-lg">
					<textarea
						id="magnetInput"
						class="w-full h-32 bg-gray-800 text-gray-100 border border-gray-700 rounded p-2 placeholder-gray-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
						placeholder="Paste your Magnet link(s) here"
					></textarea>
					<div class="mt-4">
						<label class="block text-sm text-gray-300 mb-2">Or upload .torrent file(s)</label>
						<input
							type="file"
							id="torrentFile"
							accept=".torrent"
							multiple
							class="block w-full text-sm text-gray-300
								file:mr-4 file:py-2 file:px-4
								file:rounded file:border-0
								file:text-sm file:font-medium
								file:bg-cyan-900 file:text-cyan-100
								hover:file:bg-cyan-800
								cursor-pointer
								border border-gray-700 rounded
							"
						/>
					</div>
				</div>
			`,
			background: '#111827',
			color: '#f3f4f6',
			confirmButtonColor: '#0891b2',
			cancelButtonColor: '#374151',
			showCancelButton: true,
			customClass: {
				popup: 'bg-gray-900',
				htmlContainer: 'text-gray-100',
			},
			preConfirm: async () => {
				const magnetInput = (document.getElementById('magnetInput') as HTMLTextAreaElement)
					.value;
				const fileInput = document.getElementById('torrentFile') as HTMLInputElement;
				const files = fileInput.files;

				let hashes: string[] = [];

				// Process magnet links
				if (magnetInput) {
					hashes.push(...extractHashes(magnetInput));
				}

				// Process torrent files
				if (files && files.length > 0) {
					try {
						const fileHashes = await Promise.all(
							Array.from(files).map((file) => getHashOfTorrent(file))
						);
						hashes.push(
							...fileHashes.filter((hash): hash is string => hash !== undefined)
						);
					} catch (error) {
						Swal.showValidationMessage(`Failed to process torrent file: ${error}`);
						return false;
					}
				}

				if (hashes.length === 0) {
					Swal.showValidationMessage(
						'Please provide either magnet links or torrent files'
					);
					return false;
				}

				return hashes;
			},
		});

		if (dismiss === Swal.DismissReason.cancel || !input) return;

		const hashes = input as string[];

		if (rdKey && hashes && debridService === 'rd') {
			handleAddMultipleHashesInRd(
				rdKey,
				hashes,
				async () => await triggerFetchLatestRDTorrents(Math.ceil(hashes.length * 1.1))
			);
		}
		if (adKey && hashes && debridService === 'ad') {
			handleAddMultipleHashesInAd(
				adKey,
				hashes,
				async () => await triggerFetchLatestADTorrents()
			);
		}
	}

	const hasNoQueryParamsBut = (...params: string[]) =>
		Object.keys(router.query).filter((p) => !params.includes(p)).length === 0;

	const resetFilters = () => {
		setQuery('');
		setSortBy({ column: 'added', direction: 'desc' });
		router.push(`/library?page=1`);
	};

	// Modify initialize function to work offline
	async function initialize() {
		// Skip full library reload if we're just adding a magnet
		const { addMagnet } = router.query;

		await initializeLibrary(
			torrentDB,
			setUserTorrentsList,
			setLoading,
			rdKey,
			adKey,
			triggerFetchLatestRDTorrents,
			triggerFetchLatestADTorrents,
			userTorrentsList,
			!!addMagnet // Pass flag to indicate we're adding a magnet
		);
	}

	return (
		<div className="mx-1 my-0 min-h-screen bg-gray-900 text-gray-100">
			<Head>
				<title>Debrid Media Manager - Library</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="mb-1 flex items-center justify-between">
				<h1 className="text-xl font-bold text-white">
					Library 📚{' '}
					<LibrarySize
						torrentCount={userTorrentsList.length}
						totalBytes={totalBytes}
						isLoading={rdSyncing || adSyncing}
					/>
				</h1>

				<Link
					href="/"
					className="rounded border-2 border-cyan-500 bg-cyan-900/30 px-2 py-0.5 text-sm text-cyan-100 transition-colors hover:bg-cyan-800/50"
				>
					Go Home
				</Link>
			</div>
			<div className="mb-2 flex items-center border-b-2 border-gray-600 py-0">
				<input
					className="mr-3 w-full appearance-none border-none bg-transparent px-2 py-0.5 text-xs leading-tight text-gray-100 focus:outline-none"
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
			<LibraryMenuButtons
				currentPage={currentPage}
				maxPages={Math.ceil(sortedData().length / ITEMS_PER_PAGE)}
				onPrevPage={handlePrevPage}
				onNextPage={handleNextPage}
				onResetFilters={resetFilters}
				sameHashSize={sameHash.size}
				sameTitleSize={sameTitle.size}
				selectedTorrentsSize={selectedTorrents.size}
				uncachedCount={uncachedAdIDs.length + uncachedRdHashes.size}
				inProgressCount={inProgressCount}
				slowCount={slowCount}
				failedCount={failedCount}
			/>
			<LibraryActionButtons
				onSelectShown={() => selectShown(currentPageData(), setSelectedTorrents)}
				onResetSelection={() => resetSelection(setSelectedTorrents)}
				onReinsertTorrents={handleReinsertTorrents}
				onGenerateHashlist={handleGenerateHashlist}
				onDeleteShownTorrents={handleDeleteShownTorrents}
				onAddMagnet={handleAddMagnet}
				onLocalRestore={wrapLocalRestoreFn}
				onLocalBackup={localBackup}
				onDedupeBySize={dedupeBySize}
				onDedupeByRecency={dedupeByRecency}
				onCombineSameHash={combineSameHash}
				selectedTorrentsSize={selectedTorrents.size}
				rdKey={rdKey}
				adKey={adKey}
				showDedupe={
					router.query.status === 'sametitle' ||
					(!!titleFilter && filteredList.length > 1)
				}
				showHashCombine={
					router.query.status === 'samehash' || (!!hashFilter && filteredList.length > 1)
				}
			/>
			<LibraryHelpText helpText={helpText} onHide={() => setHelpText('hide')} />
			<div className="overflow-x-auto">
				{loading || grouping || filtering ? (
					<div className="mt-2 flex items-center justify-center">
						<div className="h-10 w-10 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
					</div>
				) : (
					<table className="w-full">
						<thead>
							<LibraryTableHeader
								sortBy={sortBy}
								onSort={handleSort}
								filteredListLength={filteredList.length}
								selectedTorrentsSize={selectedTorrents.size}
							/>
						</thead>
						<tbody>
							{currentPageData().map((torrent) => (
								<LibraryTorrentRow
									key={torrent.id}
									torrent={torrent}
									rdKey={rdKey}
									adKey={adKey}
									shouldDownloadMagnets={shouldDownloadMagnets}
									hashGrouping={hashGrouping}
									titleGrouping={getTitleGroupings(torrent.mediaType)}
									tvGroupingByTitle={tvGroupingByTitle}
									hashFilter={hashFilter as string}
									titleFilter={titleFilter as string}
									tvTitleFilter={tvTitleFilter as string}
									isSelected={selectedTorrents.has(torrent.id)}
									onSelect={(id) =>
										handleSelectTorrent(
											id,
											selectedTorrents,
											setSelectedTorrents
										)
									}
									onDelete={async (id) => {
										setUserTorrentsList((prevList) =>
											prevList.filter((prevTor) => prevTor.id !== id)
										);
										await torrentDB.deleteById(id);
										setSelectedTorrents((prev) => {
											prev.delete(id);
											return new Set(prev);
										});
									}}
									onShowInfo={(t) =>
										t.id.startsWith('rd:')
											? handleShowInfoForRD(
													t,
													rdKey!,
													setUserTorrentsList,
													torrentDB,
													setSelectedTorrents
												)
											: handleShowInfoForAD(t, adKey!)
									}
									onTypeChange={(t) =>
										handleChangeType(t, setUserTorrentsList, torrentDB)
									}
								/>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}

export default withAuth(TorrentsPage);
