import type { ScrapeSearchResult } from '@/services/mediasearch';
import { repository } from '@/services/repository';
import ptt from 'parse-torrent-title';

export interface TroveStreamCandidate {
	hash: string;
	title: string;
	sizeMb: number;
}

export interface TroveCandidateOptions {
	mediaType: 'movie' | 'series';
	/** Full Stremio video id for series (`tt…:season:episode`); bare id for movies. */
	imdbId: string;
	/** Cast-setting ceiling in GB, matching `settings:movieMaxSize` and the profile columns; 0 or unset means unbounded. */
	maxSizeGb?: number;
	/** Upper bound on candidates returned. They are the only hashes probed, so this is also the cost bound. */
	maxCount?: number;
}

/** Junk floor shared with the cast pool's `size > 10` filter, in MB. */
const MIN_SIZE_MB = 10;
/**
 * Scraper noise ceiling, in MB. Some rows carry bytes or kilobytes where the
 * column means megabytes (a 1080p WEBRip stored as 29000000 read as 28 TB);
 * no real single-video release is half a terabyte, so anything over this is
 * unit noise, not a candidate.
 */
const MAX_SIZE_MB = 500 * 1024;
/**
 * Titles the detail page hides - its SQL drops Cyrillic-leading names, so the
 * addon must too or it offers releases the page never shows.
 */
const HIDDEN_TITLE_LEAD = /^[А-Яа-яЁё]/;
/** Enough size-ranked releases to fill a 5-stream list many times over on any populated title. */
const DEFAULT_MAX_COUNT = 200;

const isFinitePositive = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Picks the releases a Stremio addon may offer from DMM's scraped pool.
 *
 * Movies pass every release through. Series keep only releases whose *title*
 * names the exact season and episode - the scraped pool carries no file
 * listing, so a season pack cannot be mapped to one episode and stays out.
 */
export function filterTroveCandidates(
	rows: ScrapeSearchResult[] | null | undefined,
	{ mediaType, imdbId, maxSizeGb, maxCount = DEFAULT_MAX_COUNT }: TroveCandidateOptions
): TroveStreamCandidate[] {
	if (!rows || rows.length === 0) return [];

	let season: number | undefined;
	let episode: number | undefined;
	if (mediaType === 'series') {
		const parts = imdbId.split(':');
		if (parts.length !== 3) return [];
		season = Number.parseInt(parts[1], 10);
		episode = Number.parseInt(parts[2], 10);
		if (!Number.isInteger(season) || !Number.isInteger(episode)) return [];
	}

	const ceilingMb = isFinitePositive(maxSizeGb) ? maxSizeGb * 1024 : undefined;

	const candidates: TroveStreamCandidate[] = [];
	const seenSizes = new Set<number>();
	for (const row of rows) {
		if (typeof row?.hash !== 'string' || typeof row?.title !== 'string') continue;
		const sizeMb = row.fileSize;
		if (!isFinitePositive(sizeMb) || sizeMb <= MIN_SIZE_MB) continue;
		if (sizeMb > MAX_SIZE_MB) continue;
		if (HIDDEN_TITLE_LEAD.test(row.title)) continue;
		if (ceilingMb !== undefined && sizeMb > ceilingMb) continue;

		if (season !== undefined && episode !== undefined) {
			const parsed = ptt.parse(row.title);
			// A pack ("S01") or a date-style episode has no episode number to
			// match; anything without both numbers cannot name this video.
			if (parsed.season !== season || parsed.episode !== episode) continue;
		}

		// The same release is routinely scraped under several infohashes with
		// identical sizes. The cast pool deduplicates by size for exactly this
		// reason; the trove does the same or the addon's five slots can hold
		// two copies of one encode.
		const sizeKey = Math.round(sizeMb);
		if (seenSizes.has(sizeKey)) continue;
		seenSizes.add(sizeKey);

		candidates.push({ hash: row.hash, title: row.title, sizeMb });
	}

	// Biggest first, matching the cast pool's ordering and the "Biggest
	// available" default the size settings describe.
	candidates.sort((a, b) => b.sizeMb - a.sizeMb);
	return candidates.slice(0, maxCount);
}

/**
 * The scraped release list behind a DMM detail page, filtered to what the
 * addon may offer. Reads the stored row once; a title DMM has never scraped
 * simply yields nothing.
 */
export async function getTroveCandidates(
	options: TroveCandidateOptions
): Promise<TroveStreamCandidate[]> {
	const key =
		options.mediaType === 'series'
			? `tv:${options.imdbId.split(':')[0]}:${options.imdbId.split(':')[1]}`
			: `movie:${options.imdbId}`;
	return filterTroveCandidates(await repository.getAllScrapedTrueResults(key), options);
}
