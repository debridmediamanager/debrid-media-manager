import { SearchResult } from '@/services/mediasearch';
import { FaDownload } from 'react-icons/fa';

export const borderColor = (downloaded: boolean, downloading: boolean) =>
	downloaded
		? 'border-green-400 border-4'
		: downloading
			? 'border-red-400 border-4'
			: 'border-black border-2';

export const fileSize = (size: number) => (size / 1024).toFixed(2);

export const btnColor = (avail: boolean, noVideos: boolean) =>
	avail ? 'green' : noVideos ? 'gray' : 'blue';

export const svcColor = (id: string) => (id.startsWith('rd:') ? '[#b5d496]' : '[#fbc730]');

export const torrentTag = (id: string) =>
	id.startsWith('rd:') ? (
		<span className="bg-[#b5d496] text-[8px] text-black">Real-Debrid</span>
	) : (
		<span className="bg-[#fbc730] text-[8px] text-black">AllDebrid</span>
	);
export const torrentPrefix = (id: string) =>
	id.startsWith('rd:') ? (
		<span className="bg-[#b5d496] text-xs text-black">RD</span>
	) : (
		<span className="bg-[#fbc730] text-[8px] text-black">AD</span>
	);

export const btnIcon = (avail: boolean) => (avail ? `⚡` : <FaDownload className="mr-2 inline" />);

export const btnLabel = (avail: boolean, debridService: string) =>
	avail ? <b>Instant {debridService}</b> : `DL with ${debridService}`;

export const sortByMedian = (searchResults: SearchResult[]): SearchResult[] => {
	searchResults.sort((a, b) => {
		// First compare availability
		const aAvailable = a.rdAvailable || a.adAvailable;
		const bAvailable = b.rdAvailable || b.adAvailable;
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
		const aAvailable = a.rdAvailable || a.adAvailable;
		const bAvailable = b.rdAvailable || b.adAvailable;
		if (aAvailable !== bAvailable) {
			return bAvailable ? 1 : -1;
		}

		// If both have same availability, then sort by size
		const aSort = a.videoCount > 0 ? a.biggestFileSize * 1_000_000 : a.fileSize;
		const bSort = b.videoCount > 0 ? b.biggestFileSize * 1_000_000 : b.fileSize;
		if (aSort !== bSort) {
			return bSort - aSort;
		}

		// If sizes are equal, sort by video count
		if (a.videoCount !== b.videoCount) {
			return b.videoCount - a.videoCount;
		}

		// If all else is equal, sort alphabetically (with null check)
		return (a.title || '').localeCompare(b.title || '');
	});
	return searchResults;
};
