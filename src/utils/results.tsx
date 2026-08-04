import { SearchResult } from '@/services/mediasearch';
import { Download, Zap } from 'lucide-react';

export const borderColor = (downloaded: boolean, downloading: boolean) =>
	downloaded
		? 'border-green-400 border-4'
		: downloading
			? 'border-red-400 border-4'
			: 'border-black border-2';

export const fileSize = (size: number) => (size / 1024).toFixed(2);

// Scraped rows and external addons sometimes report no size at all (e.g. Peerflix
// omits the 💾 field on non-cached streams). Once a debrid availability check runs
// we know the real per-file bytes, so fall back to those instead of showing 0.00 GB.
export const totalFileSize = (
	result: Pick<SearchResult, 'fileSize' | 'files' | 'biggestFileSize'>
) => {
	if (result.fileSize > 0) return result.fileSize;
	const filesTotal = (result.files ?? []).reduce((acc, f) => acc + (f.filesize || 0), 0);
	if (filesTotal > 0) return filesTotal / 1024 / 1024;
	return result.biggestFileSize || 0;
};

export const btnColor = (avail: boolean, noVideos: boolean) =>
	avail ? 'green' : noVideos ? 'gray' : 'blue';

export const torrentPrefix = (id: string) =>
	id.startsWith('rd:') ? (
		<span className="bg-[#b5d496] text-xs text-black">RD</span>
	) : id.startsWith('tb:') ? (
		<span className="bg-[#4f46e5] text-xs text-white">TB</span>
	) : (
		<span className="bg-[#fbc730] text-[8px] text-black">AD</span>
	);

export const btnIcon = (avail: boolean) =>
	avail ? (
		<Zap className="mr-2 inline h-3 w-3 text-yellow-400" />
	) : (
		<Download className="mr-2 inline h-3 w-3" />
	);

export const btnLabel = (avail: boolean, debridService: string) =>
	avail ? <b>Instant {debridService}</b> : `DL with ${debridService}`;

export const sortByMedian = (searchResults: SearchResult[]): SearchResult[] => {
	searchResults.sort((a, b) => {
		// First compare availability
		const aAvailable = a.rdAvailable || a.adAvailable || a.tbAvailable;
		const bAvailable = b.rdAvailable || b.adAvailable || b.tbAvailable;
		if (aAvailable !== bAvailable) {
			return bAvailable ? 1 : -1;
		}

		// Sort by medianFileSize
		const aSort = a.videoCount > 0 ? a.medianFileSize : a.fileSize / 1024;
		const bSort = b.videoCount > 0 ? b.medianFileSize : b.fileSize / 1024;
		if (aSort !== bSort) {
			return bSort - aSort;
		}

		// If median sizes are equal, sort by video count
		if (a.videoCount !== b.videoCount) {
			return b.videoCount - a.videoCount;
		}

		// If video counts are equal, sort alphabetically
		const titleA = a.title || '';
		const titleB = b.title || '';
		return titleA.localeCompare(titleB);
	});
	return searchResults;
};

export const sortByBiggest = (searchResults: SearchResult[]): SearchResult[] => {
	searchResults.sort((a, b) => {
		// First compare availability
		const aAvailable = a.rdAvailable || a.adAvailable || a.tbAvailable;
		const bAvailable = b.rdAvailable || b.adAvailable || b.tbAvailable;
		if (aAvailable !== bAvailable) {
			return bAvailable ? 1 : -1;
		}

		// If both have same availability, then sort by size
		const aSort = a.videoCount > 0 ? a.biggestFileSize * 1_000_000 : a.fileSize;
		const bSort = b.videoCount > 0 ? b.biggestFileSize * 1_000_000 : b.fileSize;
		if (aSort !== bSort) {
			return bSort - aSort;
		}

		// Third priority: hash (alphabetically)
		return a.hash.localeCompare(b.hash);
	});
	return searchResults;
};
