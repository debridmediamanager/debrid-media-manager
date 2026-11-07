import {
	aioStreamsBase,
	scrapeAioStreamsMovie,
	scrapeAioStreamsSeason,
} from '@/services/aiostreams';
import type { ScrapeSearchResult } from '@/services/mediasearch';
import { repository as db } from '@/services/repository';
import { filterByMovieConditions, hasNoBannedTerms, meetsTitleConditions } from '@/utils/checks';
import { DebridioTarget, idIsKind } from '@/utils/debridioBackfill';

/** A page, and for a season the episode a Stremio stream request asked for. */
export type AioStreamsTarget = DebridioTarget & { episode?: number };

// ponytail: one flat day for every title. New releases of a current film can
// wait up to a day to land; shorten it for recent titles if that shows.
export const AIOSTREAMS_TTL_MS = 24 * 60 * 60 * 1000;

// The instance is a public one: an hour after launch on 2026-11-07, 84 of 225
// requests failed, 45 of them with 429. Any failure pauses every replica.
export const AIOSTREAMS_COOLDOWN_MS = 15 * 60 * 1000;
const COOLDOWN_KEY = 'aiostreams:cooldown';

const stampKeyOf = (target: AioStreamsTarget) => `aiostreams:refresh:${target.key}`;

const within = (at: Date | null, ms: number) => !!at && Date.now() - at.getTime() < ms;

/**
 * The checks DMM's own scrapers put a name-searched release through: the title
 * and year against IMDb's title or original title, the banned words (`XXX`
 * parodies of the same name), and for a film the movie scraper's conditions
 * (no episode markers, 500 MB to 250 GB). A title IMDb does not have keeps none.
 */
export async function releaseCheck(
	imdbId: string,
	kind: AioStreamsTarget['kind']
): Promise<(release: ScrapeSearchResult) => boolean> {
	const info = await db.getImdbTitleById(imdbId);
	if (!info) return () => false;
	const names = [...new Set([info.title, info.originalTitle].filter(Boolean))] as string[];
	const years = info.year ? [String(info.year)] : [];
	return (release) =>
		names.some(
			(name) =>
				meetsTitleConditions(name, years, release.title) &&
				hasNoBannedTerms(name.toLowerCase(), release.title)
		) &&
		(kind !== 'movie' || filterByMovieConditions([release]).length === 1);
}

/**
 * Adds what AIOStreams knows about a title to its ScrapedTrue page, at most
 * once a day per page: one request, for a season the episode Stremio asked for
 * or the first. Merges, never replaces. The stamp is written before the scrape,
 * so the four web replicas seeing the same title at once send one request, not
 * four; a failed scrape waits for the next day like an empty one and pauses
 * every title for the cooldown. Returns how many releases it handed over.
 */
export async function enrichFromAioStreams(target: AioStreamsTarget): Promise<number> {
	const base = aioStreamsBase();
	if (!base) return 0;
	if (within(await db.getRefreshedAt(COOLDOWN_KEY), AIOSTREAMS_COOLDOWN_MS)) return 0;
	const stampKey = stampKeyOf(target);
	if (within(await db.getRefreshedAt(stampKey), AIOSTREAMS_TTL_MS)) return 0;
	await db.markRefreshed(stampKey);
	if (!(await idIsKind(target))) return 0;

	const keep = await releaseCheck(target.imdbId, target.kind);
	let scrape;
	try {
		scrape =
			target.kind === 'movie'
				? await scrapeAioStreamsMovie(base, target.imdbId, keep)
				: // ponytail: one episode per season a day - packs and that episode's own
					// releases. Ask every episode once the instance is our own.
					await scrapeAioStreamsSeason(
						base,
						target.imdbId,
						target.season ?? 1,
						[target.episode ?? 1],
						keep
					);
	} catch (error) {
		await db.markRefreshed(COOLDOWN_KEY);
		throw error;
	}
	if (scrape.torrents.length > 0) {
		await db.saveScrapedTrueResults(target.key, scrape.torrents, true);
	}
	console.log(`[aiostreams] ${stampKeyOf(target)}: ${scrape.torrents.length} releases`);
	return scrape.torrents.length;
}

/** Fire and forget for request handlers: never throws, never holds the response. */
export function enrichFromAioStreamsInBackground(target: AioStreamsTarget): void {
	enrichFromAioStreams(target).catch((error) =>
		console.warn(
			`[aiostreams] enrich failed for ${stampKeyOf(target)}:`,
			error instanceof Error ? error.message : error
		)
	);
}
