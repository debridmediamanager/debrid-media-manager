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
	pmAvailable: boolean; // Premiumize
	files: FileData[];
	// `files` is whichever availability check answered last - the four run
	// concurrently and each overwrites it. Filenames and sizes agree across
	// services, but `fileId` does not: RD numbers files per torrent, TorBox has
	// its own ids that are not in listing order. Anything that sends an id back
	// to a provider (casting an episode) must read that provider's own array.
	rdFiles?: FileData[];
	tbFiles?: FileData[];
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
	pmAvailable: boolean; // Premiumize
	files: FileData[];
	rdFiles?: FileData[];
	tbFiles?: FileData[];
}

export type ScrapeSearchResult = Pick<SearchResult, 'title' | 'fileSize' | 'hash'>;

/**
 * Only real HTML tag names are stripped, never a bare `<...>` run. Release
 * titles legitimately contain angle brackets - `<CHECKMATE>`, `<DVDrip>`,
 * `<---ANT#RAX--->` are all genuine - and a naive /<[^>]+>/ strip destroys them.
 */
const HTML_TAG_NAMES =
	'a|b|i|u|p|br|hr|em|div|span|img|td|tr|th|table|tbody|thead|strong|small|font|ul|ol|li|h[1-6]|center|code|pre|script|style|iframe|button|label';
const HTML_TAG = new RegExp(`<\\/?(?:${HTML_TAG_NAMES})\\b[^>]*>`, 'gi');
// Markup that got cut off mid-tag, e.g. a title truncated inside a download button.
const HTML_TAG_UNCLOSED = new RegExp(`<\\/?(?:${HTML_TAG_NAMES})\\b[^>]*$`, 'i');

/** Only entities actually seen in the corpus; anything else is left verbatim. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	times: '×',
};

const decodeEntitiesOnce = (value: string): string =>
	value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
		if (body[0] === '#') {
			const codePoint =
				body[1] === 'x' || body[1] === 'X'
					? parseInt(body.slice(2), 16)
					: parseInt(body.slice(1), 10);
			if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
			try {
				return String.fromCodePoint(codePoint);
			} catch {
				return match;
			}
		}
		const named = NAMED_ENTITIES[body.toLowerCase()];
		return named === undefined ? match : named;
	});

/**
 * Scraped titles arrive however the source site rendered them. Most adapters
 * never decode, so 253209 stored titles carry raw entities - `Grandma&#039;s
 * Boy` - and a smaller set carry leaked markup where a selector swallowed the
 * surrounding HTML. Both break matching and display, and entity variants of one
 * title read as two different titles when comparing releases.
 */
export const decodeTitle = (title: string): string => {
	if (!title) return title;
	let out = title.replace(HTML_TAG, '').replace(HTML_TAG_UNCLOSED, '');
	// Double-encoded values (`&amp;amp;`) occur; the bound stops a title that
	// legitimately reads "&amp;" from being decoded forever.
	for (let pass = 0; pass < 3; pass++) {
		const next = decodeEntitiesOnce(out);
		if (next === out) break;
		out = next;
	}
	return out.replace(/\s+/g, ' ').trim();
};

/**
 * Hashes that are well-formed hex but can never name a torrent. The sha1 of the
 * empty string is what a scraper produces when a listing carries no magnet at
 * all, and it passed the format check happily - it was stored as the hash of
 * 2110 distinct pages, every one of them a dead result.
 */
const DEGENERATE_HASHES = new Set(['da39a3ee5e6b4b0d3255bfef95601890afd80709', '0'.repeat(40)]);

export const isUsableHash = (hash: string | undefined | null): boolean =>
	!!hash && /^[a-f0-9]{40}$/.test(hash) && !DEGENERATE_HASHES.has(hash);

export const flattenAndRemoveDuplicates = (arr: ScrapeSearchResult[][]): ScrapeSearchResult[] => {
	const flattened = arr.reduce((acc, val) => acc.concat(val), []);
	const unique = new Map<string, ScrapeSearchResult>();
	flattened.forEach((item) => {
		if (!unique.has(item.hash)) {
			unique.set(item.hash, item);
		}
	});
	// Titles are normalised here rather than in each adapter: this runs on the
	// read path too, so the entity-encoded rows already in the table are cleaned
	// up for callers without waiting on a backfill.
	return Array.from(unique.values())
		.filter((r) => isUsableHash(r.hash))
		.map((r) => {
			const title = decodeTitle(r.title);
			return title === r.title ? r : { ...r, title };
		});
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
