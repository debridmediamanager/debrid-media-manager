import { SearchResult } from '@/services/mediasearch';
import { FaDownload, FaFastForward } from 'react-icons/fa';
import { isVideo } from './selectable';

export const borderColor = (downloaded: boolean, downloading: boolean) =>
	downloaded
		? 'border-green-400 border-4'
		: downloading
		? 'border-red-400 border-4'
		: 'border-black border-2';

export const fileSize = (size: number) => (size / 1024).toFixed(2);

export const btnColor = (avail: boolean, noVideos: boolean) =>
	avail ? 'green' : noVideos ? 'gray' : 'blue';

export const btnIcon = (avail: boolean) =>
	avail ? <FaFastForward className="mr-2 inline" /> : <FaDownload className="mr-2 inline" />;

export const sortByFileSize = (searchResults: SearchResult[]): SearchResult[] => {
	const results = searchResults.map((r) => ({
		...r,
		biggestFileSize: Math.max(...r.files.map((f) => f.filesize / 1024 / 1024)),
		fileCount: r.files.filter((f) => isVideo({ path: f.filename })).length,
	}));
	results.sort((a, b) => {
		const aSort = a.fileCount > 0 ? a.biggestFileSize * 1024 : a.fileSize;
		const bSort = b.fileCount > 0 ? b.biggestFileSize * 1024 : b.fileSize;
		if (aSort !== bSort) {
			return bSort - aSort;
		}
		if (a.fileCount !== b.fileCount) {
			return b.fileCount - a.fileCount;
		}
		if (a.fileSize !== b.fileSize) {
			return b.fileSize - a.fileSize;
		}
		return a.title.localeCompare(b.title);
	});
	return results;
};
