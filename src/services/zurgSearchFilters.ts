import { ScrapeSearchResult } from './mediasearch';

export type ZurgQuality = '4k' | '1080p' | '720p' | 'best' | 'smallest';

export function sortZurgResults(results: ScrapeSearchResult[], quality: ZurgQuality) {
	return [...results].sort((a, b) =>
		quality === 'smallest' ? a.fileSize - b.fileSize : b.fileSize - a.fileSize
	);
}
