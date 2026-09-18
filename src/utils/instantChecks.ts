import { EnrichedHashlistTorrent, FileData, SearchResult } from '@/services/mediasearch';
import { checkOffcloudCache } from '@/services/offcloud';
import { checkPremiumizeCache } from '@/services/premiumize';
import { checkCachedStatus } from '@/services/torbox';
import { delay } from '@/utils/delay';
import { Dispatch, SetStateAction } from 'react';
import { toast } from 'react-hot-toast';
import {
	checkAvailability,
	checkAvailabilityAd,
	checkAvailabilityAdByHashes,
	checkAvailabilityByHashes,
} from './availability';
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
		meanFileSize: sortedFileSizes.length
			? sortedFileSizes.reduce((acc, size) => acc + size, 0) / sortedFileSizes.length
			: 0,
		videoCount: videoFiles.length,
	};
};

// Debrid services report the exact bytes of every file, so use them to repair a
// missing size. Scraped rows and external addons (Peerflix in particular) often
// report fileSize 0, which otherwise renders as "0.00 GB" forever.
const backfillMissingFileSize = <T extends SearchResult | EnrichedHashlistTorrent>(
	torrent: T,
	files: FileData[]
) => {
	if (!('medianFileSize' in torrent)) return;
	const result = torrent as SearchResult;
	if (result.fileSize > 0) return;
	const total = files.reduce((acc, curr) => acc + (curr.filesize || 0), 0);
	if (total > 0) result.fileSize = total / 1024 / 1024;
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
			await delay(waitTime);
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
	const allAvailable: {
		hash: string;
		files: { file_id: number; path: string; bytes: number }[];
	}[] = [];
	const funcs = [];

	for (const hashGroup of groupBy(batchSize, hashes)) {
		funcs.push(async () => {
			await waitForRateLimit();
			const resp = await checkAvailabilityByHashes(dmmProblemKey, solution, hashGroup);
			allAvailable.push(...resp.available);
		});
	}
	await runConcurrentFunctions(funcs, 4, 0);

	if (allAvailable.length === 0) return 0;

	const availableMap = new Map(allAvailable.map((t) => [t.hash, t]));

	setTorrentList((prevSearchResults) => {
		const newSearchResults = [...prevSearchResults];
		for (const torrent of newSearchResults) {
			if (torrent.noVideos) continue;
			const availableTorrent = availableMap.get(torrent.hash);
			if (!availableTorrent) continue;

			torrent.files = availableTorrent.files.map((file) => ({
				fileId: file.file_id,
				filename: file.path,
				filesize: file.bytes,
			}));
			// RD's own file ids, kept apart from `files` so a later TorBox check
			// overwriting `files` cannot make us cast with TorBox numbering.
			torrent.rdFiles = torrent.files;

			if (shouldUpdateTitleAndSize) {
				updateTorrentTitle(torrent as SearchResult, torrent.files);
				(torrent as SearchResult).fileSize =
					torrent.files.reduce((acc, curr) => acc + curr.filesize, 0) / 1024 / 1024;
			} else {
				backfillMissingFileSize(torrent, torrent.files);
			}

			const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
			const stats = calculateFileStats(videoFiles);
			Object.assign(torrent, stats);

			torrent.noVideos = !torrent.files.some((file) => isVideo({ path: file.filename }));
			if (!torrent.noVideos) {
				torrent.rdAvailable = true;
				instantCount += 1;
			} else {
				torrent.rdAvailable = false;
			}
		}
		return sortFn ? sortFn(newSearchResults) : newSearchResults;
	});

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
	const allAvailable: {
		hash: string;
		files: { file_id: number; path: string; bytes: number }[];
	}[] = [];
	const funcs = [];

	for (const hashGroup of groupBy(batchSize, hashes)) {
		funcs.push(async () => {
			await waitForRateLimit();
			const resp = await checkAvailability(dmmProblemKey, solution, imdbId, hashGroup);
			allAvailable.push(...resp.available);
		});
	}
	await runConcurrentFunctions(funcs, 4, 0);

	if (allAvailable.length === 0) return 0;

	const availableMap = new Map(allAvailable.map((t) => [t.hash, t]));

	setTorrentList((prevSearchResults) => {
		const newSearchResults = [...prevSearchResults];
		for (const torrent of newSearchResults) {
			if (torrent.noVideos) continue;
			const availableTorrent = availableMap.get(torrent.hash);
			if (!availableTorrent) continue;

			torrent.files = availableTorrent.files.map((file) => ({
				fileId: file.file_id,
				filename: file.path,
				filesize: file.bytes,
			}));
			// RD's own file ids, kept apart from `files` so a later TorBox check
			// overwriting `files` cannot make us cast with TorBox numbering.
			torrent.rdFiles = torrent.files;

			if (shouldUpdateTitleAndSize) {
				updateTorrentTitle(torrent as SearchResult, torrent.files);
				(torrent as SearchResult).fileSize =
					torrent.files.reduce((acc, curr) => acc + curr.filesize, 0) / 1024 / 1024;
			} else {
				backfillMissingFileSize(torrent, torrent.files);
			}

			const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
			const stats = calculateFileStats(videoFiles);
			Object.assign(torrent, stats);

			torrent.noVideos = !torrent.files.some((file) => isVideo({ path: file.filename }));
			if (!torrent.noVideos) {
				torrent.rdAvailable = true;
				instantCount += 1;
			} else {
				torrent.rdAvailable = false;
			}
		}
		return sortFn ? sortFn(newSearchResults) : newSearchResults;
	});

	return instantCount;
};

// Generic AD instant check function
// Database-backed AD check with no IMDb ID constraint, for the hashlist page.
//
// This used to call AllDebrid's /magnet/instant directly, but that endpoint was
// removed (it answers 404), and the only remaining way to probe AD's cache is to
// upload the magnet — which mutates the user's account. So availability here
// comes from DMM's own cache, exactly as the RD path does.
const processAdInstantCheckDbByHashes = async <T extends SearchResult | EnrichedHashlistTorrent>(
	dmmProblemKey: string,
	solution: string,
	hashes: string[],
	batchSize: number,
	setTorrentList: Dispatch<SetStateAction<T[]>>,
	sortFn?: (results: T[]) => T[]
): Promise<number> => {
	let instantCount = 0;
	const allAvailable: {
		hash: string;
		files: { file_id: number; path: string; bytes: number }[];
	}[] = [];
	const funcs = [];

	for (const hashGroup of groupBy(batchSize, hashes)) {
		funcs.push(async () => {
			const resp = await checkAvailabilityAdByHashes(dmmProblemKey, solution, hashGroup);
			allAvailable.push(...resp.available);
		});
	}
	await runConcurrentFunctions(funcs, 4, 0);

	if (allAvailable.length === 0) return 0;

	const availableMap = new Map(allAvailable.map((t) => [t.hash.toLowerCase(), t]));

	setTorrentList((prevSearchResults) => {
		const newSearchResults = [...prevSearchResults];
		for (const torrent of newSearchResults) {
			if (torrent.noVideos) continue;
			const availableTorrent = availableMap.get(torrent.hash.toLowerCase());
			if (!availableTorrent) continue;

			torrent.files = availableTorrent.files.map(
				(file: { file_id: number; path: string; bytes: number }) => ({
					fileId: file.file_id,
					filename: file.path,
					filesize: file.bytes,
				})
			);

			if ('medianFileSize' in torrent) {
				const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
				const stats = calculateFileStats(videoFiles);
				Object.assign(torrent, stats);
			}
			backfillMissingFileSize(torrent, torrent.files);

			torrent.noVideos = !torrent.files.some((file) => isVideo({ path: file.filename }));
			if (!torrent.noVideos) {
				torrent.adAvailable = true;
				instantCount += 1;
			} else {
				torrent.adAvailable = false;
			}
		}
		return sortFn ? sortFn(newSearchResults) : newSearchResults;
	});

	return instantCount;
};

// Database-backed AD instant check function (similar to RD)
const processAdInstantCheckDb = async <T extends SearchResult | EnrichedHashlistTorrent>(
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
	const allAvailable: {
		hash: string;
		files: { file_id: number; path: string; bytes: number }[];
	}[] = [];
	const funcs = [];

	// AD rate limiter - 500 requests per minute (buffer from 600)
	const adRequestTimestamps: number[] = [];
	const AD_MAX_REQUESTS = 500;
	const AD_TIME_WINDOW = 60000; // 1 minute

	async function waitForAdRateLimit() {
		const now = Date.now();
		while (adRequestTimestamps.length > 0 && adRequestTimestamps[0] < now - AD_TIME_WINDOW) {
			adRequestTimestamps.shift();
		}

		if (adRequestTimestamps.length >= AD_MAX_REQUESTS) {
			const oldestTimestamp = adRequestTimestamps[0];
			const waitTime = oldestTimestamp + AD_TIME_WINDOW - now;
			if (waitTime > 0) {
				await delay(waitTime);
				return waitForAdRateLimit();
			}
		}

		adRequestTimestamps.push(now);
	}

	for (const hashGroup of groupBy(batchSize, hashes)) {
		funcs.push(async () => {
			await waitForAdRateLimit();
			const resp = await checkAvailabilityAd(dmmProblemKey, solution, imdbId, hashGroup);
			allAvailable.push(...resp.available);
		});
	}
	await runConcurrentFunctions(funcs, 4, 0);

	if (allAvailable.length === 0) return 0;

	const availableMap = new Map(allAvailable.map((t) => [t.hash, t]));

	setTorrentList((prevSearchResults) => {
		const newSearchResults = [...prevSearchResults];
		for (const torrent of newSearchResults) {
			if (torrent.noVideos) continue;
			const availableTorrent = availableMap.get(torrent.hash);
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
					torrent.files.reduce((acc, curr) => acc + curr.filesize, 0) / 1024 / 1024;
			} else {
				backfillMissingFileSize(torrent, torrent.files);
			}

			const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
			const stats = calculateFileStats(videoFiles);
			Object.assign(torrent, stats);

			torrent.noVideos = !torrent.files.some((file) => isVideo({ path: file.filename }));
			if (!torrent.noVideos) {
				torrent.adAvailable = true;
				instantCount += 1;
			} else {
				torrent.adAvailable = false;
			}
		}
		return sortFn ? sortFn(newSearchResults) : newSearchResults;
	});

	return instantCount;
};

// Generic TB instant check function
const processTbInstantCheck = async <T extends SearchResult | EnrichedHashlistTorrent>(
	tbKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<T[]>>,
	sortFn?: (results: T[]) => T[]
): Promise<number> => {
	let instantCount = 0;
	const allCachedData: Record<string, any> = {};
	const funcs = [];

	for (const hashGroup of groupBy(100, hashes)) {
		funcs.push(async () => {
			const resp = await checkCachedStatus(
				{
					hash: hashGroup,
					format: 'object',
					list_files: true,
				},
				tbKey
			);

			if (resp.success && resp.data) {
				Object.assign(allCachedData, resp.data as any);
			}
		});
	}
	await runConcurrentFunctions(funcs, 2, 200);

	if (Object.keys(allCachedData).length === 0) return 0;

	setTorrentList((prevSearchResults) => {
		const newSearchResults = [...prevSearchResults];
		for (const torrent of newSearchResults) {
			if (torrent.noVideos) continue;

			const availableTorrent = allCachedData[torrent.hash];
			if (!availableTorrent) continue;

			if (availableTorrent.files && Array.isArray(availableTorrent.files)) {
				// `checkcached` returns a real `id` per file and TorBox's ids are
				// not in listing order - measured 2026-08-24, 50 of 52 files
				// across four season packs resolved to a different file when the
				// array position was sent as the id. Only fall back to the
				// position if TorBox omits the id entirely.
				torrent.files = availableTorrent.files.map((file: any, index: number) => ({
					fileId: typeof file.id === 'number' ? file.id : index,
					filename: file.name,
					filesize: file.size,
				}));
				torrent.tbFiles = torrent.files;

				const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
				const stats = calculateFileStats(videoFiles);
				Object.assign(torrent, stats);
				backfillMissingFileSize(torrent, torrent.files);

				torrent.noVideos = videoFiles.length === 0;
				if (!torrent.noVideos) {
					torrent.tbAvailable = true;
					instantCount += 1;
				} else {
					torrent.tbAvailable = false;
				}
			}
		}
		return sortFn ? sortFn(newSearchResults) : newSearchResults;
	});

	return instantCount;
};

/**
 * Premiumize instant check.
 *
 * Unlike the other three this is a single request for the whole batch - 1,000
 * hashes in one POST, non-destructive, nothing added to the account - so there
 * is no per-hash concurrency to manage here.
 *
 * What it cannot do is fill in `files`. `cache/check` reports one filename and
 * one total size per hash and no file listing at all, so the video count, the
 * median file size and `noVideos` stay at whatever another service worked out.
 * The per-file breakdown for Premiumize comes from `transfer/directdl`, which
 * costs a request per hash and is only worth spending when the user opens a
 * torrent or plays it.
 */
const processPmInstantCheck = async <T extends SearchResult | EnrichedHashlistTorrent>(
	pmKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<T[]>>,
	sortFn?: (results: T[]) => T[]
): Promise<number> => {
	const results = await checkPremiumizeCache(pmKey, hashes);
	const cached = new Map(
		results.filter((r) => r.cached).map((r) => [r.hash.toLowerCase(), r] as const)
	);
	if (cached.size === 0) return 0;

	let instantCount = 0;
	setTorrentList((prevSearchResults) => {
		const newSearchResults = [...prevSearchResults];
		for (const torrent of newSearchResults) {
			if (torrent.noVideos) continue;
			const hit = cached.get(torrent.hash.toLowerCase());
			if (!hit) continue;

			torrent.pmAvailable = true;
			instantCount += 1;

			// Scraped rows and external addons often report no size at all; the
			// cache probe knows the real total even though it lists no files.
			if ('medianFileSize' in torrent && hit.filesize) {
				const result = torrent as SearchResult;
				if (result.fileSize <= 0) result.fileSize = hit.filesize / 1024 / 1024;
			}
		}
		return sortFn ? sortFn(newSearchResults) : newSearchResults;
	});

	return instantCount;
};

/**
 * Offcloud instant check.
 *
 * Like Premiumize this is one non-destructive request for the whole batch -
 * `/cache` swallowed 5,000 hashes in 2.1 s - so there is no per-hash concurrency
 * to manage. Two things make it different from every other probe here:
 *
 *  - **The answer is hits only.** `/cache` returns `cachedItems`, the subset that
 *    was found, with the misses filtered out server-side rather than reported
 *    `false`. `checkOffcloudCache` turns that back into one answer per input by
 *    set membership; nothing here may assume a positional line-up.
 *  - **It carries no sizes and no files.** The `/cache/info` sibling does return
 *    a full listing, but it costs a second request and is only worth spending
 *    when a modal or a cast actually needs the file names, so the sweep never
 *    calls it. `files`, `videoCount`, `medianFileSize` and `noVideos` stay at
 *    whatever another service worked out - and unlike Premiumize's probe there
 *    is not even a total size to repair a missing one with.
 *
 * Offcloud's cached-torrent backend is measured to be Premiumize's storage -
 * same energycdn objects, and a 1000-hash sample answered 203/203 identically on
 * 2026-09-02, symmetric difference zero. The probes are deliberately kept
 * independent anyway: one vendor's outage, key or plan is not the other's.
 */
const processOcInstantCheck = async <T extends SearchResult | EnrichedHashlistTorrent>(
	ocKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<T[]>>,
	sortFn?: (results: T[]) => T[]
): Promise<number> => {
	const results = await checkOffcloudCache(ocKey, hashes);
	const cached = new Set(results.filter((r) => r.cached).map((r) => r.hash.toLowerCase()));
	if (cached.size === 0) return 0;

	let instantCount = 0;
	setTorrentList((prevSearchResults) => {
		const newSearchResults = [...prevSearchResults];
		for (const torrent of newSearchResults) {
			if (torrent.noVideos) continue;
			if (!cached.has(torrent.hash.toLowerCase())) continue;

			torrent.ocAvailable = true;
			instantCount += 1;
		}
		return sortFn ? sortFn(newSearchResults) : newSearchResults;
	});

	return instantCount;
};

// Wrapper functions
export const wrapLoading = async function (debrid: string, checkAvailability: Promise<number>) {
	return await toast.promise(
		checkAvailability,
		{
			loading: `Checking ${debrid} availability...`,
			success: (num) => `Found ${num} torrents in ${debrid}.`,
			error: `Failed to check ${debrid} availability.`,
		},
		searchToastOptions
	);
};

// Database availability checks - query local cache
export const checkDatabaseAvailabilityRd = (
	dmmProblemKey: string,
	solution: string,
	imdbId: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processRdInstantCheck(dmmProblemKey, solution, imdbId, hashes, 100, setTorrentList, sortFn);

export const checkDatabaseAvailabilityRd2 = (
	dmmProblemKey: string,
	solution: string,
	rdKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
) => processRdInstantCheckByHashes(dmmProblemKey, solution, hashes, 100, setTorrentList);

export const checkDatabaseAvailabilityAd = (
	dmmProblemKey: string,
	solution: string,
	imdbId: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processAdInstantCheckDb(dmmProblemKey, solution, imdbId, hashes, 100, setTorrentList, sortFn);

export const checkDatabaseAvailabilityAd2 = (
	dmmProblemKey: string,
	solution: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
) => processAdInstantCheckDbByHashes(dmmProblemKey, solution, hashes, 100, setTorrentList);

export const checkDatabaseAvailabilityTb = (
	tbKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processTbInstantCheck(tbKey, hashes, setTorrentList, sortFn);

export const checkDatabaseAvailabilityTb2 = (
	tbKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
) => processTbInstantCheck(tbKey, hashes, setTorrentList);

export const checkAvailabilityPm = (
	pmKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processPmInstantCheck(pmKey, hashes, setTorrentList, sortFn);

export const checkAvailabilityPm2 = (
	pmKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
) => processPmInstantCheck(pmKey, hashes, setTorrentList);

export const checkAvailabilityOc = (
	ocKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>,
	sortFn: (searchResults: SearchResult[]) => SearchResult[]
) => processOcInstantCheck(ocKey, hashes, setTorrentList, sortFn);

export const checkAvailabilityOc2 = (
	ocKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
) => processOcInstantCheck(ocKey, hashes, setTorrentList);
