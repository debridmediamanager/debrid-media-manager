import LibraryActionButtons from '@/components/LibraryActionButtons';
import LibraryMenuButtons from '@/components/LibraryMenuButtons';
import LibrarySize from '@/components/LibrarySize';
import LibraryTableHeader from '@/components/LibraryTableHeader';
import LibraryTorrentRow from '@/components/LibraryTorrentRow';
import { useLibraryCache } from '@/contexts/LibraryCacheContext';
import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import { useRelativeTimeLabel } from '@/hooks/useRelativeTimeLabel';
import { getTorrentInfo, proxyUnrestrictLink } from '@/services/realDebrid';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import {
	handleAddAsMagnetInAd,
	handleAddAsMagnetInRd,
	handleAddAsMagnetInTb,
	handleAddMultipleHashesInAd,
	handleAddMultipleHashesInRd,
	handleAddMultipleHashesInTb,
	handleAddMultipleTorrentFilesInRd,
	handleAddMultipleTorrentFilesInTb,
	handleReinsertTorrentinRd,
	handleRestartTorrent,
} from '@/utils/addMagnet';
import { AsyncFunction, runConcurrentFunctions } from '@/utils/batch';
import { deleteFilteredTorrents } from '@/utils/deleteList';
import {
	handleDeleteAdTorrent,
	handleDeleteRdTorrent,
	handleDeleteTbTorrent,
} from '@/utils/deleteTorrent';
import { extractHashes } from '@/utils/extractHashes';
import { getRdStatus } from '@/utils/fetchTorrents';
import { generateHashList } from '@/utils/hashList';
import { filterLibraryItems } from '@/utils/libraryFilters';
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
import { BookOpen } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import Modal from '../components/modals/modal';

const ITEMS_PER_PAGE = 100;

interface SortBy {
	column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added';
	direction: 'asc' | 'desc';
}

interface RestoredFile {
	filename: string;
	hash: string;
}

interface RDFileInfo {
	id: number;
	path: string;
	bytes: number;
	selected: number;
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

	// Use cached library data
	const {
		libraryItems: cachedLibraryItems,
		isLoading: cacheLoading,
		isFetching,
		refreshLibrary,
		setLibraryItems: setCachedLibraryItems,
		addTorrent,
		removeTorrent: removeFromCache,
		removeTorrents: removeMultipleFromCache,
		updateTorrent: updateInCache,
		error: cacheError,
		lastFetchTime,
	} = useLibraryCache();

	const lastFetchLabel = useRelativeTimeLabel(lastFetchTime, 'Just now');

	// loading states
	const [rdSyncing, setRdSyncing] = useState(false);
	const [adSyncing, setAdSyncing] = useState(false);
	const [grouping, setGrouping] = useState(false);

	// Use cached items directly instead of duplicating state
	const userTorrentsList = cachedLibraryItems;
	const loading = cacheLoading;
	const setUserTorrentsList = setCachedLibraryItems;
	const [filteredList, setFilteredList] = useState<UserTorrent[]>([]);
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'added', direction: 'desc' });
	const [helpText, setHelpText] = useState('');
	const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(() => new Set());

	// keys
	const [rdKey] = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();
	const tbKey = useTorBoxAccessToken();

	const [defaultTitleGrouping] = useState<Record<string, number>>(() => ({}));
	const [movieTitleGrouping] = useState<Record<string, number>>(() => ({}));
	const [tvGroupingByEpisode] = useState<Record<string, number>>(() => ({}));
	const [tvGroupingByTitle] = useState<Record<string, number>>(() => ({}));
	const [hashGrouping] = useState<Record<string, number>>(() => ({}));
	const [sameTitle] = useState<Set<string>>(() => new Set());
	const [sameHash] = useState<Set<string>>(() => new Set());

	const [uncachedRdHashes, setUncachedRdHashes] = useState<Set<string>>(() => new Set());
	const [uncachedAdIDs, setUncachedAdIDs] = useState<string[]>(() => []);
	const [shouldDownloadMagnets] = useState(
		() =>
			typeof window !== 'undefined' &&
			window.localStorage.getItem('settings:downloadMagnets') === 'true'
	);

	// stats
	const [totalBytes, setTotalBytes] = useState<number>(0);

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

			// Cleanup function to remove global window function
			return () => {
				delete (window as any).generateStrmFiles;
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

			// Cleanup function to remove global window function
			return () => {
				delete (window as any).exportLinks;
			};
		}
	}, [rdKey]);

	// Set up global refresh function for dialogs
	useEffect(() => {
		if (typeof window !== 'undefined') {
			(window as any).triggerFetchLatestRDTorrents = async () => {
				await refreshLibrary();
			};

			// Cleanup function to remove global window function
			return () => {
				delete (window as any).triggerFetchLatestRDTorrents;
			};
		}
	}, [refreshLibrary]);

	// add hash to library
	const processingHashRef = useRef<string | null>(null);

	useEffect(() => {
		const { addMagnet } = router.query;
		if (!addMagnet) return;

		const hashes = extractHashes(addMagnet as string);
		if (hashes.length !== 1) return;

		const hash = hashes[0];

		if (processingHashRef.current === hash) return;

		processingHashRef.current = hash;
		router.replace('/library?page=1', undefined, { shallow: true });

		const promises: Promise<void>[] = [];

		if (rdKey) {
			promises.push(
				(async () => {
					try {
						await handleAddAsMagnetInRd(rdKey, hash, async (info) => {
							const userTorrent = (
								await import('@/utils/fetchTorrents')
							).convertToUserTorrent({
								...info,
								id: info.id,
								filename: info.filename,
								bytes: info.bytes,
								status: info.status,
								added: info.added,
								links: info.links,
								hash: info.hash,
							});
							addTorrent(userTorrent);
						});
					} catch (error) {
						console.error('Error adding magnet to RealDebrid:', error);
					}
				})()
			);
		}
		if (adKey) {
			promises.push(
				new Promise<void>(async (resolve) => {
					try {
						const magnetUri = hash.startsWith('magnet:?')
							? hash
							: `magnet:?xt=urn:btih:${hash}`;
						const { uploadMagnet, getMagnetStatus } = await import(
							'@/services/allDebrid'
						);
						const resp = await uploadMagnet(adKey, [magnetUri]);
						if (
							resp.magnets.length > 0 &&
							!resp.magnets[0].error &&
							resp.magnets[0].id
						) {
							const statusResp = await getMagnetStatus(
								adKey,
								String(resp.magnets[0].id)
							);
							if (statusResp.data?.magnets?.[0]) {
								const userTorrent = (
									await import('@/utils/fetchTorrents')
								).convertToAllDebridUserTorrent(statusResp.data.magnets[0]);
								addTorrent(userTorrent);
							}
						}
						resolve();
					} catch (error) {
						console.error('Error adding magnet to AllDebrid:', error);
						resolve();
					}
				})
			);
		}
		if (tbKey) {
			promises.push(
				(async () => {
					try {
						await handleAddAsMagnetInTb(tbKey, hash, async (userTorrent) => {
							addTorrent(userTorrent);
						});
					} catch (error) {
						console.error('Error adding magnet to TorBox:', error);
					}
				})()
			);
		}

		Promise.all(promises).then(() => {
			processingHashRef.current = null;
		});

		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query.addMagnet]);

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
			// Check if modal is open (custom modal uses fixed inset-0 z-50 classes)
			const modalContainer = document.querySelector('.fixed.inset-0.z-50');
			const activeElement = document.activeElement;
			const isInputFocused =
				activeElement &&
				(activeElement.tagName === 'INPUT' ||
					activeElement.tagName === 'TEXTAREA' ||
					activeElement.id === 'magnetInput' ||
					activeElement.id === 'torrentFile');

			// Don't handle keyboard shortcuts when modal is open or input is focused
			if (modalContainer || isInputFocused) {
				return;
			}

			if (e.key === 'ArrowLeft') {
				handlePrevPage();
			}
			if (e.key === 'ArrowRight') {
				handleNextPage();
			}
			const queryBox = document.getElementById('query');
			// Also check for Ctrl/Cmd key to avoid interfering with paste
			if (
				!queryBox?.matches(':focus') &&
				/^[a-zA-Z]$/.test(e.key) &&
				!e.ctrlKey &&
				!e.metaKey
			) {
				document.getElementById('query')?.focus();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [handlePrevPage, handleNextPage]);

	const triggerFetchLatestRDTorrents = async (customLimit?: number) => {
		// Use refreshLibrary from cache context instead
		await refreshLibrary();
	};

	const triggerFetchLatestADTorrents = async () => {
		// Use refreshLibrary from cache context instead
		await refreshLibrary();
	};

	// No longer needed since we're using cached items directly

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
			toast.success(`${uncachedIDs.length} uncached AllDebrid torrents`, searchToastOptions);
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

	// Memoize counts to avoid recalculating on every render
	const {
		slowCount: memoSlowCount,
		inProgressCount: memoInProgressCount,
		failedCount: memoFailedCount,
	} = useMemo(() => {
		let slow = 0,
			inProgress = 0,
			failed = 0;
		for (const torrent of userTorrentsList) {
			if (isSlowOrNoLinks(torrent)) slow++;
			if (isInProgress(torrent)) inProgress++;
			if (isFailed(torrent)) failed++;
		}
		return { slowCount: slow, inProgressCount: inProgress, failedCount: failed };
	}, [userTorrentsList]);

	// filter the list
	useEffect(() => {
		if (loading || grouping) return;
		if (hasNoQueryParamsBut('page')) {
			setFilteredList(quickSearchLibrary(query, userTorrentsList));
			setHelpTextBasedOnTime();
			return;
		}
		const { list: filteredItems, helpText: nextHelpText } = filterLibraryItems({
			torrents: userTorrentsList,
			status,
			titleFilter,
			tvTitleFilter,
			hashFilter,
			mediaType,
			selectedTorrents,
			sameTitle,
			sameHash,
			uncachedRdHashes,
			uncachedAdIDs,
		});
		setFilteredList(quickSearchLibrary(query, filteredItems));
		if (nextHelpText && helpText !== 'hide') {
			setHelpText(nextHelpText);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query, userTorrentsList, loading, grouping, query, currentPage, uncachedRdHashes]);

	function handleSort(column: typeof sortBy.column) {
		setSortBy({
			column,
			direction: sortBy.column === column && sortBy.direction === 'asc' ? 'desc' : 'asc',
		});
	}

	const sortedData = useMemo(() => {
		return [...filteredList].sort((a, b) => {
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
	}, [filteredList, sortBy]);

	const currentPageData = useMemo(() => {
		return sortedData.slice(
			(currentPage - 1) * ITEMS_PER_PAGE,
			(currentPage - 1) * ITEMS_PER_PAGE + ITEMS_PER_PAGE
		);
	}, [sortedData, currentPage]);

	const relevantList = selectedTorrents.size
		? userTorrentsList.filter((t) => selectedTorrents.has(t.id))
		: sortedData;

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
				await Modal.fire({
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

		if (toReinsert.length === 0) {
			toast('No torrents to reinsert.', magnetToastOptions);
			return;
		}

		const progressToast = toast.loading(
			`Reinserting 0/${toReinsert.length} torrents...`,
			magnetToastOptions
		);

		const [results, errors] = await runConcurrentFunctions(
			toReinsert,
			4,
			0,
			(completed, total, errorCount) => {
				const message =
					errorCount > 0
						? `Reinserting ${completed}/${total} torrents (${errorCount} errors)...`
						: `Reinserting ${completed}/${total} torrents...`;
				toast.loading(message, { id: progressToast });
			}
		);

		const removedIds = results.filter((id): id is string => !!id);
		if (removedIds.length > 0) {
			removeMultipleFromCache(removedIds);
			setSelectedTorrents((prev) => {
				const newSet = new Set(prev);
				for (const id of removedIds) newSet.delete(id);
				return newSet;
			});
		}

		// Update the progress toast to show final result
		if (errors.length && results.length) {
			toast.error(`Reinserted ${results.length}; ${errors.length} failed.`, {
				id: progressToast,
				...magnetToastOptions,
			});
			await refreshLibrary();
		} else if (errors.length) {
			toast.error(`Failed to reinsert ${errors.length} torrents.`, {
				id: progressToast,
				...magnetToastOptions,
			});
		} else if (results.length) {
			toast.success(`Reinserted ${results.length} torrents.`, {
				id: progressToast,
				...magnetToastOptions,
			});
			await refreshLibrary();
		} else {
			toast.dismiss(progressToast);
		}
	}

	async function handleGenerateHashlist() {
		// get title from input popup
		const { value: title } = await Modal.fire({
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
				await Modal.fire({
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
		const deletedIds = await deleteFilteredTorrents(relevantList, wrapDeleteFn);
		if (deletedIds.length > 0) {
			removeMultipleFromCache(deletedIds);
		}
		resetSelection(setSelectedTorrents);
	}

	const wrapDeleteFn = useCallback(
		(t: UserTorrent) => {
			return async (): Promise<string> => {
				if (rdKey && t.id.startsWith('rd:')) {
					await handleDeleteRdTorrent(rdKey, t.id);
				}
				if (adKey && t.id.startsWith('ad:')) {
					await handleDeleteAdTorrent(adKey, t.id);
				}
				if (tbKey && t.id.startsWith('tb:')) {
					await handleDeleteTbTorrent(tbKey, t.id);
				}
				return t.id;
			};
		},
		[rdKey, adKey, tbKey]
	);

	const wrapReinsertFn = useCallback(
		(t: UserTorrent) => {
			return async (): Promise<string | undefined> => {
				const oldId = t.id;
				if (rdKey && t.id.startsWith('rd:')) {
					await handleReinsertTorrentinRd(rdKey, t, true);
					await torrentDB.deleteById(oldId);
					return oldId;
				}
				if (adKey && t.id.startsWith('ad:')) {
					await handleRestartTorrent(adKey, t.id);
					return oldId;
				}
				return undefined;
			};
		},
		[rdKey, adKey]
	);

	async function dedupeBySize() {
		const deletePreference = await Modal.fire({
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

		if (toDelete.length === 0) {
			toast('No duplicates found.', libraryToastOptions);
			return;
		}

		const progressToast = toast.loading(
			`Deleting 0/${toDelete.length} torrents...`,
			libraryToastOptions
		);

		const [results, errors] = await runConcurrentFunctions(
			toDelete,
			4,
			0,
			(completed, total, errorCount) => {
				const message =
					errorCount > 0
						? `Deleting ${completed}/${total} torrents (${errorCount} errors)...`
						: `Deleting ${completed}/${total} torrents...`;
				toast.loading(message, { id: progressToast });
			}
		);

		if (results.length > 0) {
			removeMultipleFromCache(results);
		}

		// Update the progress toast to show final result
		if (errors.length && results.length) {
			toast.error(`Deleted ${results.length}; ${errors.length} duplicates failed.`, {
				id: progressToast,
				...libraryToastOptions,
			});
		} else if (errors.length) {
			toast.error(`Failed to delete ${errors.length} duplicates.`, {
				id: progressToast,
				...libraryToastOptions,
			});
		} else if (results.length) {
			toast.success(`Deleted ${results.length} duplicates.`, {
				id: progressToast,
				...libraryToastOptions,
			});
		} else {
			toast.dismiss(progressToast);
		}
	}

	async function dedupeByRecency() {
		// New dialog to select whether to delete newer or older torrents
		const deletePreference = await Modal.fire({
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

		if (toDelete.length === 0) {
			toast('No duplicates found.', libraryToastOptions);
			return;
		}

		const progressToast = toast.loading(
			`Deleting 0/${toDelete.length} torrents...`,
			libraryToastOptions
		);

		const [results, errors] = await runConcurrentFunctions(
			toDelete,
			4,
			0,
			(completed, total, errorCount) => {
				const message =
					errorCount > 0
						? `Deleting ${completed}/${total} torrents (${errorCount} errors)...`
						: `Deleting ${completed}/${total} torrents...`;
				toast.loading(message, { id: progressToast });
			}
		);

		if (results.length > 0) {
			removeMultipleFromCache(results);
		}

		// Update the progress toast to show final result
		if (errors.length && results.length) {
			toast.error(`Deleted ${results.length}; ${errors.length} duplicates failed.`, {
				id: progressToast,
				...libraryToastOptions,
			});
		} else if (errors.length) {
			toast.error(`Failed to delete ${errors.length} duplicates.`, {
				id: progressToast,
				...libraryToastOptions,
			});
		} else if (results.length) {
			toast.success(`Deleted ${results.length} duplicates.`, {
				id: progressToast,
				...libraryToastOptions,
			});
		} else {
			toast.dismiss(progressToast);
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
				await Modal.fire({
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
		let toReinsertAndDelete: AsyncFunction<string | undefined>[] = [];
		dupeHashes.forEach((sameHashTorrents: UserTorrent[]) => {
			const reinsert = sameHashTorrents.pop();
			if (reinsert) {
				toReinsertAndDelete.push(
					wrapReinsertFn(reinsert),
					...sameHashTorrents.map(wrapDeleteFn)
				);
			}
		});
		if (toReinsertAndDelete.length === 0) {
			toast('No matching hashes to merge.', libraryToastOptions);
			return;
		}

		const progressToast = toast.loading(
			`Merging 0/${toReinsertAndDelete.length} operations...`,
			libraryToastOptions
		);

		const [results, errors] = await runConcurrentFunctions(
			toReinsertAndDelete,
			4,
			0,
			(completed, total, errorCount) => {
				const message =
					errorCount > 0
						? `Merging ${completed}/${total} operations (${errorCount} errors)...`
						: `Merging ${completed}/${total} operations...`;
				toast.loading(message, { id: progressToast });
			}
		);

		const removedIds = results.filter((id): id is string => !!id);
		if (removedIds.length > 0) {
			removeMultipleFromCache(removedIds);
		}

		// Update the progress toast to show final result
		if (errors.length && results.length) {
			toast.error(`Merged ${results.length}; ${errors.length} hash merges failed.`, {
				id: progressToast,
				...libraryToastOptions,
			});
			await refreshLibrary();
		} else if (errors.length) {
			toast.error(`Failed to merge ${errors.length} hash operations.`, {
				id: progressToast,
				...libraryToastOptions,
			});
		} else if (results.length) {
			toast.success(`Merged ${results.length} hash duplicates.`, {
				id: progressToast,
				...libraryToastOptions,
			});
			await refreshLibrary();
		} else {
			toast.dismiss(progressToast);
		}
	}

	async function localBackup() {
		const backupChoice = await Modal.fire({
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

		// Apply the current sort to all torrents or use already sorted filtered data
		const listToBackup = backupChoice.isConfirmed
			? [...userTorrentsList].sort((a, b) => {
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
				})
			: sortedData;
		const backupType = backupChoice.isConfirmed ? 'full' : 'filtered';

		toast('Creating local backup...', libraryToastOptions);
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
			toast.error('Failed to create local backup.', libraryToastOptions);
			console.error(error);
		}
	}

	// Hidden function to backup non-current week table data
	async function backupOldWeekData() {
		try {
			const torrentDB = new UserTorrentDB();

			// Get all tables data for inspection
			const allTablesData = await torrentDB.getAllTablesData();
			console.log('All tables data:');
			allTablesData.forEach(({ table, torrents }) => {
				console.log(`  ${table}: ${torrents.length} torrents`);
			});

			// Try to get backup data (non-current week)
			const backupData = await torrentDB.getBackupTableData();
			console.log('Backup data retrieved:', backupData.length, 'torrents');

			// If no backup data, offer to backup all data instead
			if (backupData.length === 0) {
				const allData = await torrentDB.all();
				console.log('Current week data:', allData.length, 'torrents');

				// Check if there's data in any table
				const hasAnyData = allTablesData.some(({ torrents }) => torrents.length > 0);

				if (!hasAnyData) {
					toast('No torrents found to back up.', libraryToastOptions);
					return;
				}

				// Offer to backup current week instead
				const confirmBackup = await Modal.fire({
					title: 'Backup Current Week',
					text: `No data in backup table. Current week has ${allData.length} torrents. Backup current week instead?`,
					icon: 'question',
					showCancelButton: true,
					confirmButtonColor: '#0891b2',
					cancelButtonColor: '#374151',
					confirmButtonText: 'Yes, backup current week',
					background: '#111827',
					color: '#f3f4f6',
				});

				if (!confirmBackup.isConfirmed) return;

				// Backup current week data
				const hashList = allData.map((t) => ({
					filename: t.filename,
					hash: t.hash,
					added: t.added,
					id: t.id,
				}));

				const blob = new Blob([JSON.stringify(hashList, null, 2)], {
					type: 'application/json',
				});

				saveAs(blob, `backup-current-week-${Date.now()}.dmm.json`);
				toast(`Current-week backup saved (${allData.length}).`, libraryToastOptions);
				return;
			}

			// Backup the old week data
			const hashList = backupData.map((t) => ({
				filename: t.filename,
				hash: t.hash,
				added: t.added,
				id: t.id,
			}));

			const blob = new Blob([JSON.stringify(hashList, null, 2)], {
				type: 'application/json',
			});

			saveAs(blob, `backup-oldweek-${Date.now()}.dmm.json`);
			toast(`Old-week backup saved (${backupData.length}).`, libraryToastOptions);
		} catch (error) {
			toast.error('Old-week backup failed.', libraryToastOptions);
			console.error(error);
		}
	}

	async function wrapLocalRestoreFn(debridService: string) {
		return await localRestore(async (files: RestoredFile[]) => {
			const allHashes = new Set(userTorrentsList.map((t) => t.hash));
			const addMagnet = (hash: string) => {
				if (rdKey && debridService === 'rd') return handleAddAsMagnetInRd(rdKey, hash);
				if (adKey && debridService === 'ad')
					return handleAddAsMagnetInAd(adKey, hash, undefined, true, true);
				if (tbKey && debridService === 'tb') return handleAddAsMagnetInTb(tbKey, hash);
			};

			function wrapAddMagnetFn(hash: string) {
				return async () => await addMagnet(hash);
			}

			const processingPromise = new Promise<{ success: number; error: number }>(
				async (resolve) => {
					toast.loading('Restoring... do not refresh.', libraryToastOptions);
					const notAddingCount = files.filter((f) => allHashes.has(f.hash)).length;
					if (notAddingCount > 0)
						toast.error(
							`${notAddingCount} already in your library`,
							libraryToastOptions
						);

					// Filter out duplicates
					const newHashes = files.map((f) => f.hash).filter((h) => !allHashes.has(h));

					if (newHashes.length === 0) {
						resolve({ success: 0, error: 0 });
						return;
					}

					// Check database for cached availability for RD and TB (AD doesn't have bulk check)
					let availableHashes: string[] = [];
					let unavailableHashes: string[] = [];

					if ((rdKey && debridService === 'rd') || (tbKey && debridService === 'tb')) {
						toast.loading(`Checking database for ${newHashes.length} torrents...`, {
							id: 'database-check',
						});

						try {
							if (rdKey && debridService === 'rd') {
								// Check RD database for cached availability in batches of 100
								const { checkAvailabilityByHashes } = await import(
									'@/utils/availability'
								);
								const availableSet = new Set<string>();

								for (let i = 0; i < newHashes.length; i += 100) {
									const batch = newHashes.slice(i, i + 100);
									const resp = await checkAvailabilityByHashes('', '', batch);
									if (resp?.available) {
										resp.available.forEach((t: { hash: string }) =>
											availableSet.add(t.hash)
										);
									}
								}

								availableHashes = newHashes.filter((h) => availableSet.has(h));
								unavailableHashes = newHashes.filter((h) => !availableSet.has(h));
							} else if (tbKey && debridService === 'tb') {
								// Check TorBox database for cached availability
								const { checkCachedStatus } = await import('@/services/torbox');
								const availableSet = new Set<string>();

								// TorBox checks in batches
								for (let i = 0; i < newHashes.length; i += 100) {
									const batch = newHashes.slice(i, i + 100);
									const resp = await checkCachedStatus(
										{
											hash: batch,
											format: 'object',
										},
										tbKey
									);
									if (resp?.data) {
										Object.entries(resp.data).forEach(
											([hash, data]: [string, any]) => {
												if (data) availableSet.add(hash);
											}
										);
									}
								}

								availableHashes = newHashes.filter((h) => availableSet.has(h));
								unavailableHashes = newHashes.filter((h) => !availableSet.has(h));
							}

							toast.dismiss('database-check');
							if (availableHashes.length > 0) {
								toast.success(
									`${availableHashes.length} cached torrents queued first.`,
									libraryToastOptions
								);
							}
							if (unavailableHashes.length > 0) {
								toast(
									`${unavailableHashes.length} torrents must download before restore.`,
									libraryToastOptions
								);
							}
						} catch (error) {
							console.error('Error checking database availability:', error);
							toast.dismiss('database-check');
							// If database check fails, treat all as unavailable
							unavailableHashes = newHashes;
							availableHashes = [];
						}
					} else {
						// For AD or if no database check, treat all as unavailable
						unavailableHashes = newHashes;
					}

					// Process available torrents first (higher concurrency), then unavailable ones
					const toAddAvailable = availableHashes.map(wrapAddMagnetFn);
					const toAddUnavailable = unavailableHashes.map(wrapAddMagnetFn);

					let totalCompleted = 0;
					const totalToAdd = toAddAvailable.length + toAddUnavailable.length;

					// Process available torrents with higher concurrency (4)
					let availableResults: any[] = [];
					let availableErrors: any[] = [];
					if (toAddAvailable.length > 0) {
						[availableResults, availableErrors] = await runConcurrentFunctions(
							toAddAvailable,
							4, // Higher concurrency for cached torrents
							0,
							(completed, total, errorCount) => {
								totalCompleted = completed;
								const message =
									errorCount > 0
										? `Restoring cached torrents ${completed}/${total} (${errorCount} errors)...`
										: `Restoring cached torrents ${completed}/${total}...`;
								toast.loading(message, { id: 'restore-progress' });
							}
						);
					}

					// Process unavailable torrents with lower concurrency (1)
					let unavailableResults: any[] = [];
					let unavailableErrors: any[] = [];
					if (toAddUnavailable.length > 0) {
						[unavailableResults, unavailableErrors] = await runConcurrentFunctions(
							toAddUnavailable,
							1, // Lower concurrency for uncached torrents
							0,
							(completed, total, errorCount) => {
								const actualCompleted = totalCompleted + completed;
								const message =
									errorCount > 0
										? `Restoring ${actualCompleted}/${totalToAdd} downloads (${availableErrors.length + errorCount} errors)...`
										: `Restoring ${actualCompleted}/${totalToAdd} downloads...`;
								toast.loading(message, { id: 'restore-progress' });
							}
						);
					}

					toast.dismiss('restore-progress');
					const allResults = [...availableResults, ...unavailableResults];
					const allErrors = [...availableErrors, ...unavailableErrors];

					if (allResults.length) {
						await refreshLibrary();
					}
					resolve({ success: allResults.length, error: allErrors.length });
				}
			);

			toast.promise(
				processingPromise,
				{
					loading: `Restoring ${files.length} downloads...`,
					success: ({ success, error }) => {
						setTimeout(() => location.reload(), 10000);
						return `Restored ${success}; ${error} failed in ${debridService.toUpperCase()} library. Refreshing in 10s.`;
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
		const { value: input, dismiss } = await Modal.fire({
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
				let torrentFiles: File[] = [];

				// Process magnet links
				if (magnetInput) {
					hashes.push(...extractHashes(magnetInput));
				}

				// Collect torrent files (don't convert to hashes)
				if (files && files.length > 0) {
					torrentFiles = Array.from(files);
				}

				if (hashes.length === 0 && torrentFiles.length === 0) {
					Modal.showValidationMessage(
						'Please provide either magnet links or torrent files'
					);
					return false;
				}

				return { hashes, torrentFiles };
			},
		});

		if (dismiss === Modal.DismissReason.cancel || !input) return;

		const { hashes, torrentFiles } = input as { hashes: string[]; torrentFiles: File[] };

		if (rdKey && debridService === 'rd') {
			// Handle torrent files first (direct upload)
			if (torrentFiles.length > 0) {
				handleAddMultipleTorrentFilesInRd(
					rdKey,
					torrentFiles,
					async () => await refreshLibrary()
				);
			}
			// Then handle magnet hashes
			if (hashes.length > 0) {
				handleAddMultipleHashesInRd(rdKey, hashes, async () => await refreshLibrary());
			}
		}
		if (adKey && debridService === 'ad') {
			// AllDebrid: combine hashes from magnets and torrent files
			const allHashes = [...hashes];

			if (torrentFiles.length > 0) {
				try {
					const fileHashes = await Promise.all(
						torrentFiles.map((file) => getHashOfTorrent(file))
					);
					allHashes.push(...(fileHashes.filter((h) => h !== undefined) as string[]));
				} catch (error) {
					toast.error(`Hash extraction failed: ${error}`);
					return;
				}
			}

			if (allHashes.length > 0) {
				handleAddMultipleHashesInAd(adKey, allHashes, async () => await refreshLibrary());
			}
		}
		if (tbKey && debridService === 'tb') {
			// TorBox accepts both torrent files and magnets
			if (torrentFiles.length > 0) {
				handleAddMultipleTorrentFilesInTb(
					tbKey,
					torrentFiles,
					async () => await refreshLibrary()
				);
			}
			if (hashes.length > 0) {
				handleAddMultipleHashesInTb(tbKey, hashes, async () => await refreshLibrary());
			}
		}
	}

	const hasNoQueryParamsBut = (...params: string[]) =>
		Object.keys(router.query).filter((p) => !params.includes(p)).length === 0;

	const resetFilters = () => {
		setQuery('');
		setSortBy({ column: 'added', direction: 'desc' });
		router.push(`/library?page=1`);
	};

	// Remove the initialize function as we're using cached data now

	return (
		<div className="mx-1 my-0 flex min-h-screen flex-col bg-gray-900 text-gray-100">
			<Head>
				<title>Debrid Media Manager - Library</title>
			</Head>
			<Toaster position="bottom-right" />
			<div className="flex flex-1 flex-col">
				<div className="sticky top-0 z-20 bg-gray-900 pb-2">
					<div className="mb-1 flex items-center justify-between pt-2">
						<div className="flex items-center gap-2">
							<h1
								className="text-xl font-bold text-white"
								onDoubleClick={backupOldWeekData}
								style={{ cursor: 'default' }}
							>
								<BookOpen className="mr-1 inline-block h-5 w-5 text-cyan-400" />
								Library{' '}
								<LibrarySize
									torrentCount={userTorrentsList.length}
									totalBytes={totalBytes}
									isLoading={isFetching}
								/>
								{selectedTorrents.size > 0 && (
									<span className="ml-2 text-sm font-normal text-cyan-400">
										({selectedTorrents.size}/{filteredList.length} selected)
									</span>
								)}
							</h1>
							<div className="flex items-center gap-2">
								<span className="text-xs text-gray-500">{lastFetchLabel}</span>
								<button
									onClick={refreshLibrary}
									disabled={isFetching}
									className={`rounded-full p-1.5 transition-all ${
										isFetching
											? 'cursor-not-allowed bg-gray-700 text-gray-500'
											: cacheError
												? 'bg-red-900/50 text-red-400 hover:bg-red-800/50'
												: 'bg-cyan-900/50 text-cyan-400 hover:bg-cyan-800/50 hover:text-cyan-300'
									}`}
									title={cacheError ? `Retry (${cacheError})` : 'Refresh library'}
								>
									<svg
										className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
										/>
									</svg>
								</button>
							</div>
						</div>
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
						maxPages={Math.ceil(sortedData.length / ITEMS_PER_PAGE)}
						onPrevPage={handlePrevPage}
						onNextPage={handleNextPage}
						onResetFilters={resetFilters}
						sameHashSize={sameHash.size}
						sameTitleSize={sameTitle.size}
						selectedTorrentsSize={selectedTorrents.size}
						uncachedCount={uncachedAdIDs.length + uncachedRdHashes.size}
						inProgressCount={memoInProgressCount}
						slowCount={memoSlowCount}
						failedCount={memoFailedCount}
					/>
					<LibraryActionButtons
						onSelectShown={() => selectShown(currentPageData, setSelectedTorrents)}
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
						tbKey={tbKey}
						showDedupe={
							router.query.status === 'sametitle' ||
							(!!titleFilter && filteredList.length > 1)
						}
						showHashCombine={
							router.query.status === 'samehash' ||
							(!!hashFilter && filteredList.length > 1)
						}
					/>
				</div>
				<div className="flex-1 overflow-hidden">
					<div className="h-full overflow-y-auto pb-6">
						<div className="overflow-x-auto">
							{loading || grouping ? (
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
										{currentPageData.map((torrent) => (
											<LibraryTorrentRow
												key={torrent.id}
												torrent={torrent}
												rdKey={rdKey}
												adKey={adKey}
												tbKey={tbKey}
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
													// Use optimistic update from cache
													removeFromCache(id);
													setSelectedTorrents((prev) => {
														const newSet = new Set(prev);
														newSet.delete(id);
														return newSet;
													});
												}}
												onRefreshLibrary={refreshLibrary}
												onShowInfo={async (t) => {
													if (t.id.startsWith('rd:') && rdKey) {
														const info = await getTorrentInfo(
															rdKey,
															t.id.substring(3)
														);
														if (
															t.status ===
																UserTorrentStatus.waiting ||
															t.status ===
																UserTorrentStatus.downloading
														) {
															const selectedFiles = info.files.filter(
																(f: RDFileInfo) => f.selected === 1
															);
															updateInCache(t.id, {
																progress: info.progress,
																seeders: info.seeders,
																speed: info.speed,
																status: getRdStatus(info),
																serviceStatus: info.status,
																links: info.links,
																selectedFiles: selectedFiles.map(
																	(
																		f: RDFileInfo,
																		idx: number
																	) => ({
																		fileId: f.id,
																		filename: f.path,
																		filesize: f.bytes,
																		link:
																			selectedFiles.length ===
																			info.links.length
																				? info.links[idx]
																				: '',
																	})
																),
															});
															await torrentDB.add(t);
														}
														// Show the info dialog
														await handleShowInfoForRD(
															t,
															rdKey,
															setUserTorrentsList,
															torrentDB,
															setSelectedTorrents
														);
													} else if (t.id.startsWith('ad:') && adKey) {
														await handleShowInfoForAD(t, adKey);
													} else if (t.id.startsWith('tb:') && tbKey) {
														// For now, show basic info for TorBox torrents
														console.log('TorBox torrent info:', t);
														// TODO: Implement detailed TorBox info modal
														alert(
															`TorBox torrent: ${t.title}\nStatus: ${t.serviceStatus}\nProgress: ${t.progress}%\nSize: ${(t.bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
														);
													} else {
														console.error(
															'Cannot show info: missing debrid service key'
														);
													}
												}}
												onTypeChange={(t) => {
													// Update in cache optimistically
													updateInCache(t.id, { mediaType: t.mediaType });
													// Also update in database
													handleChangeType(
														t,
														setUserTorrentsList,
														torrentDB
													);
												}}
											/>
										))}
									</tbody>
								</table>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default withAuth(TorrentsPage);
