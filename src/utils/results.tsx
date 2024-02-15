import { SearchResult } from '@/services/mediasearch';
import { FaDownload, FaFastForward } from 'react-icons/fa';

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
		<span className="text-[8px] text-black bg-[#b5d496]">Real-Debrid</span>
	) : (
		<span className="text-[8px] text-black bg-[#fbc730]">AllDebrid</span>
	);
export const torrentPrefix = (id: string) =>
	id.startsWith('rd:') ? (
		<span className="text-xs text-black bg-[#b5d496]">RD</span>
	) : (
		<span className="text-[8px] text-black bg-[#fbc730]">AD</span>
	);

export const btnIcon = (avail: boolean) =>
	avail ? <FaFastForward className="mr-2 inline" /> : <FaDownload className="mr-2 inline" />;

export const sortByFileSize = (searchResults: SearchResult[]): SearchResult[] => {
	searchResults.sort((a, b) => {
		const aSort = a.videoCount > 0 ? a.medianFileSize * a.videoCount : a.fileSize; // Use medianFileSize for sorting
		const bSort = b.videoCount > 0 ? b.medianFileSize * b.videoCount : b.fileSize; // Use medianFileSize for sorting
		if (aSort !== bSort) {
			return bSort - aSort;
		}
		if (a.videoCount !== b.videoCount) {
			return b.videoCount - a.videoCount;
		}
		if (a.fileSize !== b.fileSize) {
			return b.fileSize - a.fileSize;
		}
		return a.title.localeCompare(b.title);
	});
	return searchResults;
};
