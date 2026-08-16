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
	// mean of the video files - only known once an availability check has run
	meanFileSize?: number;
	videoCount: number;
	imdbId?: string;
	// a completed TB → RD transfer already exists for this hash (its content is
	// in RD under a different, rewritten hash), so the "TB → RD" button is redundant
	tbTransferred?: boolean;
	// tracker stats (optional)
	trackerStats?: {
		seeders: number;
		leechers: number;
		downloads: number;
		hasActivity: boolean;
	};
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
	tbAvailable: boolean; // TorBox
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

/**
 * Returns true if the title contains meaningful content beyond video-technical tags.
 * Rejects titles like "1080p", "720p x265", "WEB-DL", etc.
 */
export function hasSubstantialTitle(title: string): boolean {
	if (!title || !title.trim()) return false;
	const stripped = title
		.replace(/\b\d{3,4}p\b/gi, '')
		.replace(/\b(4k|x26[45]|h\.?26[45]|hevc|avc)\b/gi, '')
		.replace(/\b(web[-.]?dl|blu[-.]?ray|bdrip|hdrip|hdtv|webrip|dvdrip)\b/gi, '')
		.replace(/\b(hdr10?|sdr|10bit|8bit|aac|ac3|dts|dd5\.?1|atmos|truehd|flac|mp3)\b/gi, '')
		.replace(/\b(remux|proper|repack|internal|limited)\b/gi, '')
		.replace(/[.\-_\[\](){}]/g, ' ')
		.trim();
	// Must have 2+ consecutive alphabetical characters OR a season/episode code
	return /[a-z]{2}/i.test(stripped) || /s\d+e\d+/i.test(stripped);
}
