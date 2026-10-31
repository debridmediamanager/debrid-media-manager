import { SearchResult } from '@/services/mediasearch';
import { namedEpisodes } from '@/utils/seasonNaming';
import { isVideo } from '@/utils/selectable';
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
// A scraped size can also be smaller than what the provider lists (a mislabelled
// collection), so the total is never less than the files' sum or the biggest file.
export const totalFileSize = (
	result: Pick<SearchResult, 'fileSize' | 'files' | 'biggestFileSize'>
) => {
	const filesTotal = (result.files ?? []).reduce((acc, f) => acc + (f.filesize || 0), 0);
	return Math.max(result.fileSize || 0, filesTotal / 1024 / 1024, result.biggestFileSize || 0);
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

// `archiveOnly`: the provider lists this hash as a .zip/.rar with no video in
// it, so adding it there yields an archive to unpack rather than a playable file.
export const btnLabel = (avail: boolean, debridService: string, archiveOnly = false) =>
	avail ? (
		<b>Instant {debridService}</b>
	) : archiveOnly ? (
		`DL with ${debridService} (archive)`
	) : (
		`DL with ${debridService}`
	);

/**
 * Whether any service the user holds can play this row right now.
 *
 * `dlAvailable` is only ever set by a Check DL the user pressed. Debrid-Link's
 * probe mutates, so it is not in the page sweep, which means an unchecked row
 * reads here exactly like one no check has run against yet rather than as a
 * claim that Debrid-Link lacks it. A row the check could not get an answer for
 * is left unset for the same reason.
 */
export const isAvailable = (result: SearchResult) =>
	!!(
		result.rdAvailable ||
		result.adAvailable ||
		result.tbAvailable ||
		result.pmAvailable ||
		result.ocAvailable ||
		result.dlAvailable
	);

/**
 * Biggest video file, in MB. Only a debrid availability check knows the per-file
 * breakdown, so an unchecked row falls back to the torrent total.
 */
const biggestVideoSize = (result: SearchResult) =>
	result.biggestFileSize > 0 ? result.biggestFileSize : totalFileSize(result);

/**
 * Median video file, in MB - the per-episode size a season pack works out to.
 * Uses the median of the actual video files when an availability check has filled
 * them in, so an opening, an ending or extras beside the episodes do not drag it
 * down as they do a mean, and divides the total by the video count otherwise.
 */
const medianVideoSize = (result: SearchResult) => {
	if (result.medianFileSize > 0) return result.medianFileSize;
	const total = totalFileSize(result);
	return result.videoCount > 0 ? total / result.videoCount : total;
};

/**
 * The episode size of a cached season pack, in MB: the median of its largest
 * `episodes` videos. A pack can hold more extras than episodes, and then its plain
 * median is an extra (32 MB for a Game of Thrones complete series whose episodes
 * are 3.5-5.5 GB). With no episode count, or no more videos than episodes, it is
 * the median of every video.
 */
export const episodeSize = (result: SearchResult, episodes = 0) => {
	const videos = (result.files ?? [])
		.filter((f) => isVideo({ path: f.filename }))
		.map((f) => f.filesize / 1024 / 1024)
		.sort((a, b) => b - a);
	if (episodes <= 0 || videos.length <= episodes) return medianVideoSize(result);
	const mid = Math.floor(episodes / 2);
	return episodes % 2 ? videos[mid] : (videos[mid - 1] + videos[mid]) / 2;
};

/**
 * Cached rows come first, then uncached, both biggest to smallest.
 *
 * The two groups rank on different measures on purpose: a cached row is one the
 * user can play right now, so it ranks on the size of what they would actually
 * watch (the biggest file for a movie, the median episode for a season). An
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

/**
 * How many episodes a pack holds, for episodeSize: the season's own count, or for
 * a pack of several seasons the counts of every season its episode files name.
 * Seinfeld's complete series on the season 1 page otherwise ranks on its largest 5
 * videos, season 1's count, which are its double episodes; it holds 180. Without
 * a count for each of those seasons it keeps the season's own.
 */
export const packEpisodes = (
	result: SearchResult,
	counts: Record<number, number>,
	season: number
) => {
	const seasons = new Set<number>();
	for (const file of result.files ?? []) {
		if (!isVideo({ path: file.filename })) continue;
		for (const pair of namedEpisodes(file.filename.split('/').pop() ?? '')) {
			const named = Number(pair.split(':')[0]);
			if (named > 0) seasons.add(named);
		}
	}
	const own = counts[season] ?? 0;
	if (seasons.size < 2 || ![...seasons].every((s) => counts[s] > 0)) return own;
	return [...seasons].reduce((total, s) => total + counts[s], 0);
};

export const sortByMedian = (
	searchResults: SearchResult[],
	episodes: number | ((result: SearchResult) => number) = 0
): SearchResult[] => {
	const episodesOf = typeof episodes === 'number' ? () => episodes : episodes;
	const sizes = new Map(searchResults.map((r) => [r, episodeSize(r, episodesOf(r))]));
	searchResults.sort((a, b) => {
		const bySize = compareBySize(a, b, (r) => sizes.get(r)!);
		if (bySize !== 0) return bySize;

		// If sizes are equal, sort by video count
		if (a.videoCount !== b.videoCount) {
			return b.videoCount - a.videoCount;
		}

		// If video counts are equal, sort alphabetically, then by hash so the
		// order never depends on the order rows arrived in
		const titleA = a.title || '';
		const titleB = b.title || '';
		return titleA.localeCompare(titleB) || a.hash.localeCompare(b.hash);
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
