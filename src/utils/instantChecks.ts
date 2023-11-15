import { AdInstantAvailabilityResponse, MagnetFile, adInstantCheck } from '@/services/allDebrid';
import { SearchResult } from '@/services/mediasearch';
import { RdInstantAvailabilityResponse, rdInstantCheck } from '@/services/realDebrid';
import { Dispatch, SetStateAction } from 'react';
import { toast } from 'react-hot-toast';
import { groupBy } from './groupBy';
import { isVideo } from './selectable';
import { searchToastOptions } from './toastOptions';

export const wrapLoading = function (debrid: string, checkAvailability: Promise<number>) {
	toast.promise(
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
	setSearchResults: Dispatch<SetStateAction<SearchResult[]>>
): Promise<number> => {
	let instantCount = 0;
	const setInstantFromRd = (resp: RdInstantAvailabilityResponse) => {
		setSearchResults((prevSearchResults) => {
			const newSearchResults = [...prevSearchResults];
			for (const torrent of newSearchResults) {
				if (torrent.noVideos) continue;
				if (torrent.hash in resp === false) continue;
				if ('rd' in resp[torrent.hash] === false) continue;
				const variants = resp[torrent.hash]['rd'];
				if (!variants.length) continue;
				torrent.noVideos = variants.reduce((noVideo, variant) => {
					if (!noVideo) return false;
					return !Object.values(variant).some((file) => isVideo({ path: file.filename }));
				}, true);
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

	for (const hashGroup of groupBy(100, hashes)) {
		if (rdKey) await rdInstantCheck(rdKey, hashGroup).then(setInstantFromRd);
	}

	return instantCount;
};

export const instantCheckInAd = async (
	adKey: string,
	hashes: string[],
	setSearchResults: Dispatch<SetStateAction<SearchResult[]>>
): Promise<number> => {
	let instantCount = 0;
	const setInstantFromAd = (resp: AdInstantAvailabilityResponse) => {
		setSearchResults((prevSearchResults) => {
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

	for (const hashGroup of groupBy(100, hashes)) {
		if (adKey) await adInstantCheck(adKey, hashGroup).then(setInstantFromAd);
	}
	return instantCount;
};
