import { useAllDebridApiKey, useRealDebridAccessToken } from '@/hooks/auth';
import { useDownloadsCache } from '@/hooks/cache';
import { deleteMagnet, getMagnetStatus, restartMagnet, uploadMagnet } from '@/services/allDebrid';
import { createShortUrl } from '@/services/hashlists';
import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	getUserTorrentsList,
	selectFiles,
	unrestrictCheck,
} from '@/services/realDebrid';
import { runConcurrentFunctions } from '@/utils/batch';
import { getMediaId } from '@/utils/mediaId';
import { getMediaType, getMediaType2 } from '@/utils/mediaType';
import getReleaseTags from '@/utils/score';
import { getSelectableFiles, isVideoOrSubs } from '@/utils/selectable';
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
	links: string[];
	seeders: number;
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
	const [dupeTitles] = useState<Array<string>>([]);
	const [dupeHashes] = useState<Array<string>>([]);

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

	// fetch list from api
	useEffect(() => {
		const fetchRealDebrid = async () => {
			try {
				if (!rdKey) throw new Error('no_rd_key');

				// Iterate over each page of results from the generator
				for await (let pageOfTorrents of getUserTorrentsList(rdKey)) {
					const torrents = pageOfTorrents.map((torrent) => {
						const mediaType = getMediaType2(torrent.filename, torrent.links.length);
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
						title: getMediaId(info, mediaType, false) || torrent.filename,
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
		if (adKey) fetchAllDebrid();
		else setAdLoading(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [adKey]);

	// aggregate metadata
	useEffect(() => {
		if (rdLoading || adLoading) return;
		setGrouping(true);
		setTotalBytes(0);

		let tmpTotalBytes = 0;
		clearGroupings(movieGrouping);
		clearGroupings(tvGroupingByEpisode);
		const hashes: Map<string, number> = new Map();
		for (const t of userTorrentsList) {
			const key = `${t.filename}|${t.hash}|${t.bytes}`;
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
				dupeHashes.push(key);
			}
			if (t.title in getGroupings(t.mediaType)) {
				if (getGroupings(t.mediaType)[t.title] === 1) dupeTitles.push(t.title);
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
		dupeTitles,
	]);

	// set the list you see
	useEffect(() => {
		if (rdLoading || adLoading || grouping) return;
		setFiltering(true);
		if (hasNoQueryParamsBut('page')) {
			setFilteredList(applyQuickSearch(userTorrentsList));
			selectPlayableFiles(userTorrentsList);
			deleteFailedTorrents(userTorrentsList);
			setFiltering(false);
			setHelpText(
				[
					'Tip: You can use hash lists to share you library with others anonymously. Click on the button, wait for the page to finish processing, and share the link to your friends.',
					'Tip: You can make a local backup of your library by using the "Local backup" button. This will generate a file containing your whole library that you can use to restore your library later.',
					'Tip: You can restore a local backup by using the "Local restore" button. It will only restore the torrents that are not already in your library.',
					'Tip: The quick search box will filter the list by filename and id. You can use multiple words or even regex to filter your library. This way, you can select multiple torrents and delete them at once, or share them as a hash list.',
				][Math.floor(Math.random() * 4)]
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
		if (status === 'dupe') {
			tmpList = tmpList.filter((t) => dupeTitles.includes(t.title));
			setFilteredList(applyQuickSearch(tmpList));
			setHelpText(
				'Torrents shown have the same title parsed from the torrent name. Use "By size" to retain the larger torrent for each title, or "By date" to retain the more recent torrent. Take note: the parser might not work well for multi-season tv show torrents.'
			);
		}
		if (status === 'dupehash') {
			tmpList = tmpList.filter((t) =>
				dupeHashes.includes(`${t.filename}|${t.hash}|${t.bytes}`)
			);
			setFilteredList(applyQuickSearch(tmpList));
			setHelpText(
				'Torrents shown have the same hash and size. These are exact duplicates. Just using the hash still means that they could have different files selected so size is also used for comparison.'
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
		deleteFailedTorrents(tmpList);
		setFiltering(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		router.query,
		userTorrentsList,
		rdLoading,
		adLoading,
		grouping,
		dupeTitles,
		query,
		currentPage,
	]);

	const handleDeleteTorrent = async (id: string, disableToast: boolean = false) => {
		try {
			if (!rdKey && !adKey) throw new Error('no_keys');
			setUserTorrentsList((prevList) => prevList.filter((t) => t.id !== id));
			if (rdKey && id.startsWith('rd:')) await deleteTorrent(rdKey, id.substring(3));
			if (adKey && id.startsWith('ad:')) await deleteMagnet(adKey, id.substring(3));
			if (!disableToast) toast.success(`Torrent deleted (${id})`, libraryToastOptions);
			if (id.startsWith('rd:')) removeFromRdCache(id);
			if (id.startsWith('ad:')) removeFromAdCache(id);
		} catch (error) {
			if (!disableToast) toast.error(`Error deleting torrent (${id})`, libraryToastOptions);
			console.error(error);
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
				comparison = a.links.length - b.links.length;
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

			const selectedFiles = getSelectableFiles(response.files.filter(isVideoOrSubs)).map(
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

	function wrapDeleteFn(t: UserTorrent) {
		return async () => await handleDeleteTorrent(t.id);
	}

	const getKeyByStatus = (status: string) => {
		if (status === 'dupe') return (torrent: UserTorrent) => torrent.info.title;
		return (torrent: UserTorrent) => torrent.hash;
	};

	async function dedupeBySize() {
		if (
			!confirm(
				`This will delete duplicate torrents based on size (bigger size wins). Are you sure?`
			)
		)
			return;
		const getKey = getKeyByStatus(router.query.status as string);
		const dupes: UserTorrent[] = [];
		filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
			let key = getKey(cur);
			if (acc[key]) {
				if (acc[key].bytes < cur.bytes) {
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
		const toDelete = dupes.map(wrapDeleteFn);
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

	async function dedupeByRecency() {
		if (
			!confirm(
				`This will delete duplicate torrents based on recency (recently added wins). Are you sure?`
			)
		)
			return;
		const getKey = getKeyByStatus(router.query.status as string);
		const dupes: UserTorrent[] = [];
		filteredList.reduce((acc: { [key: string]: UserTorrent }, cur: UserTorrent) => {
			let key = getKey(cur);
			if (acc[key]) {
				if (acc[key].added < cur.added) {
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
		const toDelete = dupes.map(wrapDeleteFn);
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

	async function deleteFilteredTorrents() {
		if (
			!confirm(`This will delete the ${filteredList.length} torrents filtered. Are you sure?`)
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
			handleSelectFiles(`rd:${id}`); // add rd: to account for substr(3) in handleSelectFiles
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

	const handleReinsertTorrent = async (oldId: string) => {
		try {
			if (!rdKey) throw new Error('no_rd_key');
			const torrent = userTorrentsList.find((t) => t.id === oldId);
			if (!torrent) throw new Error('no_torrent_found');
			const hash = torrent.hash;
			const id = await addHashAsMagnet(rdKey, hash);
			torrent.id = `rd:${id}`;
			await handleSelectFiles(torrent.id);
			await handleDeleteTorrent(oldId, true);
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
					href="/library?status=dupe&page=1"
					className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded"
				>
					Same title
				</Link>
				<Link
					href="/library?status=dupehash&page=1"
					className="mr-2 mb-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-1 px-1 rounded"
				>
					Same hash&size
				</Link>

				<button
					className={`mr-2 mb-2 bg-orange-700 hover:bg-orange-600 text-white font-bold py-1 px-1 rounded ${
						filteredList.length === 0 ||
						!((router.query.status as string) ?? '').startsWith('dupe')
							? 'opacity-60 cursor-not-allowed'
							: ''
					}`}
					onClick={dedupeBySize}
					disabled={
						filteredList.length === 0 ||
						!((router.query.status as string) ?? '').startsWith('dupe')
					}
				>
					By size
				</button>

				<button
					className={`mr-2 mb-2 bg-orange-700 hover:bg-orange-600 text-white font-bold py-1 px-1 rounded ${
						!query &&
						(filteredList.length === 0 ||
							!((router.query.status as string) ?? '').startsWith('dupe'))
							? 'opacity-60 cursor-not-allowed'
							: ''
					}`}
					onClick={dedupeByRecency}
					disabled={
						!query &&
						(filteredList.length === 0 ||
							!((router.query.status as string) ?? '').startsWith('dupe'))
					}
				>
					By date
				</button>

				<button
					className={`mr-2 mb-2 bg-red-700 hover:bg-red-600 text-white font-bold py-1 px-1 rounded ${
						!query &&
						(filteredList.length === 0 ||
							hasNoQueryParamsBut('mediaType', 'page') ||
							router.query.status === 'dupe')
							? 'opacity-60 cursor-not-allowed'
							: ''
					}`}
					onClick={deleteFilteredTorrents}
					disabled={
						!query &&
						(filteredList.length === 0 ||
							hasNoQueryParamsBut('mediaType', 'page') ||
							router.query.status === 'dupe')
					}
				>
					Delete shown
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
					className={`mr-2 mb-2 bg-yellow-400 hover:bg-yellow-500 text-black py-1 px-1 rounded ${
						hasNoQueryParamsBut('page')
							? 'opacity-60 cursor-not-allowed pointer-events-none'
							: ''
					}`}
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
								.map((torrent) => {
									const groupCount = getGroupings(torrent.mediaType)[
										torrent.title
									];
									const filterText =
										groupCount > 1 && !router.query.filter
											? `${groupCount} of same title`
											: '';
									return (
										<tr
											key={torrent.id}
											className="border-t-2 hover:bg-purple-900"
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
														<Link
															className="text-sm text-green-600 hover:text-green-800"
															href={`/library?filter=${torrent.title}`}
														>
															{filterText}
														</Link>{' '}
														<Link
															target="_blank"
															className="text-sm text-blue-600 hover:text-blue-800"
															href={`/search?query=${torrent.title}`}
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
												{torrent.progress !== 100
													? `${torrent.progress}%`
													: `${torrent.links.length} file${
															torrent.links.length === 1 ? '' : 's'
													  }`}
											</td>
											<td className="border px-4 py-2">
												{new Date(torrent.added).toLocaleString()}
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
