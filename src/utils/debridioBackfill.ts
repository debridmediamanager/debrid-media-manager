import {
	DebridioProvider,
	DebridioScrape,
	configuredDebridioProviders,
	isDebridioEnabled,
	scrapeDebridioMovie,
	scrapeDebridioSeason,
} from '@/services/debridio';
import { ScrapeSearchResult, flattenAndRemoveDuplicates } from '@/services/mediasearch';
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
// instant availability drifts slowly; seven days keeps refresh traffic near
// zero while the ⚡ markers stay trustworthy.
const AVAILABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

async function scrapeProvider(
	target: DebridioTarget,
	provider: DebridioProvider
): Promise<DebridioScrape> {
	if (target.kind === 'movie') {
		return scrapeDebridioMovie(target.imdbId, provider);
	}
	const season = target.season ?? 1;
	return scrapeDebridioSeason(
		target.imdbId,
		season,
		await seasonEpisodes(target.imdbId, season),
		provider
	);
}

type ProviderScrapes = Partial<Record<DebridioProvider, DebridioScrape>>;

/**
 * Scrapes every configured provider for the target. Torrent listings land in
 * the same ScrapedTrue key from both (deduped by hash at merge); each
 * provider's ⚡ availability is kept apart because the caches differ - RD's
 * cached set is not AD's. Throws only when every configured provider fails;
 * one failing provider is logged and the rest still land.
 */
async function scrapeAllProviders(target: DebridioTarget): Promise<ProviderScrapes> {
	const providers = configuredDebridioProviders();
	const settled = await Promise.allSettled(
		providers.map((provider) => scrapeProvider(target, provider))
	);
	const scrapes: ProviderScrapes = {};
	let succeeded = 0;
	settled.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			scrapes[providers[index]] = result.value;
			succeeded += 1;
		} else {
			console.warn(
				`[debridio] ${providers[index]} scrape failed for ${target.key}:`,
				result.reason instanceof Error ? result.reason.message : result.reason
			);
		}
	});
	if (succeeded === 0) {
		throw new Error(`all debridio providers failed for ${target.key}`);
	}
	return scrapes;
}

async function persist(target: DebridioTarget, scrapes: ProviderScrapes): Promise<void> {
	// Merge, never replace: btdig/scraps results for the same key stay, and
	// the same torrent seen by both providers collapses to one row.
	const torrents = flattenAndRemoveDuplicates(
		Object.values(scrapes).map((scrape) => scrape?.torrents ?? [])
	);
	if (torrents.length > 0) {
		await db.saveScrapedTrueResults(target.key, torrents, true);
	}
	if (scrapes.realdebrid?.available.length) {
		await db.saveInstantAvailability(target.imdbId, scrapes.realdebrid.available);
	}
	if (scrapes.alldebrid?.available.length) {
		await db.saveInstantAvailabilityAd(target.imdbId, scrapes.alldebrid.available);
	}
}

async function refreshedRecently(key: string): Promise<boolean> {
	const refreshedAt = await db.getDebridioRefreshedAt(key);
	return !!refreshedAt && Date.now() - refreshedAt.getTime() < AVAILABILITY_TTL_MS;
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
	if (await refreshedRecently(target.key)) return [];

	const processingKey = `processing:${target.imdbId}`;
	if (await db.keyExists(processingKey)) return [];
	await db.saveScrapedResults(processingKey, []);

	try {
		const scrapes = await scrapeAllProviders(target);
		await persist(target, scrapes);
		// Tombstone the answer itself - including an empty one, so a title whose
		// stored results are all filtered out at read time (Cyrillic-only) or
		// that debridio simply does not know does not re-trigger a scrape on
		// every page view for the TTL window.
		await db.markDebridioRefreshed(target.key);
		const torrents = flattenAndRemoveDuplicates(
			Object.values(scrapes).map((scrape) => scrape?.torrents ?? [])
		);
		if (torrents.length === 0) {
			console.log(`[debridio] no results for ${target.kind} ${target.imdbId}`);
		}
		return torrents;
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
 * markers survive RD cache turnover. Throttled per ScrapedTrue key: the
 * debridio:refresh Cache row's updatedAt is the clock, so a refresh that finds
 * no new cached hashes (create-only writes, nothing advanced in Available)
 * still counts and suppresses the next views. Returns the promise so callers
 * can await it in tests while production call sites fire and forget.
 */
export async function refreshDebridioAvailabilityInBackground(
	target: DebridioTarget
): Promise<void> {
	if (!isDebridioEnabled()) return;
	if (await refreshedRecently(target.key)) return;

	try {
		const scrapes = await scrapeAllProviders(target);
		await persist(target, scrapes);
		await db.markDebridioRefreshed(target.key);
		const cached = Object.values(scrapes).reduce(
			(sum, scrape) => sum + (scrape?.available.length ?? 0),
			0
		);
		console.log(
			`[debridio] refreshed ${target.kind} ${target.imdbId}` +
				(target.season !== undefined ? ` season ${target.season}` : '') +
				`: ${cached} cached`
		);
	} catch (error) {
		console.warn(
			'[debridio] availability refresh failed:',
			error instanceof Error ? error.message : error
		);
	}
}
