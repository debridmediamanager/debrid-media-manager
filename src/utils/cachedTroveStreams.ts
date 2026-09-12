import type { ScrapeSearchResult } from '@/services/mediasearch';
import { repository } from '@/services/repository';
import { MAX_SIZE_MB, MIN_SIZE_MB } from '@/utils/releaseSize';
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
 * The row checks every reader of the scraped pool applies before it looks at
 * what the title names: a usable hash and title, a size that is neither junk
 * nor scraper unit noise, no Cyrillic lead (the detail page's SQL drops those),
 * and the caller's ceiling.
 */
const passesRowHygiene = (
	row: ScrapeSearchResult | undefined,
	ceilingMb: number | undefined
): row is ScrapeSearchResult => {
	if (typeof row?.hash !== 'string' || typeof row?.title !== 'string') return false;
	const sizeMb = row.fileSize;
	if (!isFinitePositive(sizeMb) || sizeMb <= MIN_SIZE_MB) return false;
	if (sizeMb > MAX_SIZE_MB) return false;
	if (HIDDEN_TITLE_LEAD.test(row.title)) return false;
	if (ceilingMb !== undefined && sizeMb > ceilingMb) return false;
	return true;
};

/**
 * Releases that bundle a season's supplements rather than its episodes.
 *
 * `ptt` reads `The.Wire.S03.EXTRAS.1080p` and `The.Wire.S03.SUBPACK` as plain
 * season three with no episode - indistinguishable from a real pack by its
 * numbers alone, and measured so on 2026-09-12. Offering one as the season
 * hands back a disc of deleted scenes.
 */
const SUPPLEMENT_RELEASE = /\b(?:extras?|subpack|sample|subs|subtitles|bonus)\b/i;

/** Half-season packs, which name a season but carry part of it. */
const PARTIAL_SEASON_RELEASE = /\b(?:part|pt)\.?\s*\d+\b/i;

const seasonsOfTitle = (parsed: { season?: number; seasons?: number[] }): number[] => {
	if (Array.isArray(parsed.seasons) && parsed.seasons.length > 0) return parsed.seasons;
	return typeof parsed.season === 'number' ? [parsed.season] : [];
};

const episodesOfTitle = (parsed: { episode?: number; episodes?: number[] }): number[] => {
	if (Array.isArray(parsed.episodes) && parsed.episodes.length > 0) return parsed.episodes;
	return typeof parsed.episode === 'number' ? [parsed.episode] : [];
};

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
		if (!passesRowHygiene(row, ceilingMb)) continue;
		const sizeMb = row.fileSize;

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

/** A release that names one or more whole seasons, with no episode of its own. */
export interface SeasonPackCandidate extends TroveStreamCandidate {
	/** Every season the title claims; a series pack claims several. */
	seasons: number[];
}

/** A release that names specific episodes of one season. */
export interface SeasonEpisodeCandidate extends TroveStreamCandidate {
	/** Every episode the title claims; a two-parter covers both at once. */
	episodes: number[];
}

export interface SeasonFilterOptions {
	season: number;
	maxSizeGb?: number;
	maxCount?: number;
}

/** Packs are few per season and the client only ever tries the first that sticks. */
const DEFAULT_PACK_COUNT = 15;
/** Per episode, not per season: three is enough to survive two false positives. */
const DEFAULT_EPISODE_COUNT = 3;

/**
 * The releases that claim a whole season, biggest first.
 *
 * `ptt` reports a single-season pack as `season: 3` and a series pack as
 * `seasons: [1..5]` with no `season` at all, so reading `season` alone would
 * drop every `S01-S05` release - the ones most likely to answer a whole show
 * in one add. Anything naming an episode is not a pack, and supplement and
 * half-season releases are excluded by name because `ptt` gives no flag for
 * either.
 */
export function filterSeasonPacks(
	rows: ScrapeSearchResult[] | null | undefined,
	{ season, maxSizeGb, maxCount = DEFAULT_PACK_COUNT }: SeasonFilterOptions
): SeasonPackCandidate[] {
	if (!rows || rows.length === 0) return [];
	const ceilingMb = isFinitePositive(maxSizeGb) ? maxSizeGb * 1024 : undefined;

	const candidates: SeasonPackCandidate[] = [];
	const seenSizes = new Set<number>();
	for (const row of rows) {
		if (!passesRowHygiene(row, ceilingMb)) continue;
		if (SUPPLEMENT_RELEASE.test(row.title)) continue;
		if (PARTIAL_SEASON_RELEASE.test(row.title)) continue;

		const parsed = ptt.parse(row.title);
		const seasons = seasonsOfTitle(parsed);
		if (!seasons.includes(season)) continue;
		if (episodesOfTitle(parsed).length > 0) continue;

		const sizeKey = Math.round(row.fileSize);
		if (seenSizes.has(sizeKey)) continue;
		seenSizes.add(sizeKey);

		candidates.push({ hash: row.hash, title: row.title, sizeMb: row.fileSize, seasons });
	}

	candidates.sort((a, b) => b.sizeMb - a.sizeMb);
	return candidates.slice(0, maxCount);
}

/**
 * The season's single-episode releases, bucketed by the episode they name.
 *
 * A release that spans episodes (`S03E01-E03`) is filed under each one it
 * covers, so a run filling gaps can satisfy three of them with one add; the
 * caller reads `episodes` to know what it just got. Sizes are deduplicated per
 * bucket rather than across the season, because consecutive episodes of one
 * encode legitimately weigh the same and a shared set would drop all but one.
 */
export function filterSeasonEpisodes(
	rows: ScrapeSearchResult[] | null | undefined,
	{ season, maxSizeGb, maxCount = DEFAULT_EPISODE_COUNT }: SeasonFilterOptions
): Map<number, SeasonEpisodeCandidate[]> {
	const buckets = new Map<number, SeasonEpisodeCandidate[]>();
	if (!rows || rows.length === 0) return buckets;
	const ceilingMb = isFinitePositive(maxSizeGb) ? maxSizeGb * 1024 : undefined;

	const seenSizesByEpisode = new Map<number, Set<number>>();
	for (const row of rows) {
		if (!passesRowHygiene(row, ceilingMb)) continue;
		if (SUPPLEMENT_RELEASE.test(row.title)) continue;

		const parsed = ptt.parse(row.title);
		if (!seasonsOfTitle(parsed).includes(season)) continue;
		const episodes = episodesOfTitle(parsed);
		if (episodes.length === 0) continue;

		const sizeKey = Math.round(row.fileSize);
		for (const episode of episodes) {
			let seen = seenSizesByEpisode.get(episode);
			if (!seen) {
				seen = new Set<number>();
				seenSizesByEpisode.set(episode, seen);
			}
			if (seen.has(sizeKey)) continue;
			seen.add(sizeKey);

			const bucket = buckets.get(episode) ?? [];
			bucket.push({
				hash: row.hash,
				title: row.title,
				sizeMb: row.fileSize,
				episodes,
			});
			buckets.set(episode, bucket);
		}
	}

	for (const [episode, bucket] of buckets) {
		bucket.sort((a, b) => b.sizeMb - a.sizeMb);
		buckets.set(episode, bucket.slice(0, maxCount));
	}
	return buckets;
}
