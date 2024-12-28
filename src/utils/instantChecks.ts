import { MagnetFile, adInstantCheck } from '@/services/allDebrid';
import { EnrichedHashlistTorrent, FileData, SearchResult } from '@/services/mediasearch';
import { Dispatch, SetStateAction } from 'react';
import { toast } from 'react-hot-toast';
import { checkAvailability, checkAvailabilityByHashes } from './availability';
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

// Rate limiter for RD requests - 10 requests per 10 seconds
const rdRequestTimestamps: number[] = [];
const MAX_REQUESTS = 10;
const TIME_WINDOW = 10000; // 10 seconds in milliseconds

async function waitForRateLimit() {
	const now = Date.now();
	// Remove timestamps older than the time window
	while (rdRequestTimestamps.length > 0 && rdRequestTimestamps[0] < now - TIME_WINDOW) {
		rdRequestTimestamps.shift();
	}

	// If we've hit the rate limit, wait until we can make another request
	if (rdRequestTimestamps.length >= MAX_REQUESTS) {
		const oldestTimestamp = rdRequestTimestamps[0];
		const waitTime = oldestTimestamp + TIME_WINDOW - now;
		if (waitTime > 0) {
			await new Promise((resolve) => setTimeout(resolve, waitTime));
			return waitForRateLimit(); // Recheck after waiting
		}
	}

	// Add current timestamp
	rdRequestTimestamps.push(now);
}

// Generic RD instant check function without IMDB constraint
const processRdInstantCheckByHashes = async <T extends SearchResult | EnrichedHashlistTorrent>(
	dmmProblemKey: string,
	solution: string,
	hashes: string[],
	batchSize: number,
	setTorrentList: Dispatch<SetStateAction<T[]>>,
	sortFn?: (results: T[]) => T[],
	shouldUpdateTitleAndSize = false
): Promise<number> => {
	let instantCount = 0;
	const funcs = [];

	for (const hashGroup of groupBy(batchSize, hashes)) {
		funcs.push(async () => {
			await waitForRateLimit();
			const resp = await checkAvailabilityByHashes(dmmProblemKey, solution, hashGroup);
			setTorrentList((prevSearchResults) => {
				const newSearchResults = [...prevSearchResults];
				for (const torrent of newSearchResults) {
					if (torrent.noVideos) continue;
					const availableTorrent = resp.available.find(
						(t: { hash: string }) => t.hash === torrent.hash
					);
					if (!availableTorrent) continue;

					torrent.files = availableTorrent.files.map(
						(file: { file_id: number; path: string; bytes: number }) => ({
							fileId: file.file_id,
							filename: file.path,
							filesize: file.bytes,
						})
					);

					if (shouldUpdateTitleAndSize) {
						updateTorrentTitle(torrent as SearchResult, torrent.files);
						(torrent as SearchResult).fileSize =
							torrent.files.reduce((acc, curr) => acc + curr.filesize, 0) /
							1024 /
							1024;
					}

					const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
					const stats = calculateFileStats(videoFiles);
					Object.assign(torrent, stats);

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

// Generic RD instant check function
const processRdInstantCheck = async <T extends SearchResult | EnrichedHashlistTorrent>(
	dmmProblemKey: string,
	solution: string,
	imdbId: string,
	hashes: string[],
	batchSize: number,
	setTorrentList: Dispatch<SetStateAction<T[]>>,
	sortFn?: (results: T[]) => T[],
	shouldUpdateTitleAndSize = false
): Promise<number> => {
	let instantCount = 0;
	const funcs = [];

	for (const hashGroup of groupBy(batchSize, hashes)) {
		funcs.push(async () => {
			await waitForRateLimit();
			const resp = await checkAvailability(dmmProblemKey, solution, imdbId, hashGroup);
			setTorrentList((prevSearchResults) => {
				const newSearchResults = [...prevSearchResults];
				for (const torrent of newSearchResults) {
					if (torrent.noVideos) continue;
					const availableTorrent = resp.available.find(
						(t: { hash: string }) => t.hash === torrent.hash
					);
					if (!availableTorrent) continue;

					torrent.files = availableTorrent.files.map(
						(file: { file_id: number; path: string; bytes: number }) => ({
							fileId: file.file_id,
							filename: file.path,
							filesize: file.bytes,
						})
					);

					if (shouldUpdateTitleAndSize) {
						updateTorrentTitle(torrent as SearchResult, torrent.files);
						(torrent as SearchResult).fileSize =
							torrent.files.reduce((acc, curr) => acc + curr.filesize, 0) /
							1024 /
							1024;
					}

					const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
					const stats = calculateFileStats(videoFiles);
					Object.assign(torrent, stats);

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
	dmmProblemKey: string,
	solution: string,
	imdbId: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processRdInstantCheck(dmmProblemKey, solution, imdbId, hashes, 20, setTorrentList, sortFn);

export const instantCheckAnimeInRd = (
	dmmProblemKey: string,
	solution: string,
	rdKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processRdInstantCheck(dmmProblemKey, solution, '', hashes, 20, setTorrentList, sortFn, true);

export const instantCheckInRd2 = (
	dmmProblemKey: string,
	solution: string,
	rdKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
) => processRdInstantCheckByHashes(dmmProblemKey, solution, hashes, 20, setTorrentList);

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
