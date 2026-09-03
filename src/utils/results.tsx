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
	) : id.startsWith('pm:') ? (
		<span className="bg-[#aa0000] text-xs text-white">PM</span>
	) : id.startsWith('oc:') ? (
		<span className="bg-[#f97316] text-xs text-black">OC</span>
	) : id.startsWith('dl:') ? (
		<span className="bg-[#38bdf8] text-xs text-black">DL</span>
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

/**
 * Whether any service the user holds can play this row right now.
 *
 * **Debrid-Link is deliberately not here, and must not be added.** It publishes
 * no cache probe at all (`/seedbox/cached` is disabled and nothing replaced it),
 * so there is no `dlAvailable` to read - a field would have to be permanently
 * false, which would tell this function, the cached/uncached sorts and the
 * `is:cached` filter that a Debrid-Link user's playable rows are uncached.
 * Debrid-Link's add button is offered on every row instead, and the add itself
 * is the probe.
 */
export const isAvailable = (result: SearchResult) =>
	!!(
		result.rdAvailable ||
		result.adAvailable ||
		result.tbAvailable ||
		result.pmAvailable ||
		result.ocAvailable
	);

/**
 * Biggest video file, in MB. Only a debrid availability check knows the per-file
 * breakdown, so an unchecked row falls back to the torrent total.
 */
const biggestVideoSize = (result: SearchResult) =>
	result.biggestFileSize > 0 ? result.biggestFileSize : totalFileSize(result);

/**
 * Average video file, in MB - the per-episode size a season pack works out to.
 * Uses the mean of the actual video files when an availability check has filled
 * them in, and divides the total by the video count otherwise.
 */
const meanVideoSize = (result: SearchResult) => {
	if (result.meanFileSize && result.meanFileSize > 0) return result.meanFileSize;
	const total = totalFileSize(result);
	return result.videoCount > 0 ? total / result.videoCount : total;
};

/**
 * Cached rows come first, then uncached, both biggest to smallest.
 *
 * The two groups rank on different measures on purpose: a cached row is one the
 * user can play right now, so it ranks on the size of what they would actually
 * watch (the biggest file for a movie, the average episode for a season). An
 * uncached row has no per-file breakdown to rank on, so it ranks on the total.
 */
const compareBySize = (
	a: SearchResult,
	b: SearchResult,
	cachedSize: (result: SearchResult) => number
) => {
	const aAvailable = isAvailable(a);
	const bAvailable = isAvailable(b);
	if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;

	const sizeOf = aAvailable ? cachedSize : totalFileSize;
	return sizeOf(b) - sizeOf(a);
};

export const sortByMean = (searchResults: SearchResult[]): SearchResult[] => {
	searchResults.sort((a, b) => {
		const bySize = compareBySize(a, b, meanVideoSize);
		if (bySize !== 0) return bySize;

		// If sizes are equal, sort by video count
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
		const bySize = compareBySize(a, b, biggestVideoSize);
		if (bySize !== 0) return bySize;

		// Third priority: hash (alphabetically)
		return a.hash.localeCompare(b.hash);
	});
	return searchResults;
};
