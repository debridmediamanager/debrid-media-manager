import { ParsedFilename } from '@ctrl/video-filename-parser';

export type SearchApiResponse = {
	results?: SearchResult[];
	errorMessage?: string;
};

export interface FileData {
	fileId: number;
	filename: string;
	filesize: number;
}

export type SearchResult = {
	title: string;
	fileSize: number;
	hash: string;
	rdAvailable: boolean; // Real Debrid
	adAvailable: boolean; // AllDebrid
	tbAvailable: boolean; // Torbox
	files: FileData[];
	noVideos: boolean;
	// for cached results in RD
	medianFileSize: number;
	biggestFileSize: number;
	videoCount: number;
	imdbId?: string;
};

export interface Hashlist {
	title: string;
	torrents: HashlistTorrent[];
}

export interface HashlistTorrent {
	filename: string;
	hash: string;
	bytes: number;
}

export interface EnrichedHashlistTorrent extends HashlistTorrent {
	title: string;
	score: number;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
	noVideos: boolean;
	rdAvailable: boolean;
	adAvailable: boolean;
	files: FileData[];
}

export type ScrapeSearchResult = Pick<SearchResult, 'title' | 'fileSize' | 'hash'>;

export const flattenAndRemoveDuplicates = (arr: ScrapeSearchResult[][]): ScrapeSearchResult[] => {
	const flattened = arr.reduce((acc, val) => acc.concat(val), []);
	const unique = new Map<string, ScrapeSearchResult>();
	flattened.forEach((item) => {
		if (!unique.has(item.hash)) {
			unique.set(item.hash, item);
		}
	});
	return Array.from(unique.values()).filter((r) => r.hash.match(/^[a-f0-9]{40}$/));
};

export const sortByFileSize = (results: ScrapeSearchResult[]): ScrapeSearchResult[] => {
	results.sort((a, b) => {
		return b.fileSize - a.fileSize;
	});
	return results;
};
