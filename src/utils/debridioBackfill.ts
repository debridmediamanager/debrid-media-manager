import {
	DebridioScrape,
	isDebridioEnabled,
	scrapeDebridioMovie,
	scrapeDebridioSeason,
} from '@/services/debridio';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { getMetadataCache } from '@/services/metadataCache';
import { repository as db } from '@/services/repository';

export type DebridioTarget = {
	imdbId: string;
	// ScrapedTrue key the torrents belong under (movie:{imdbId} / tv:{imdbId}:{season})
	key: string;
	kind: 'movie' | 'series';
	season?: number;
};

// Debridio refreshes its own listings behind a ~5 minute edge cache, but RD
// instant availability drifts slowly; three days keeps refresh traffic near
// zero while the ⚡ markers stay trustworthy.
const AVAILABILITY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const FALLBACK_EPISODE_COUNT = 12;

async function seasonEpisodes(imdbId: string, season: number): Promise<number[]> {
	try {
		const response = await getMetadataCache().getCinemetaSeries(imdbId);
		const videos: Array<{ season?: number; episode?: number }> = response?.meta?.videos ?? [];
		const episodes = videos
			.filter((video) => video.season === season && Number.isInteger(video.episode))
			.map((video) => video.episode as number);
		const unique = [...new Set(episodes)].sort((a, b) => a - b);
		if (unique.length > 0) return unique;
	} catch (error) {
		console.warn(
			'[debridio] episode lookup failed:',
			error instanceof Error ? error.message : error
		);
	}
	return Array.from({ length: FALLBACK_EPISODE_COUNT }, (_, i) => i + 1);
}

async function scrapeFor(target: DebridioTarget): Promise<DebridioScrape> {
	if (target.kind === 'movie') {
		return scrapeDebridioMovie(target.imdbId);
	}
	const season = target.season ?? 1;
	return scrapeDebridioSeason(target.imdbId, season, await seasonEpisodes(target.imdbId, season));
}

async function persist(target: DebridioTarget, scrape: DebridioScrape): Promise<void> {
	if (scrape.torrents.length > 0) {
		// Merge, never replace: btdig/scraps results for the same key stay.
		await db.saveScrapedTrueResults(target.key, scrape.torrents, true);
	}
	if (scrape.available.length > 0) {
		await db.saveInstantAvailability(target.imdbId, scrape.available);
	}
}

/**
 * Synchronous first-fill for a title the external scrapers have not reached.
 * Debridio answers in about a second, so the page gets results on this request
 * instead of a 204 'requested' plus polling. Returns [] when debridio is
 * disabled, another scrape of this title is in flight, or debridio knows
 * nothing - the caller then falls back to the request queue as before.
 */
export async function backfillFromDebridioNow(
	target: DebridioTarget
): Promise<ScrapeSearchResult[]> {
	if (!isDebridioEnabled()) return [];

	const processingKey = `processing:${target.imdbId}`;
	if (await db.keyExists(processingKey)) return [];
	await db.saveScrapedResults(processingKey, []);

	try {
		const scrape = await scrapeFor(target);
		await persist(target, scrape);
		if (scrape.torrents.length === 0) {
			console.log(`[debridio] no results for ${target.kind} ${target.imdbId}`);
		}
		return scrape.torrents;
	} catch (error) {
		console.error(
			'[debridio] backfill failed:',
			error instanceof Error ? error.message : error
		);
		return [];
	} finally {
		// Also clears any queued requested: marker; the handler re-queues it
		// right after this returns when it still wants the heavy scrapers.
		await db.markAsDone(target.imdbId).catch(() => {});
	}
}

/**
 * Availability refresh for titles that already have scrape results, so their ⚡
 * markers survive RD cache turnover. Skips titles whose instant availability
 * was recorded inside the TTL. Returns the promise so callers can await it in
 * tests while production call sites fire and forget.
 */
export async function refreshDebridioAvailabilityInBackground(
	target: DebridioTarget
): Promise<void> {
	if (!isDebridioEnabled()) return;

	try {
		const updatedAt = await db.getInstantAvailabilityUpdatedAt(target.imdbId);
		if (updatedAt && Date.now() - updatedAt.getTime() < AVAILABILITY_TTL_MS) return;
		const scrape = await scrapeFor(target);
		await persist(target, scrape);
		console.log(
			`[debridio] refreshed ${target.kind} ${target.imdbId}` +
				(target.season !== undefined ? ` season ${target.season}` : '') +
				`: ${scrape.available.length} cached, ${scrape.torrents.length} torrents`
		);
	} catch (error) {
		console.warn(
			'[debridio] availability refresh failed:',
			error instanceof Error ? error.message : error
		);
	}
}
