import {
	aioStreamsBase,
	scrapeAioStreamsMovie,
	scrapeAioStreamsSeason,
} from '@/services/aiostreams';
import type { ScrapeSearchResult } from '@/services/mediasearch';
import { repository as db } from '@/services/repository';
import { filterByMovieConditions, hasNoBannedTerms, meetsTitleConditions } from '@/utils/checks';
import { DebridioTarget, idIsKind, seasonEpisodes } from '@/utils/debridioBackfill';

/** A page's key, or one episode of it when a Stremio stream request asked for that. */
export type AioStreamsTarget = DebridioTarget & { episode?: number };

// ponytail: one flat day for every title. New releases of a current film can
// wait up to a day to land; shorten it for recent titles if that shows.
export const AIOSTREAMS_TTL_MS = 24 * 60 * 60 * 1000;

const stampKeyOf = (target: AioStreamsTarget) =>
	`aiostreams:refresh:${target.key}` + (target.episode !== undefined ? `:${target.episode}` : '');

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
 * once a day per page (or per episode, from Stremio). Merges, never replaces.
 * The stamp is written before the scrape, so the four web replicas seeing the
 * same title at once send one request, not four; a failed scrape waits for
 * the next day like an empty one. Returns how many releases it handed over.
 */
export async function enrichFromAioStreams(target: AioStreamsTarget): Promise<number> {
	const base = aioStreamsBase();
	if (!base) return 0;
	const stampKey = stampKeyOf(target);
	const stampedAt = await db.getRefreshedAt(stampKey);
	if (stampedAt && Date.now() - stampedAt.getTime() < AIOSTREAMS_TTL_MS) return 0;
	await db.markRefreshed(stampKey);
	if (!(await idIsKind(target))) return 0;

	const keep = await releaseCheck(target.imdbId, target.kind);
	let scrape;
	if (target.kind === 'movie') {
		scrape = await scrapeAioStreamsMovie(base, target.imdbId, keep);
	} else {
		const season = target.season ?? 1;
		const episodes =
			target.episode !== undefined
				? [target.episode]
				: await seasonEpisodes(target.imdbId, season);
		scrape = await scrapeAioStreamsSeason(base, target.imdbId, season, episodes, keep);
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
