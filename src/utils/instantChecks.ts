import { AdInstantAvailabilityResponse, MagnetFile, adInstantCheck } from '@/services/allDebrid';
import { FileData, SearchResult } from '@/services/mediasearch';
import { RdInstantAvailabilityResponse, rdInstantCheck } from '@/services/realDebrid';
import UserTorrentDB from '@/torrent/db';
import { Dispatch, SetStateAction } from 'react';
import { toast } from 'react-hot-toast';
import { runConcurrentFunctions } from './batch';
import { groupBy } from './groupBy';
import { isVideo } from './selectable';
import { searchToastOptions } from './toastOptions';

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

export const instantCheckInRd = async (
	rdKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>
): Promise<number> => {
	let instantCount = 0;
	const setInstantFromRd = (resp: RdInstantAvailabilityResponse) => {
		setTorrentList((prevSearchResults) => {
			const newSearchResults = [...prevSearchResults];
			for (const torrent of newSearchResults) {
				if (torrent.noVideos) continue;
				if (torrent.hash in resp === false) continue;
				if ('rd' in resp[torrent.hash] === false) continue;
				const variants = resp[torrent.hash]['rd'];
				if (!variants.length) continue;
				const files: Record<string, FileData> = {};
				resp[torrent.hash]['rd'].forEach((variant) => {
					for (const fileId in variant) {
						if (fileId in files === false)
							files[fileId] = { ...variant[fileId], fileId };
					}
				});
				torrent.files = Object.values(files);
				torrent.noVideos = !torrent.files.some((file) => isVideo({ path: file.filename }));
				// because it has variants and there's at least 1 video file
				if (!torrent.noVideos) {
					torrent.rdAvailable = true;
					instantCount += 1;
				} else {
					torrent.rdAvailable = false;
				}
			}
			return newSearchResults;
		});
	};

	for (const hashGroup of groupBy(20, hashes)) {
		if (rdKey) await rdInstantCheck(rdKey, hashGroup).then(setInstantFromRd);
	}

	return instantCount;
};

export const checkForUncachedInRd = async (
	rdKey: string,
	hashes: string[],
	setUncachedHashes: Dispatch<SetStateAction<Set<string>>>,
	db: UserTorrentDB
): Promise<void> => {
	const cachedHashes: Set<string> = new Set();
	const setInstantFromRd = async (resp: RdInstantAvailabilityResponse) => {
		for (const hash in resp) {
			// Check if 'rd' key exists in resp[hash]
			if ('rd' in resp[hash] === false) continue;
			const variants = resp[hash]['rd'];
			// Check if variants array is not empty
			if (!variants.length) continue;
			for (const variant of variants) {
				if (Object.keys(variant).length > 0) {
					cachedHashes.add(hash);
					await db.addCachedHash(hash);
					break;
				}
			}
		}
	};

	// Check if hash is in cached hashes db
	for (const hash of hashes.slice()) {
		const isCached = await db.isCached(hash);
		if (isCached) {
			cachedHashes.add(hash);
			hashes.splice(hashes.indexOf(hash), 1);
		}
	}

	const funcs = [];
	for (const hashGroup of groupBy(100, hashes)) {
		if (rdKey)
			funcs.push(async () => {
				const resp = await rdInstantCheck(rdKey, hashGroup);
				await setInstantFromRd(resp);
			});
	}
	await runConcurrentFunctions(funcs, 5, 100);
	const uncachedHashes = new Set(hashes.filter((hash) => !cachedHashes.has(hash)));
	setUncachedHashes(uncachedHashes);
	toast.success(
		`Found ${uncachedHashes.size} uncached torrents in Real-Debrid`,
		searchToastOptions
	);
};

export const instantCheckInAd = async (
	adKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>
): Promise<number> => {
	let instantCount = 0;
	const setInstantFromAd = (resp: AdInstantAvailabilityResponse) => {
		setTorrentList((prevSearchResults) => {
			const newSearchResults = [...prevSearchResults];
			for (const magnetData of resp.data.magnets) {
				const masterHash = magnetData.hash;
				const torrent = newSearchResults.find((r) => r.hash === masterHash);
				if (!torrent) continue;
				if (torrent.noVideos) continue;
				if (!magnetData.files) continue;

				const checkVideoInFiles = (files: MagnetFile[]): boolean => {
					return files.reduce((noVideo: boolean, curr: MagnetFile) => {
						if (!noVideo) return false; // If we've already found a video, no need to continue checking
						if (!curr.n) return false; // If 'n' property doesn't exist, it's not a video
						if (curr.e) {
							// If 'e' property exists, check it recursively
							return checkVideoInFiles(curr.e);
						}
						return !isVideo({ path: curr.n });
					}, true);
				};

				torrent.noVideos = checkVideoInFiles(magnetData.files);
				if (!torrent.noVideos && magnetData.instant) {
					torrent.adAvailable = true;
					instantCount += 1;
				} else {
					torrent.adAvailable = false;
				}
			}
			return newSearchResults;
		});
	};

	const funcs = [];
	for (const hashGroup of groupBy(100, hashes)) {
		if (adKey) funcs.push(() => adInstantCheck(adKey, hashGroup).then(setInstantFromAd));
	}
	await runConcurrentFunctions(funcs, 5, 100);

	return instantCount;
};

export const checkForUncachedInAd = async (
	adKey: string,
	hashes: string[],
	setUncachedHashes: Dispatch<SetStateAction<Set<string>>>,
	db: UserTorrentDB
): Promise<void> => {
	const cachedHashes: Set<string> = new Set();
	const setInstantFromAd = (resp: AdInstantAvailabilityResponse) => {
		for (const magnetData of resp.data.magnets) {
			const masterHash = magnetData.hash;
			if (!magnetData.files) continue;
			if (magnetData.instant) cachedHashes.add(masterHash);
		}
	};

	// Check if hash is in cached hashes db
	for (const hash of hashes.slice()) {
		const isCached = await db.isCached(hash);
		if (isCached) {
			cachedHashes.add(hash);
			hashes.splice(hashes.indexOf(hash), 1);
		}
	}

	const funcs = [];
	for (const hashGroup of groupBy(100, hashes)) {
		if (adKey)
			funcs.push(async () => {
				const resp = await adInstantCheck(adKey, hashGroup);
				await setInstantFromAd(resp);
			});
	}
	await runConcurrentFunctions(funcs, 5, 100);
	const uncachedHashes = new Set(hashes.filter((hash) => !cachedHashes.has(hash)));
	setUncachedHashes(uncachedHashes);
	toast.success(
		`Found ${uncachedHashes.size} uncached torrents in AllDebrid`,
		searchToastOptions
	);
};
