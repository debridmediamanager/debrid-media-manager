import { MagnetFile, adInstantCheck } from '@/services/allDebrid';
import { EnrichedHashlistTorrent, FileData, SearchResult } from '@/services/mediasearch';
import { rdInstantCheck } from '@/services/realDebrid';
import UserTorrentDB from '@/torrent/db';
import { UserTorrent } from '@/torrent/userTorrent';
import { some } from 'lodash';
import { Dispatch, SetStateAction } from 'react';
import { toast } from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { groupBy } from './groupBy';
import { isVideo } from './selectable';
import { searchToastOptions } from './toastOptions';

// Common utility functions
const calculateFileStats = (videoFiles: FileData[]) => {
	const sortedFileSizes = videoFiles.map((f) => f.filesize / 1024 / 1024).sort((a, b) => a - b);
	const mid = Math.floor(sortedFileSizes.length / 2);
	return {
		medianFileSize:
			sortedFileSizes.length % 2 !== 0
				? sortedFileSizes[mid]
				: (sortedFileSizes[mid - 1] + sortedFileSizes[mid]) / 2,
		biggestFileSize: sortedFileSizes[sortedFileSizes.length - 1],
		videoCount: videoFiles.length,
	};
};

const updateTorrentTitle = (torrent: SearchResult, files: FileData[]) => {
	if (files.length >= 2) {
		const filenames = files.map((f) => f.filename);
		let commonPrefix = filenames[0];
		for (let i = 1; i < filenames.length; i++) {
			while (filenames[i].indexOf(commonPrefix) !== 0) {
				commonPrefix = commonPrefix.slice(0, -1);
				if (commonPrefix === '') break;
			}
		}
		if (commonPrefix !== '') {
			torrent.title = `${commonPrefix}X...`;
		}
	} else if (files.length === 1) {
		torrent.title = files[0].filename;
	}
};

// Generic RD instant check function
const processRdInstantCheck = async <T extends SearchResult | EnrichedHashlistTorrent>(
	rdKey: string,
	hashes: string[],
	batchSize: number,
	setTorrentList: Dispatch<SetStateAction<T[]>>,
	sortFn?: (results: T[]) => T[],
	shouldUpdateTitle = false
): Promise<number> => {
	let instantCount = 0;
	const funcs = [];

	for (const hashGroup of groupBy(batchSize, hashes)) {
		funcs.push(async () => {
			const resp = await rdInstantCheck(rdKey, hashGroup);
			setTorrentList((prevSearchResults) => {
				const newSearchResults = [...prevSearchResults];
				for (const torrent of newSearchResults) {
					if (torrent.noVideos) continue;
					if (torrent.hash in resp === false) continue;
					if ('rd' in resp[torrent.hash] === false) continue;
					const variants = resp[torrent.hash]['rd'];
					if (!variants.length) continue;

					const variantWithMostFiles = variants.reduce(
						(prev, curr) =>
							Object.keys(curr).length > Object.keys(prev).length ? curr : prev,
						variants[0]
					);

					const files: Record<number, FileData> = {};
					for (const fileId in variantWithMostFiles) {
						files[fileId] = {
							...variantWithMostFiles[fileId],
							fileId: parseInt(fileId, 10),
						};
					}

					torrent.files = Object.values(files);
					if (shouldUpdateTitle) {
						updateTorrentTitle(torrent as SearchResult, torrent.files);
					}

					const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
					if ('medianFileSize' in torrent) {
						const stats = calculateFileStats(videoFiles);
						Object.assign(torrent, stats);
					}

					torrent.noVideos = !torrent.files.some((file) =>
						isVideo({ path: file.filename })
					);
					if (!torrent.noVideos) {
						torrent.rdAvailable = true;
						instantCount += 1;
					} else {
						torrent.rdAvailable = false;
					}
				}
				return sortFn ? sortFn(newSearchResults) : newSearchResults;
			});
		});
	}
	await runConcurrentFunctions(funcs, 4, 0);
	return instantCount;
};

// Generic AD instant check function
const processAdInstantCheck = async <T extends SearchResult | EnrichedHashlistTorrent>(
	adKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<T[]>>,
	sortFn?: (results: T[]) => T[]
): Promise<number> => {
	let instantCount = 0;
	const funcs = [];

	const checkVideoInFiles = (files: MagnetFile[]): boolean => {
		return files.reduce((noVideo: boolean, curr: MagnetFile) => {
			if (!noVideo) return false;
			if (!curr.n) return false;
			if (curr.e) return checkVideoInFiles(curr.e);
			return !isVideo({ path: curr.n });
		}, true);
	};

	for (const hashGroup of groupBy(100, hashes)) {
		funcs.push(async () => {
			const resp = await adInstantCheck(adKey, hashGroup);
			setTorrentList((prevSearchResults) => {
				const newSearchResults = [...prevSearchResults];
				for (const magnetData of resp.data.magnets) {
					const torrent = newSearchResults.find((r) => r.hash === magnetData.hash);
					if (!torrent || torrent.noVideos || !magnetData.files) continue;

					let idx = 0;
					torrent.files = magnetData.files
						.map((file) => {
							if (file.e && file.e.length > 0) {
								return file.e.map((f) => ({
									fileId: idx++,
									filename: f.n,
									filesize: f.s,
								}));
							}
							return {
								fileId: idx++,
								filename: file.n,
								filesize: file.s,
							};
						})
						.flat();

					if ('medianFileSize' in torrent) {
						const videoFiles = torrent.files.filter((f) =>
							isVideo({ path: f.filename })
						);
						const stats = calculateFileStats(videoFiles);
						Object.assign(torrent, stats);
					}

					torrent.noVideos = checkVideoInFiles(magnetData.files);
					if (!torrent.noVideos && magnetData.instant) {
						torrent.adAvailable = true;
						instantCount += 1;
					} else {
						torrent.adAvailable = false;
					}
				}
				return sortFn ? sortFn(newSearchResults) : newSearchResults;
			});
		});
	}
	await runConcurrentFunctions(funcs, 4, 0);
	return instantCount;
};

// All function definitions should come before exports
const checkForUncachedInRd = async (
	rdKey: string,
	torrents: UserTorrent[],
	setUncachedHashes: Dispatch<SetStateAction<Set<string>>>,
	db: UserTorrentDB
): Promise<Set<string>> => {
	const cachedHashes: Set<string> = new Set();
	const nonVideoHashes: Set<string> = new Set();

	const hashesToCheck: Set<string> = new Set();
	for (const torrent of torrents) {
		const isCached = await db.isRdCached(torrent.hash);
		if (!isCached) {
			hashesToCheck.add(torrent.hash);
		}
	}
	const hashes = Array.from(hashesToCheck);

	const funcs = [];
	for (const hashGroup of groupBy(50, hashes)) {
		funcs.push(async () => {
			const resp = await rdInstantCheck(rdKey, hashGroup);
			for (const hash in resp) {
				if ('rd' in resp[hash] === false) continue;
				const variants = resp[hash]['rd'];
				if (!variants.length) continue;
				let isCached = false,
					allNonVideos = true;
				for (const variant of variants) {
					if (some(Object.values(variant), (file) => isVideo({ path: file.filename }))) {
						allNonVideos = false;
					}
					if (Object.keys(variant).length > 0) {
						isCached = true;
					}
				}
				if (isCached) {
					cachedHashes.add(hash);
					await db.addRdCachedHash(hash);
					if (allNonVideos) {
						nonVideoHashes.add(hash);
					}
				}
			}
		});
	}
	await runConcurrentFunctions(funcs, 4, 0);
	const uncachedHashes = new Set(hashes.filter((hash) => !cachedHashes.has(hash)));
	setUncachedHashes(uncachedHashes);
	uncachedHashes.size &&
		toast.success(
			`Found ${uncachedHashes.size} uncached torrents in Real-Debrid`,
			searchToastOptions
		);
	return nonVideoHashes;
};

// Wrapper functions
export const wrapLoading = async function (debrid: string, checkAvailability: Promise<number>) {
	return await toast.promise(
		checkAvailability,
		{
			loading: `Checking ${debrid} availability...`,
			success: (num) => `Found ${num} available torrents in ${debrid}`,
			error: `There was an error checking availability in ${debrid}. Please try again.`,
		},
		searchToastOptions
	);
};

export const instantCheckInRd = (
	rdKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processRdInstantCheck(rdKey, hashes, 20, setTorrentList, sortFn);

export const instantCheckAnimeInRd = (
	rdKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processRdInstantCheck(rdKey, hashes, 20, setTorrentList, sortFn, true);

export const instantCheckInRd2 = (
	rdKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
) => processRdInstantCheck(rdKey, hashes, 20, setTorrentList);

export const instantCheckInAd = (
	adKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processAdInstantCheck(adKey, hashes, setTorrentList, sortFn);

export const instantCheckInAd2 = (
	adKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
) => processAdInstantCheck(adKey, hashes, setTorrentList);

export { checkForUncachedInRd };
