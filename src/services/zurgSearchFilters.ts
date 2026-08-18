import { ScrapeSearchResult } from './mediasearch';

export type ZurgQuality = '4k' | '1080p' | '720p' | 'best' | 'smallest';
export type ZurgReleaseProfile = 'any' | 'quality_releases';

const QUALITY_PATTERNS: Partial<Record<ZurgQuality, RegExp>> = {
	'4k': /2160p/i,
	'1080p': /1080p/i,
	'720p': /720p/i,
};

// Keep this synchronized with the DMM web UI's Quality releases token.
export const QUALITY_RELEASES_PATTERN = /web.?dl|web.?rip|blu.?ray|remux|dovi|hdr10|2160p/i;

export function filterZurgResults(
	results: ScrapeSearchResult[],
	quality: ZurgQuality,
	releaseProfile: ZurgReleaseProfile
): ScrapeSearchResult[] {
	const qualityPattern = QUALITY_PATTERNS[quality];
	return results.filter((result) => {
		if (qualityPattern && !qualityPattern.test(result.title)) return false;
		if (releaseProfile === 'quality_releases' && !QUALITY_RELEASES_PATTERN.test(result.title)) {
			return false;
		}
		return true;
	});
}

export function sortZurgResults(results: ScrapeSearchResult[], quality: ZurgQuality) {
	return [...results].sort((a, b) =>
		quality === 'smallest' ? a.fileSize - b.fileSize : b.fileSize - a.fileSize
	);
}
