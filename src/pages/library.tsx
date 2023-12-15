import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useDownloadsCache } from '@/hooks/cache';
import { getMagnetStatus, restartMagnet, uploadMagnet } from '@/services/allDebrid';
import { createShortUrl } from '@/services/hashlists';
import {
	addHashAsMagnet,
	getTorrentInfo,
	getUserTorrentsList,
	selectFiles,
	unrestrictCheck,
} from '@/services/realDebrid';
import { AsyncFunction, runConcurrentFunctions } from '@/utils/batch';
import { handleDeleteAdTorrent, handleDeleteRdTorrent } from '@/utils/deleteTorrent';
import { getMediaId } from '@/utils/mediaId';
import { getTypeByName, getTypeByNameAndFileCount } from '@/utils/mediaType';
import getReleaseTags from '@/utils/score';
import { getSelectableFiles, isVideo } from '@/utils/selectable';
import { shortenNumber } from '@/utils/speed';
import { libraryToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import { ParsedFilename, filenameParse } from '@ctrl/video-filename-parser';
import { saveAs } from 'file-saver';
import lzString from 'lz-string';
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
	links: string[];
	seeders: number;
	speed: number;
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
	const [helpText, setHelpText] = useState('');

	// keys
	const rdKey = useRealDebridAccessToken();
	const adKey = useAllDebridApiKey();

	const [movieGrouping] = useState<Record<string, number>>({});
	const [tvGroupingByEpisode] = useState<Record<string, number>>({});
	const [tvGroupingByTitle] = useState<Record<string, number>>({});
	const [sameTitle] = useState<Array<string>>([]);

	// stats
	const [totalBytes, setTotalBytes] = useState<number>(0);

	// cache
	const [_1, rdUtils, rdCacheAdder, removeFromRdCache] = useDownloadsCache('rd');
	const [_2, adUtils, adCacheAdder, removeFromAdCache] = useDownloadsCache('ad');

	const uniqId = (torrent: UserTorrent): string => `${torrent.hash}|${torrent.links.join()}`;

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

				// Iterate over each page of results from the generator
				for await (let pageOfTorrents of getUserTorrentsList(rdKey)) {
					const torrents = pageOfTorrents.map((torrent) => {
						const mediaType = getTypeByNameAndFileCount(
							torrent.filename,
							torrent.links.length
						);
						const info =
							mediaType === 'movie'
								? filenameParse(torrent.filename)
								: filenameParse(torrent.filename, true);
						return {
							score: getReleaseTags(torrent.filename, torrent.bytes / ONE_GIGABYTE)
								.score,
							info,
							mediaType,
							title: getMediaId(info, mediaType, false) || torrent.filename,
							...torrent,
							id: `rd:${torrent.id}`,
							links: torrent.links.map((l) => l.replaceAll('/', '/')),
							seeders: torrent.seeders || 0,
							speed: torrent.speed || 0,
						};
					}) as UserTorrent[]; // Cast the result to UserTorrent[] to ensure type correctness

					// Add the current page of torrents directly to the state
					setUserTorrentsList((prev) => [...prev, ...torrents]);

					// Optionally add to cache or perform any other operation needed with the current page
					rdCacheAdder.many(
						torrents.map((t) => ({
							id: t.id,
							hash: t.hash,
							status: t.status === 'downloaded' ? 'downloaded' : 'downloading',
							progress: t.progress,
						}))
					);
				}
			} catch (error) {
				toast.error('Error fetching user torrents list', libraryToastOptions);
				console.error(error);
			} finally {
				setRdLoading(false);
			}
		};

		if (rdKey && userTorrentsList.length === 0) fetchRealDebrid();
		else setRdLoading(false);

		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey]);

	useEffect(() => {
		const fetchAllDebrid = async () => {
			try {
				if (!adKey) throw new Error('no_ad_key');
				const torrents = (await getMagnetStatus(adKey)).data.magnets.map((torrent) => {
					const mediaType = getTypeByName(torrent.filename);
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
						title: getMediaId(info, mediaType, false) || torrent.filename,
						id: `ad:${torrent.id}`,
						filename: torrent.filename,
						hash: torrent.hash,
						bytes: torrent.size,
						progress:
							torrent.statusCode === 4
								? 100
								: (torrent.downloaded / torrent.size) * 100,
						status,
						added: formattedDate,
						speed: torrent.downloadSpeed || 0,
						links: torrent.links.map((l) => l.link),
					};
				}) as UserTorrent[];

				setUserTorrentsList((prev) => [...prev, ...torrents]);
				adCacheAdder.many(
					torrents.map((t) => ({
						id: t.id,
						hash: t.hash,
						status: t.status === 'downloaded' ? 'downloaded' : 'downloading',
						progress: t.progress,
					}))
				);
			} catch (error) {
				setUserTorrentsList((prev) => [...prev]);
				toast.error('Error fetching AllDebrid torrents list', libraryToastOptions);
				console.error(error);
			} finally {
				setAdLoading(false);
			}
		};
		if (adKey && userTorrentsList.length === 0) fetchAllDebrid();
		else setAdLoading(false);
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
			setFilteredList(applyQuickSearch(userTorrentsList));
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
		let tmpList = userTorrentsList;
		if (status === 'slow') {
			tmpList = tmpList.filter(isSlowOrNoLinks);
			setFilteredList(applyQuickSearch(tmpList));
			setHelpText(
				'The displayed torrents either do not contain any links or are older than one hour and lack any seeders. You can use the "Delete shown" option to remove them.'
			);
		}
		if (status === 'sametitle') {
			tmpList = tmpList.filter((t) => sameTitle.includes(t.title));
			setFilteredList(applyQuickSearch(tmpList));
			setHelpText(
				'Torrents shown have the same title parsed from the torrent name. Use "By size" to retain the larger torrent for each title, or "By date" to retain the more recent torrent. Take note: the parser might not work well for multi-season tv show torrents.'
			);
		}
		if (status === 'non4k') {
			tmpList = tmpList.filter(
				(t) => !/\b2160|\b4k|\buhd|\bdovi|\bdolby.?vision|\bdv|\bremux/i.test(t.filename)
			);
			setFilteredList(applyQuickSearch(tmpList));
			setHelpText('Torrents shown are not high quality based on the torrent name.');
		}
		if (status === '4k') {
			tmpList = tmpList.filter((t) =>
				/\b2160|\b4k|\buhd|\bdovi|\bdolby.?vision|\bdv|\bremux/i.test(t.filename)
			);
			setFilteredList(applyQuickSearch(tmpList));
			setHelpText('Torrents shown are high quality based on the torrent name.');
		}
		if (status === 'inprogress') {
			tmpList = tmpList.filter((t) => t.progress !== 100);
			setFilteredList(applyQuickSearch(tmpList));
			setHelpText('Torrents that are still downloading');
		}
		if (titleFilter) {
			const decodedTitleFilter = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => decodedTitleFilter === t.title);
			setFilteredList(applyQuickSearch(tmpList));
			setHelpText(`Torrents shown have the title "${titleFilter}".`);
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => mediaType === t.mediaType);
			setFilteredList(applyQuickSearch(tmpList));
			setHelpText(
				`Torrents shown are detected as ${mediaType === 'movie' ? 'movies' : 'tv shows'}.`
			);
		}
		selectPlayableFiles(tmpList);
		// deleteFailedTorrents(tmpList);
		setFiltering(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.query, userTorrentsList, rdLoading, adLoading, grouping, query, currentPage]);

	function handleSort(column: typeof sortBy.column) {
		setSortBy({
			column,
			direction: sortBy.column === column && sortBy.direction === 'asc' ? 'desc' : 'asc',
		});
	}

	// given a list, filter by query and paginate
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
			? unfiltered.filter((t) =>
					regexFilters.every((regex) => regex.test(t.filename) || regex.test(t.id))
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

	const handleSelectFiles = async (id: string) => {
		try {
			if (!rdKey) throw new Error('no_rd_key');
			const response = await getTorrentInfo(rdKey, id.substring(3));

			const selectedFiles = getSelectableFiles(response.files.filter(isVideo)).map(
				(file) => file.id
			);
			if (selectedFiles.length === 0) {
				handleDeleteRdTorrent(rdKey, id, removeFromRdCache);
				throw new Error('no_files_for_selection');
			}

			await selectFiles(rdKey, id.substring(3), selectedFiles);
			setUserTorrentsList((prevList) => {
				const newList = [...prevList];
				const index = newList.findIndex((t) => t.id === id);
				if (index > -1) newList[index].status = 'downloading';
				return newList;
			});
			rdCacheAdder.single(id, response.hash, response.status);
		} catch (error) {
			if ((error as Error).message === 'no_files_for_selection') {
				toast.error(`No files for selection, deleting (${id})`, {
					...libraryToastOptions,
					duration: 5000,
				});
			} else {
				toast.error(`Error selecting files (${id})`, libraryToastOptions);
			}
			console.error(error);
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
			toast.error(`Error selecting files on ${errors.length} torrents`, libraryToastOptions);
		}
		if (results.length) {
			toast.success(`Started downloading ${results.length} torrents`, libraryToastOptions);
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
			toast.error(`Error deleting ${errors.length} failed torrents`, libraryToastOptions);
		}
		if (results.length) {
			toast.success(`Deleted ${results.length} failed torrents`, libraryToastOptions);
		}
	}

	async function handleDeleteFailedTorrents() {
		const consent = await Swal.fire({
			title: 'Delete failed torrents',
			text: 'This will delete torrents that have status of error, dead or virus. Are you sure?',
			icon: 'warning',
			showCancelButton: true,
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			confirmButtonText: 'Yes, proceed!',
		});

		if (!consent.isConfirmed) return;

		await deleteFailedTorrents(userTorrentsList);
	}

	function wrapDeleteFn(t: UserTorrent) {
		return async () => {
			if (rdKey && t.id.startsWith('rd:')) {
				await handleDeleteRdTorrent(rdKey, t.id, removeFromRdCache);
			}
			if (adKey && t.id.startsWith('ad:')) {
				await handleDeleteAdTorrent(adKey, t.id, removeFromAdCache);
			}
		};
	}

	const getKeyByStatus = (status: string) => {
		if (status === 'sametitle') return (torrent: UserTorrent) => torrent.info.title;
		return (torrent: UserTorrent) => torrent.hash;
	};

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
		return async () =>
			t.id.startsWith('rd:')
				? await handleReinsertTorrent(t.id)
				: await handleRestartTorrent(t.id);
	}

	async function combineSameHash() {
		if (
			!(
				await Swal.fire({
					title: 'Merge same hash',
					text: 'This will combine completed torrents with identical hashes and select all streamable files. Make sure to backup before doing this. Do you want to proceed?',
					icon: 'warning',
					showCancelButton: true,
					confirmButtonColor: '#3085d6',
					cancelButtonColor: '#d33',
					confirmButtonText: 'Yes, proceed!',
				})
			).isConfirmed
		)
			return;

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

	async function deleteFilteredTorrents() {
		if (
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
		const toDelete = filteredList.map(wrapDeleteFn);
		const [results, errors] = await runConcurrentFunctions(toDelete, 5, 500);
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

	function wrapUnrestrictCheck2(link: string) {
		return async () => await unrestrictCheck(rdKey!, link);
	}

	function wrapUnrestrictCheck(t: UserTorrent) {
		const toCheck = t.links.map(wrapUnrestrictCheck2);
		return async () => await runConcurrentFunctions(toCheck, 5, 500);
	}

	// TODO: use this
	async function checkTorrentsIfUnrestrictable() {
		const toCheck = userTorrentsList.map(wrapUnrestrictCheck);
		const results = await runConcurrentFunctions(toCheck, 5, 500);

		const errors = results.filter((result) => result instanceof Error);
		const successes = results.filter((result) => result);

		if (errors.length) {
			toast.error(`Error checking ${errors.length} torrents`, libraryToastOptions);
		}
		if (successes.length) {
			toast.success(`Checked ${successes.length} torrents`, libraryToastOptions);
		}
		if (!errors.length && !successes.length) {
			toast('No torrents to check', libraryToastOptions);
		}
	}

	function isSlowOrNoLinks(t: UserTorrent) {
		const oldTorrentAge = 3600000; // 1 hour in milliseconds
		const addedDate = new Date(t.added);
		const now = new Date();
		const ageInMillis = now.getTime() - addedDate.getTime();
		return (
			(t.links.length === 0 && t.progress === 100) ||
			(t.progress !== 100 && ageInMillis >= oldTorrentAge && t.seeders === 0)
		);
	}

	async function generateHashList() {
		toast('The hash list will return a 404 for the first 1-2 minutes', {
			...libraryToastOptions,
			duration: 60000,
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
			toast.error(`Error generating hash list, try again later`, libraryToastOptions);
			console.error(error);
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

	const addAsMagnetInRd = async (hash: string) => {
		try {
			if (!rdKey) throw new Error('no_rd_key');
			const id = await addHashAsMagnet(rdKey, hash);
			rdCacheAdder.single(`rd:${id}`, hash, 'downloading');
			handleSelectFiles(`rd:${id}`);
		} catch (error: any) {
			toast.error(`Error adding to RD: ${error.message}`, libraryToastOptions);
			console.error(error);
		}
	};

	const addAsMagnetInAd = async (hash: string) => {
		try {
			if (!adKey) throw new Error('no_ad_key');
			const resp = await uploadMagnet(adKey, [hash]);
			if (resp.data.magnets.length === 0 || resp.data.magnets[0].error)
				throw new Error('no_magnets');
			adCacheAdder.single(`ad:${resp.data.magnets[0].id}`, hash, 'downloading');
		} catch (error: any) {
			toast.error(`Error adding to AD: ${error.message}`, libraryToastOptions);
			console.error(error);
		}
	};

	async function localRestore(debridService: string): Promise<void> {
		const filePicker = document.createElement('input');
		filePicker.type = 'file';
		filePicker.accept = '.json';
		let file: File | null = null;

		filePicker.onchange = (e: Event) => {
			const target = e.target as HTMLInputElement;
			file = target.files ? target.files[0] : new File([], '');
		};
		filePicker.click();

		filePicker.addEventListener('change', async () => {
			if (!file) return;

			const reader: FileReader = new FileReader();
			reader.readAsText(file, 'UTF-8');
			reader.onload = async function (evt: ProgressEvent<FileReader>) {
				const files: any[] = JSON.parse(evt.target?.result as string);
				const utils = debridService === 'rd' ? rdUtils : adUtils;
				const addMagnet = debridService === 'rd' ? addAsMagnetInRd : addAsMagnetInAd;

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
			};
		});
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

	async function handleCopyMagnet(hash: string) {
		const magnet = `magnet:?xt=urn:btih:${hash}`;
		await navigator.clipboard.writeText(magnet);
		toast.success('Copied magnet url to clipboard', libraryToastOptions);
	}

	const handleReinsertTorrent = async (oldId: string) => {
		try {
			if (!rdKey) throw new Error('no_rd_key');
			const torrent = userTorrentsList.find((t) => t.id === oldId);
			if (!torrent) throw new Error('no_torrent_found');
			const hash = torrent.hash;
			const id = await addHashAsMagnet(rdKey, hash);
			torrent.id = `rd:${id}`;
			await handleSelectFiles(torrent.id);
			await handleDeleteRdTorrent(rdKey, oldId, removeFromRdCache, true);
			toast.success(`Torrent reinserted (${oldId}👉${torrent.id})`, libraryToastOptions);
		} catch (error) {
			toast.error(`Error reinserting torrent (${oldId})`, libraryToastOptions);
			console.error(error);
		}
	};

	const handleRestartTorrent = async (id: string) => {
		try {
			if (!adKey) throw new Error('no_ad_key');
			await restartMagnet(adKey, id.substring(3));
			toast.success(`Torrent restarted (${id})`, libraryToastOptions);
		} catch (error) {
			toast.error(`Error restarting torrent (${id})`, libraryToastOptions);
			console.error(error);
		}
	};

	const hasNoQueryParamsBut = (...params: string[]) =>
		Object.keys(router.query).filter((p) => !params.includes(p)).length === 0;

	const showInfo = async (torrent: UserTorrent) => {
		const info = await getTorrentInfo(rdKey!, torrent.id.substring(3));

		let warning = '';
		const isIntact = info.files.filter((f) => f.selected).length === info.links.length;
		// Check if there is a mismatch between files and links
		if (info.progress === 100 && !isIntact) {
			warning = `<p class="text-red-500">Warning: Some files have expired</p>`;
		}

		// Initialize a separate index for the links array
		let linkIndex = 0;

		const filesList = info.files
			.map((file) => {
				let size = file.bytes < 1024 ** 3 ? file.bytes / 1024 ** 2 : file.bytes / 1024 ** 3;
				let unit = file.bytes < 1024 ** 3 ? 'MB' : 'GB';

				let downloadForm = '';

				// Only create a download form for selected files
				if (file.selected && isIntact) {
					downloadForm = `
						<form action="https://real-debrid.com/downloader" method="get" target="_blank" class="inline">
							<input type="hidden" name="links" value="${info.links[linkIndex++]}" />
							<button type="submit" class="ml-1 bg-blue-500 hover:bg-blue-700 text-white font-bold py-0 px-1 rounded text-xs">Download</button>
						</form>
					`;
				}

				// Return the list item for the file, with or without the download form
				return `
					<li class="flex items-center justify-between p-2 hover:bg-yellow-200 rounded ${
						file.selected ? 'bg-yellow-50 font-bold' : 'font-normal'
					}">
						<span class="flex-1 truncate text-blue-600">${file.path}</span>
						<span class="ml-4 text-sm text-gray-700">${size.toFixed(2)} ${unit}</span>
						${downloadForm}
					</li>
			  	`;
			})
			.join('');

		// Handle the display of progress, speed, and seeders as table rows
		const progressRow =
			info.status === 'downloading'
				? `<tr><td class="font-semibold align-left">Progress:</td><td class="align-left">${info.progress.toFixed(
						2
				  )}%</td></tr>`
				: '';
		const speedRow =
			info.status === 'downloading'
				? `<tr><td class="font-semibold align-left">Speed:</td><td class="align-left">${(
						info.speed / 1024
				  ).toFixed(2)} KB/s</td></tr>`
				: '';
		const seedersRow =
			info.status === 'downloading'
				? `<tr><td class="font-semibold align-left">Seeders:</td><td class="align-left">${info.seeders}</td></tr>`
				: '';

		Swal.fire({
			icon: 'info',
			html: `
			<h1 class="text-2xl font-bold mb-4">${info.filename}</h1>
			<div class="overflow-x-auto">
				<table class="table-auto w-full mb-4 text-left">
					<tbody>
						<tr>
							<td class="font-semibold">ID:</td>
							<td>${info.id}</td>
						</tr>
						<tr>
							<td class="font-semibold">Original filename:</td>
							<td>${info.original_filename}</td>
						</tr>
						<tr>
							<td class="font-semibold">Size:</td>
							<td>${(info.bytes / 1024 ** 3).toFixed(2)} GB</td>
						</tr>
						<tr>
							<td class="font-semibold">Original size:</td>
							<td>${(info.original_bytes / 1024 ** 3).toFixed(2)} GB
							</td>
						</tr>
						<tr>
							<td class="font-semibold">Status:</td>
							<td>${info.status}</td>
						</tr>
						${progressRow}
						${speedRow}
						${seedersRow}
						<tr>
							<td class="font-semibold">Added:</td>
							<td>${new Date(info.added).toLocaleString()}</td>
						</tr>
					</tbody>
				</table>
			</div>
			${warning}
			<h2 class="text-xl font-semibold mb-2">Files:</h2>
			<div class="max-h-60 overflow-y-auto mb-4 text-left bg-blue-100 p-4 rounded shadow">
				<ul class="list space-y-1">
					${filesList}
				</ul>
			</div>

				`,
			showConfirmButton: false,
			customClass: {
				popup: 'format-class',
			},
			width: '800px',
		});
	};

	return (
		<div className="mx-4 my-8">
			<Head>
				<title>Debrid Media Manager - Library</title>
			</Head>
			<Toaster position="bottom-right" />
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
			<div className="mb-4 flex">
				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded ${
						currentPage <= 1 ? 'opacity-60 cursor-not-allowed' : ''
					}`}
					onClick={handlePrevPage}
					disabled={currentPage <= 1}
				>
					<FaArrowLeft />
				</button>
				<span className="w-24 text-center">Page {currentPage}</span>
				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded ${
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
					className="mr-2 mb-2 bg-sky-800 hover:bg-sky-700 text-white font-bold py-1 px-1 rounded"
				>
					Only movies
				</Link>
				<Link
					href="/library?mediaType=tv&page=1"
					className="mr-2 mb-2 bg-sky-800 hover:bg-sky-700 text-white font-bold py-1 px-1 rounded"
				>
					Only TV
				</Link>
				<Link
					href="/library?status=slow&page=1"
					className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded"
				>
					No seeds
				</Link>
				<Link
					href="/library?status=sametitle&page=1"
					className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded"
				>
					Same title
				</Link>

				<button
					className={`mr-2 mb-2 bg-orange-700 hover:bg-orange-600 text-white font-bold py-1 px-1 rounded ${
						filteredList.length === 0 ||
						!((router.query.status as string) ?? '').startsWith('same')
							? 'opacity-60 cursor-not-allowed'
							: ''
					}`}
					onClick={dedupeBySize}
					disabled={
						filteredList.length === 0 ||
						!((router.query.status as string) ?? '').startsWith('same')
					}
				>
					By size
				</button>

				<button
					className={`mr-2 mb-2 bg-orange-700 hover:bg-orange-600 text-white font-bold py-1 px-1 rounded ${
						filteredList.length === 0 ||
						!((router.query.status as string) ?? '').startsWith('same')
							? 'opacity-60 cursor-not-allowed'
							: ''
					}`}
					onClick={dedupeByRecency}
					disabled={
						filteredList.length === 0 ||
						!((router.query.status as string) ?? '').startsWith('same')
					}
				>
					By date
				</button>

				<button
					className={`mr-2 mb-2 bg-red-700 hover:bg-red-600 text-white font-bold py-1 px-1 rounded ${
						!query &&
						(filteredList.length === 0 ||
							hasNoQueryParamsBut('mediaType', 'page') ||
							router.query.status === 'same')
							? 'opacity-60 cursor-not-allowed'
							: ''
					}`}
					onClick={deleteFilteredTorrents}
					disabled={
						!query &&
						(filteredList.length === 0 ||
							hasNoQueryParamsBut('mediaType', 'page') ||
							router.query.status === 'same')
					}
				>
					Delete shown
				</button>

				<button
					className={`mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded`}
					onClick={handleDeleteFailedTorrents}
				>
					Delete failed
				</button>

				<button
					className={`mr-2 mb-2 bg-green-700 hover:bg-green-600 text-white font-bold py-1 px-1 rounded`}
					onClick={combineSameHash}
				>
					Merge same hash
				</button>

				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded ${
						filteredList.length === 0 ? 'opacity-60 cursor-not-allowed' : ''
					}`}
					onClick={generateHashList}
					disabled={filteredList.length === 0}
				>
					Share hash list
				</button>
				<button
					className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded ${
						userTorrentsList.length === 0 ? 'opacity-60 cursor-not-allowed' : ''
					}`}
					onClick={localBackup}
					disabled={userTorrentsList.length === 0}
				>
					Local backup
				</button>
				{rdKey && (
					<button
						className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded`}
						onClick={() => localRestore('rd')}
					>
						Local restore to RD
					</button>
				)}
				{adKey && (
					<button
						className={`mr-2 mb-2 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-1 rounded`}
						onClick={() => localRestore('ad')}
					>
						Local restore to AD
					</button>
				)}
				<Link
					href="/library?page=1"
					className={`mr-2 mb-2 bg-yellow-400 hover:bg-yellow-500 text-black py-1 px-1 rounded`}
				>
					Reset
				</Link>
			</div>
			{helpText !== '' && <div className="bg-blue-900">{helpText}</div>}
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
								{/* <th
									className="px-4 py-2 cursor-pointer"
									onClick={() => handleSort('score')}
								>
									QScore{' '}
									{sortBy.column === 'score' &&
										(sortBy.direction === 'asc' ? '↑' : '↓')}
								</th> */}
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
												torrent.id.startsWith('rd:')
													? showInfo(torrent)
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
													onClick={(e) => {
														e.stopPropagation(); // Prevent showInfo when clicking this button
														handleShare(torrent);
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
													}}
												>
													<FaTrash />
												</button>
												<button
													title="Reinsert"
													className="cursor-pointer mr-2 mb-2 text-green-500"
													onClick={(e) => {
														e.stopPropagation(); // Prevent showInfo when clicking this button
														torrent.id.startsWith('rd')
															? handleReinsertTorrent(torrent.id)
															: handleRestartTorrent(torrent.id);
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
