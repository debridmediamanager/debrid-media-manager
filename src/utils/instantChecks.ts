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
import { tbInstantCheck } from '@/services/torbox'

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
	for (const hashGroup of groupBy(20, hashes)) {
		const resp = await rdInstantCheck(rdKey, hashGroup);
		setTorrentList((prevSearchResults) => {
			const newSearchResults = [...prevSearchResults];
			for (const torrent of newSearchResults) {
				if (torrent.noVideos) continue;
				if (torrent.hash in resp === false) continue;
				if ('rd' in resp[torrent.hash] === false) continue;
				const variants = resp[torrent.hash]['rd'];
				if (!variants.length) continue;
				const files: Record<number, FileData> = {};
				resp[torrent.hash]['rd'].forEach((variant) => {
					for (const fileId in variant) {
						if (fileId in files === false)
							files[fileId] = { ...variant[fileId], fileId: parseInt(fileId, 10) };
					}
				});
				torrent.files = Object.values(files);
				const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
				const sortedFileSizes = videoFiles
					.map((f) => f.filesize / 1024 / 1024)
					.sort((a, b) => a - b);
				const mid = Math.floor(sortedFileSizes.length / 2);
				torrent.medianFileSize =
					torrent.medianFileSize ?? sortedFileSizes.length % 2 !== 0
						? sortedFileSizes[mid]
						: (sortedFileSizes[mid - 1] + sortedFileSizes[mid]) / 2;
				torrent.biggestFileSize = sortedFileSizes[sortedFileSizes.length - 1];
				torrent.videoCount = videoFiles.filter((f) => isVideo({ path: f.filename })).length;
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
	}

	return instantCount;
};

// for hashlists
export const instantCheckInRd2 = async (
	rdKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
): Promise<number> => {
	let instantCount = 0;
	for (const hashGroup of groupBy(20, hashes)) {
		const resp = await rdInstantCheck(rdKey, hashGroup);
		setTorrentList((prevSearchResults) => {
			const newSearchResults = [...prevSearchResults];
			for (const torrent of newSearchResults) {
				if (torrent.noVideos) continue;
				if (torrent.hash in resp === false) continue;
				if ('rd' in resp[torrent.hash] === false) continue;
				const variants = resp[torrent.hash]['rd'];
				if (!variants.length) continue;
				const files: Record<number, FileData> = {};
				resp[torrent.hash]['rd'].forEach((variant) => {
					for (const fileId in variant) {
						if (fileId in files === false)
							files[fileId] = { ...variant[fileId], fileId: parseInt(fileId, 10) };
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
	}

	return instantCount;
};

// returns non-video hashes because I want to :)
export const checkForUncachedInRd = async (
	rdKey: string,
	torrents: UserTorrent[],
	setUncachedHashes: Dispatch<SetStateAction<Set<string>>>,
	db: UserTorrentDB
): Promise<Set<string>> => {
	const cachedHashes: Set<string> = new Set();
	const nonVideoHashes: Set<string> = new Set();

	// Check if hash is in cached hashes db
	const hashesToCheck: Set<string> = new Set();
	for (const torrent of torrents) {
		const isCached = await db.isRdCached(torrent.hash);
		if (!isCached) {
			hashesToCheck.add(torrent.hash);
		}
	}
	const hashes = Array.from(hashesToCheck);

	const funcs = [];
	for (const hashGroup of groupBy(100, hashes)) {
		funcs.push(async () => {
			const resp = await rdInstantCheck(rdKey, hashGroup);
			for (const hash in resp) {
				// Check if 'rd' key exists in resp[hash]
				if ('rd' in resp[hash] === false) continue;
				const variants = resp[hash]['rd'];
				// Check if variants array is not empty
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
	await runConcurrentFunctions(funcs, 5, 100);
	const uncachedHashes = new Set(hashes.filter((hash) => !cachedHashes.has(hash)));
	setUncachedHashes(uncachedHashes);
	uncachedHashes.size &&
		toast.success(
			`Found ${uncachedHashes.size} uncached torrents in Real-Debrid`,
			searchToastOptions
		);
	return nonVideoHashes;
};

export const instantCheckInAd = async (
	adKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>
): Promise<number> => {
	let instantCount = 0;
	const funcs = [];
	for (const hashGroup of groupBy(100, hashes)) {
		funcs.push(async () => {
			const resp = await adInstantCheck(adKey, hashGroup);
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

					let idx = 0;
					torrent.files = magnetData.files
						.map((file) => {
							if (file.e && file.e.length > 0) {
								return file.e.map((f) => {
									return {
										fileId: idx++,
										filename: f.n,
										filesize: f.s,
									};
								});
							}
							return {
								fileId: idx++,
								filename: file.n,
								filesize: file.s,
							};
						})
						.flat();
					const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
					const sortedFileSizes = videoFiles
						.map((f) => f.filesize / 1024 / 1024)
						.sort((a, b) => a - b);
					const mid = Math.floor(sortedFileSizes.length / 2);
					torrent.medianFileSize =
						torrent.medianFileSize ?? sortedFileSizes.length % 2 !== 0
							? sortedFileSizes[mid]
							: (sortedFileSizes[mid - 1] + sortedFileSizes[mid]) / 2;
					torrent.biggestFileSize = sortedFileSizes[sortedFileSizes.length - 1];
					torrent.videoCount = videoFiles.length;
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
		});
	}
	await runConcurrentFunctions(funcs, 5, 100);
	return instantCount;
};

export const instantCheckInTb = async (
	tbKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<SearchResult[]>>
): Promise<number> => {
	let instantCount = 0;
	const funcs = [];
	for (const hashGroup of groupBy(100, hashes)) {
		funcs.push(async () => {
			const resp = await tbInstantCheck(tbKey, hashGroup);
			
			if (resp === null) {
				return []
			}

			setTorrentList((prevSearchResults) => {
				const newSearchResults = [...prevSearchResults];
				for (const magnetData of resp) {
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

					let idx = 0;
					torrent.files = magnetData.files
						.map((file) => {
							if (file.e && file.e.length > 0) {
								return file.e.map((f) => {
									return {
										fileId: idx++,
										filename: f.name,
										filesize: f.size,
									};
								});
							}
							return {
								fileId: idx++,
								filename: file.name,
								filesize: file.size,
							};
						})
						.flat();

					const videoFiles = torrent.files.filter((f) => isVideo({ path: f.filename }));
					const sortedFileSizes = videoFiles
						.map((f) => f.filesize / 1024 / 1024)
						.sort((a, b) => a - b);
					const mid = Math.floor(sortedFileSizes.length / 2);
					torrent.medianFileSize =
						torrent.medianFileSize ?? sortedFileSizes.length % 2 !== 0
							? sortedFileSizes[mid]
							: (sortedFileSizes[mid - 1] + sortedFileSizes[mid]) / 2;
					torrent.biggestFileSize = sortedFileSizes[sortedFileSizes.length - 1];
					torrent.videoCount = videoFiles.length;
					torrent.noVideos = checkVideoInFiles(magnetData.files);
					if (!torrent.noVideos) {
						torrent.tbAvailable = true;
						instantCount += 1;
					} else {
						torrent.tbAvailable = false;
					}
				}
				return newSearchResults;
			});
		});
	}
	await runConcurrentFunctions(funcs, 5, 100);
	return instantCount;
};

// for hashlists
export const instantCheckInAd2 = async (
	adKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
): Promise<number> => {
	let instantCount = 0;
	const funcs = [];
	for (const hashGroup of groupBy(100, hashes)) {
		funcs.push(async () => {
			const resp = await adInstantCheck(adKey, hashGroup);
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

					let idx = 0;
					torrent.files = magnetData.files
						.map((file) => {
							if (file.e && file.e.length > 0) {
								return file.e.map((f) => {
									return {
										fileId: idx++,
										filename: f.n,
										filesize: f.s,
									};
								});
							}
							return {
								fileId: idx++,
								filename: file.n,
								filesize: file.s,
							};
						})
						.flat();
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
		});
	}
	await runConcurrentFunctions(funcs, 5, 100);
	return instantCount;
};

// for hashlists
export const instantHashListCheckInTb = async (
	tbKey: string,
	hashes: string[],
	setTorrentList: Dispatch<SetStateAction<EnrichedHashlistTorrent[]>>
): Promise<number> => {
	let instantCount = 0;
	const funcs = [];
	for (const hashGroup of groupBy(100, hashes)) {
		funcs.push(async () => {
			const resp = await tbInstantCheck(tbKey, hashGroup);
			
			if (resp === null) {
				return []
			}
			setTorrentList((prevSearchResults) => {
				const newSearchResults = [...prevSearchResults];
				for (const magnetData of resp) {
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

					let idx = 0;
					torrent.files = magnetData.files
						.map((file) => {
							if (file.e && file.e.length > 0) {
								return file.e.map((f) => {
									return {
										fileId: idx++,
										filename: f.name,
										filesize: f.size,
									};
								});
							}
							return {
								fileId: idx++,
								filename: file.name,
								filesize: file.size,
							};
						})
						.flat();
					torrent.noVideos = checkVideoInFiles(magnetData.files);
					if (!torrent.noVideos && magnetData.instant) {
						torrent.tbAvailable = true;
						instantCount += 1;
					} else {
						torrent.tbAvailable = false;
					}
				}
				return newSearchResults;
			});
		});
	}
	await runConcurrentFunctions(funcs, 5, 100);
	return instantCount;
};
