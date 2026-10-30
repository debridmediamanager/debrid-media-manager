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
import {
	STREMIO_ADDON_NAMES,
	StremioAddon,
	scrapeAddonMovie,
	scrapeAddonSeason,
} from '@/services/stremioAddons';
import { isMovieTitleType, isShowTitleType } from '@/utils/imdbTitleTypes';

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

/** A debridio provider, or a keyless addon whose cache marks are Real-Debrid's. */
type Source = DebridioProvider | StremioAddon;

const isAddon = (source: Source): source is StremioAddon =>
	(STREMIO_ADDON_NAMES as string[]).includes(source);

async function scrapeProvider(target: DebridioTarget, provider: Source): Promise<DebridioScrape> {
	if (target.kind === 'movie') {
		return isAddon(provider)
			? scrapeAddonMovie(target.imdbId, provider)
			: scrapeDebridioMovie(target.imdbId, provider);
	}
	const season = target.season ?? 1;
	const episodes = await seasonEpisodes(target.imdbId, season);
	return isAddon(provider)
		? scrapeAddonSeason(target.imdbId, season, episodes, provider)
		: scrapeDebridioSeason(target.imdbId, season, episodes, provider);
}

type ProviderScrapes = Partial<Record<Source, DebridioScrape>>;

/**
 * Scrapes every configured debridio provider for the target, and with addons
 * Torrentio and Peerflix too. Torrent listings land in the same ScrapedTrue
 * key from all of them (deduped by hash at merge); availability is kept apart
 * by debrid service because the caches differ - RD's cached set is not AD's.
 * Throws only when every source fails; one failing is logged and the rest
 * still land.
 */
async function scrapeAllProviders(
	target: DebridioTarget,
	addons: boolean
): Promise<ProviderScrapes> {
	const providers: Source[] = [
		...configuredDebridioProviders(),
		...(addons ? STREMIO_ADDON_NAMES : []),
	];
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
		throw new Error(`every source failed for ${target.key}`);
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
	// The addons' [RD+] marks are Real-Debrid's, as debridio's realdebrid ⚡ are.
	const rd = [scrapes.realdebrid, ...STREMIO_ADDON_NAMES.map((addon) => scrapes[addon])].flatMap(
		(scrape) => scrape?.available ?? []
	);
	if (rd.length) {
		await db.saveInstantAvailability(target.imdbId, rd);
	}
	if (scrapes.alldebrid?.available.length) {
		await db.saveInstantAvailabilityAd(target.imdbId, scrapes.alldebrid.available);
	}
}

/**
 * Whether IMDb files the id as the kind of title the page is for.
 *
 * The routes backfill whatever id a page asks about, and pages get asked about
 * ids of the other kind: a film opened on the show route, an episode's own id.
 * Debridio answers those with some other title's releases - season 1 of Ma
 * (2019) came back as All That S01E01, of Gone Girl as a 1936 Flash Gordon
 * serial - and they were stored under the key, in the trusted table. An id the
 * IMDb dump does not have yet is let through: it is usually just newer than the
 * dump. A lookup that fails is not, since a page left to the request queue is
 * better than one filled with another title.
 */
async function idIsKind(target: DebridioTarget): Promise<boolean> {
	let titleType: string | null;
	try {
		titleType = await db.getImdbTitleType(target.imdbId);
	} catch (error) {
		console.warn(
			`[debridio] title type lookup failed for ${target.imdbId}:`,
			error instanceof Error ? error.message : error
		);
		return false;
	}
	if (titleType === null) return true;
	const matches =
		target.kind === 'movie' ? isMovieTitleType(titleType) : isShowTitleType(titleType);
	if (!matches) {
		console.log(
			`[debridio] skipping ${target.key}: IMDb files ${target.imdbId} as ${titleType}`
		);
	}
	return matches;
}

async function refreshedRecently(key: string): Promise<boolean> {
	const refreshedAt = await db.getDebridioRefreshedAt(key);
	return !!refreshedAt && Date.now() - refreshedAt.getTime() < AVAILABILITY_TTL_MS;
}

/**
 * Synchronous first-fill for a title the external scrapers have not reached:
 * debridio when configured, and Torrentio and Peerflix always. Each answers in
 * about a second, so the page gets results on this request instead of a 204
 * 'requested' plus polling, and what they found is the library's from then on,
 * for every user and every feed. Only an empty page gets here, so the library
 * always answers first. Returns [] when another scrape of this title is in
 * flight or nothing knows the title - the caller then falls back to the
 * request queue as before.
 */
export async function backfillFromDebridioNow(
	target: DebridioTarget
): Promise<ScrapeSearchResult[]> {
	if (await refreshedRecently(target.key)) return [];
	if (!(await idIsKind(target))) return [];

	const processingKey = `processing:${target.imdbId}`;
	if (await db.keyExists(processingKey)) return [];
	await db.saveScrapedResults(processingKey, []);

	try {
		const scrapes = await scrapeAllProviders(target, true);
		await persist(target, scrapes);
		// Tombstone the answer itself - including an empty one, so a title whose
		// stored results are all filtered out at read time or that debridio
		// simply does not know does not re-trigger a scrape on every page view
		// for the TTL window.
		await db.markDebridioRefreshed(target.key);
		const torrents = flattenAndRemoveDuplicates(
			Object.values(scrapes).map((scrape) => scrape?.torrents ?? [])
		);
		if (torrents.length === 0) {
			console.log(`[backfill] no results for ${target.kind} ${target.imdbId}`);
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
 * markers survive RD cache turnover. Debridio only: a title the library knows
 * never sends traffic to Torrentio or Peerflix. Throttled per ScrapedTrue key: the
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
	if (!(await idIsKind(target))) return;

	try {
		const scrapes = await scrapeAllProviders(target, false);
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
