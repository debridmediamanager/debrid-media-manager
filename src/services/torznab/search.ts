// The search half of the Torznab indexer: a client's query answered out of
// DMM's own torrent library, with debridio filling the gaps.
//
// Three things shape everything below and none of them are obvious:
//
//   * The library holds `{hash, title, fileSize}` per release and nothing else.
//     There is no posting date, no swarm, no category — so `pubDate` comes from
//     the library page's own `updatedAt`, the category is derived from the page
//     key and the title, and `seeders` is repurposed (see `seedersFor`).
//   * Only `ScrapedTrue` is served. The `Scraped` table holds results from
//     sources that have been measured filing fabricated titles against real
//     hashes, which a person browsing can see through and an *arr cannot: it
//     matches on the release name and would import the wrong film.
//   * A miss falls through to debridio, which answers in about a second, so a
//     title nothing has scraped yet is filled on this very request rather than
//     answered empty — the same trade `/api/torrents/movie` makes for the site.

import { flattenAndRemoveDuplicates, ScrapeSearchResult } from '@/services/mediasearch';
import { repository as db } from '@/services/repository';
import {
	backfillFromDebridioNow,
	refreshDebridioAvailabilityInBackground,
} from '@/utils/debridioBackfill';
import { MAX_SIZE_MB } from '@/utils/releaseSize';
import { isTorznabLiveService, type TorznabLiveService } from '@/utils/sponsorProviders';
import type { NextApiRequest } from 'next';
import {
	categoriesFor,
	LibraryKind,
	matchesCategoryFilter,
	parseCategoryFilter,
} from './categories';
import {
	MissingProviderKeyError,
	probeProviderCache,
	type ProviderCacheAnswer,
} from './providerCache';
import { resolveTargets, SearchType, TorznabTarget } from './resolve';
import { MAX_LIMIT, TorznabRssItem } from './xml';

/** Library sizes are MiB — the unit `saveScrapedTrueResults` stores. */
const BYTES_PER_MB = 1024 * 1024;

/**
 * How much of the library an untargeted request — an *arr's RSS sync — reads.
 *
 * A sync runs on a timer against every indexer a client has, so its cost must be
 * fixed rather than proportional to the library. Newest pages first, a few
 * releases from each, which is as close to "what is new" as a library keyed by
 * title rather than by posting date can get.
 */
export const RECENT_KEYS = 8;
export const RECENT_PER_KEY = 5;

/**
 * The seeders a release is reported with.
 *
 * There is no swarm behind these releases in any sense a client would recognise:
 * a grab is resolved against the caller's own debrid account, so what decides
 * whether it lands instantly is whether the hash is already cached there, not
 * how many peers are sharing it. `seeders` is the only field a Torznab client
 * ranks on, so that is what it carries — a cached release outranks an uncached
 * one and clears any minimum-seeders setting.
 *
 * Uncached is 1 rather than 0 on purpose: 0 means "dead" to an *arr and gets the
 * release dropped, and DMM has no evidence any of these are dead.
 */
export const CACHED_SEEDERS = 100;
export const UNCACHED_SEEDERS = 1;

/** The same rule the library's own SQL applies on the site's read path. */
const CYRILLIC_TITLE = /^[А-Яа-яЁё]/;

/**
 * Which debrid cache the ⚡ signal is read from, and whether it filters.
 *
 * `rd` and `ad` are answered from DMM's own tables and cost nothing but a
 * query. The rest are asked of the provider with the sponsor's own key, which
 * is why they are named apart: everything that has to hold a credential, bound
 * a probe or fail loudly keys off this distinction.
 */
export type TorznabCacheScope = 'any' | 'rd' | 'ad' | TorznabLiveService;

export interface TorznabFeedOptions {
	cache: TorznabCacheScope;
	cachedOnly: boolean;
}

/** Who is asking, for the feeds that need that sponsor's own provider key. */
export interface TorznabSearchContext {
	shortId: string;
}

export const DEFAULT_FEED_OPTIONS: TorznabFeedOptions = { cache: 'any', cachedOnly: false };

/**
 * The optional path segments between `/api/torznab` and the `/api` that every
 * *arr appends to an indexer URL.
 *
 * A query parameter would have been simpler and does not work: Prowlarr builds
 * the query string itself from the caps document and drops anything a person
 * put in the URL field, while the path survives untouched. So the variants live
 * in the URL a sponsor pastes — `/api/torznab/rd/cached` for "only what my
 * Real-Debrid account already holds".
 *
 * An unrecognised segment is rejected rather than ignored: silently serving the
 * default feed for `/api/torznab/realdebrid` would look like a working indexer
 * that quietly answers the wrong question.
 */
export function parseFeedOptions(segments: string[]): TorznabFeedOptions | null {
	const options = { ...DEFAULT_FEED_OPTIONS };
	for (const segment of segments) {
		if (segment === 'rd' || segment === 'ad') options.cache = segment;
		else if (isTorznabLiveService(segment)) options.cache = segment;
		else if (segment === 'cached') options.cachedOnly = true;
		else return null;
	}
	return options;
}

export interface NormalizedQuery {
	q?: string;
	imdbid?: string;
	tvdbid?: number;
	season?: number;
	categories: number[];
	limit: number;
	offset: number;
	/** False when nothing names content: an *arr RSS sync rather than a search. */
	targeted: boolean;
}

function firstValue(value: string | string[] | undefined): string {
	const raw = Array.isArray(value) ? value[0] : value;
	return typeof raw === 'string' ? raw.trim() : '';
}

function integer(raw: string, min: number, max: number): number | undefined {
	if (!/^\d+$/.test(raw)) return undefined;
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value)) return undefined;
	return Math.min(Math.max(value, min), max);
}

/**
 * Reads a client's query into the parameters this endpoint acts on, dropping
 * anything malformed rather than half-honouring it.
 *
 * `ep` is read by the caller's client and deliberately not acted on here. Sonarr
 * parses release titles itself and a season pack is a correct answer to an
 * episode search, so filtering the feed down to titles that name the episode
 * would hide every pack that contains it.
 */
export function normalizeSearchQuery(query: NextApiRequest['query']): NormalizedQuery {
	const q = firstValue(query.q);
	const imdbid = firstValue(query.imdbid);
	const tvdbid = integer(firstValue(query.tvdbid), 1, Number.MAX_SAFE_INTEGER);

	return {
		q: q || undefined,
		imdbid: imdbid || undefined,
		tvdbid,
		season: integer(firstValue(query.season), 0, 9999),
		categories: parseCategoryFilter(firstValue(query.cat)),
		limit: integer(firstValue(query.limit), 1, MAX_LIMIT) ?? MAX_LIMIT,
		offset: integer(firstValue(query.offset), 0, Number.MAX_SAFE_INTEGER) ?? 0,
		targeted: Boolean(q || imdbid || tvdbid !== undefined),
	};
}

interface LibraryRelease {
	title: string;
	hash: string;
	/** Bytes. */
	size: number;
	categories: number[];
	pubDate: string;
}

/**
 * Library rows as feed releases.
 *
 * `flattenAndRemoveDuplicates` is what the site's own read path runs them
 * through — it decodes the entity-encoded titles still in the table and drops
 * the degenerate hashes — and the Cyrillic rule mirrors the `NOT REGEXP` the
 * paged SQL applies, so the feed and the website answer with the same set.
 */
function toReleases(
	results: ScrapeSearchResult[],
	kind: LibraryKind,
	updatedAt: Date
): LibraryRelease[] {
	const pubDate = updatedAt.toUTCString();
	return flattenAndRemoveDuplicates([results])
		.filter((result) => !CYRILLIC_TITLE.test(result.title))
		.map((result) => ({
			title: result.title,
			hash: result.hash,
			size: reportableSize(result.fileSize),
			categories: categoriesFor(kind, result.title),
			pubDate,
		}));
}

/**
 * The size a release is published with, in bytes.
 *
 * A size above the noise ceiling is reported as unknown rather than as itself,
 * which is what a missing one has always been reported as. Some library rows
 * carry bytes or kilobytes where the column means megabytes — see
 * `MAX_SIZE_MB` — and this feed orders biggest-first, so such a row does
 * not sit at the bottom of a page, it takes the top of it: measured on
 * 2026-09-09, the first result of a `Sicario` search was a 5.65 GB release
 * published as 30,408.7 GB.
 *
 * Unknown rather than dropped, because the release itself is real and
 * grabbable — only the number is wrong, and an \*arr skips its size checks for
 * a release whose size it does not know. Dropping would take a working release
 * out of the feed to fix a field.
 *
 * The floor is deliberately not applied here. A release genuinely under the
 * junk floor is better published at its real size, where a client's own minimum
 * rejects it, than published as unknown, where nothing does.
 */
function reportableSize(fileSize: number): number {
	if (!Number.isFinite(fileSize) || fileSize <= 0) return 0;
	if (fileSize > MAX_SIZE_MB) return 0;
	return Math.round(fileSize * BYTES_PER_MB);
}

/** Concatenates pages, keeping the first sighting of each hash. */
function merge(pages: LibraryRelease[][]): LibraryRelease[] {
	const byHash = new Map<string, LibraryRelease>();
	for (const page of pages) {
		for (const release of page) {
			if (!byHash.has(release.hash)) byHash.set(release.hash, release);
		}
	}
	return [...byHash.values()];
}

async function readTarget(target: TorznabTarget): Promise<LibraryRelease[]> {
	const row = await db.getScrapedTrueRow(target.key);
	if (!row) return [];
	return toReleases(row.results, target.kind, row.updatedAt);
}

/**
 * Drops what the community has reported as wrong content, exactly as the site
 * does before rendering a title. A failure here serves the unfiltered set: the
 * report list narrowing a page is worth having and is not worth failing a
 * search over.
 */
async function withoutReported(
	imdbId: string,
	releases: LibraryRelease[]
): Promise<LibraryRelease[]> {
	if (releases.length === 0) return releases;
	try {
		const reported = new Set(
			(await db.getReportedHashes(imdbId)).map((hash) => hash.toLowerCase())
		);
		if (reported.size === 0) return releases;
		return releases.filter((release) => !reported.has(release.hash));
	} catch (error) {
		console.error(
			'Torznab: report filter failed, serving unfiltered:',
			error instanceof Error ? error.message : error
		);
		return releases;
	}
}

/**
 * Fills a page the scrapers have not reached yet.
 *
 * Only for a single, fully named page: debridio is asked about one title and one
 * season, and a query that resolved to several pages has no single thing to ask
 * about. The scrape is guarded by its own in-flight marker and refresh window,
 * so a client hammering an unknown title does not turn into a scrape storm.
 *
 * The releases come back with today's date because that is when they were found
 * — there is no page timestamp yet, the write is what creates one.
 */
async function backfill(targets: TorznabTarget[]): Promise<LibraryRelease[]> {
	if (targets.length !== 1) return [];
	const [target] = targets;
	if (target.kind === 'tv' && target.season === undefined) return [];

	const scraped = await backfillFromDebridioNow({
		imdbId: target.imdbId,
		key: target.key,
		kind: target.kind === 'movie' ? 'movie' : 'series',
		season: target.season,
	});
	return toReleases(scraped, target.kind, new Date());
}

/**
 * Keeps the cache markers this feed's `seeders` are made of from going stale,
 * without holding the response. No-ops inside its own refresh window.
 */
function refreshAvailability(targets: TorznabTarget[]): void {
	if (targets.length !== 1) return;
	const [target] = targets;
	if (target.kind === 'tv' && target.season === undefined) return;

	void refreshDebridioAvailabilityInBackground({
		imdbId: target.imdbId,
		key: target.key,
		kind: target.kind === 'movie' ? 'movie' : 'series',
		season: target.season,
	});
}

async function targetedReleases(t: SearchType, params: NormalizedQuery): Promise<LibraryRelease[]> {
	const targets = await resolveTargets(t, params);
	if (targets.length === 0) return [];

	const pages = await Promise.all(targets.map(readTarget));
	const found = merge(pages);
	const releases = found.length > 0 ? found : await backfill(targets);
	if (found.length > 0) refreshAvailability(targets);

	const filtered = await withoutReported(targets[0].imdbId, releases);
	// Biggest first, the order the library itself is stored in and the site
	// serves. A client re-ranks by its own quality rules regardless.
	return filtered.sort((a, b) => b.size - a.size);
}

/** `movie:tt…` / `tv:tt…:1` back into the target that produced it. */
function targetFromKey(key: string): TorznabTarget | null {
	const movie = /^movie:(tt\d+)$/.exec(key);
	if (movie) return { kind: 'movie', imdbId: movie[1], key };

	const tv = /^tv:(tt\d+):(\d+)$/.exec(key);
	if (tv) return { kind: 'tv', imdbId: tv[1], season: Number(tv[2]), key };

	return null;
}

/**
 * The untargeted feed: the most recently refreshed library pages.
 *
 * An *arr syncs this on a timer and expects newly posted releases. A library
 * keyed by title has no posting-date stream to offer, so what it offers instead
 * is the titles whose release lists changed most recently — which is the same
 * set for the same reason, since a page's timestamp moves when releases land
 * on it. Kept in page order rather than re-sorted by size: recency is the whole
 * point of the feed.
 */
async function recentReleases(): Promise<LibraryRelease[]> {
	const recent = await db.getRecentScrapedTrueKeys(RECENT_KEYS);
	const pages = await Promise.all(
		recent.map(async ({ key, updatedAt }) => {
			const target = targetFromKey(key);
			if (!target) return [];
			// The paged read rather than the whole row: a popular title's page runs
			// to hundreds of kilobytes and this touches eight of them every time a
			// client syncs, so the slice happens in SQL rather than after
			// transferring the lot.
			const rows = (await db.getScrapedTrueResults<ScrapeSearchResult[]>(key, 0, 0)) ?? [];
			const releases = toReleases(rows, target.kind, updatedAt).slice(0, RECENT_PER_KEY);
			return withoutReported(target.imdbId, releases);
		})
	);
	return merge(pages);
}

/**
 * A whole title's hash list can run to thousands, and the `cached` feeds have to
 * classify every one of them before a page can be cut out of the set. Chunked
 * so the `IN` list stays a shape MySQL plans well, and sequentially so a large
 * title cannot open a burst of connections of its own.
 */
const CACHE_LOOKUP_CHUNK = 500;

async function lookupCached(hashes: string[], scope: 'any' | 'rd' | 'ad'): Promise<Set<string>> {
	if (scope === 'rd') return db.filterCachedHashes(hashes);
	if (scope === 'ad') return db.filterCachedHashesAd(hashes);

	const [rd, ad] = await Promise.all([
		db.filterCachedHashes(hashes),
		db.filterCachedHashesAd(hashes),
	]);
	for (const hash of ad) rd.add(hash);
	return rd;
}

async function cachedHashesFromDb(
	hashes: string[],
	scope: 'any' | 'rd' | 'ad'
): Promise<Set<string>> {
	if (hashes.length <= CACHE_LOOKUP_CHUNK) return lookupCached(hashes, scope);

	const found = new Set<string>();
	for (let start = 0; start < hashes.length; start += CACHE_LOOKUP_CHUNK) {
		const chunk = await lookupCached(hashes.slice(start, start + CACHE_LOOKUP_CHUNK), scope);
		for (const hash of chunk) found.add(hash);
	}
	return found;
}

/**
 * The cache answer for one search, from whichever source the feed names.
 *
 * The two paths are not interchangeable and are deliberately not merged. The
 * database path is exhaustive: every hash gets a verdict, so `unresolved` is
 * always zero and a `cached` feed's `total` is exact. The provider path is
 * bounded, so a large title's first search leaves a tail unresolved and
 * converges over the searches that follow.
 */
async function resolveCache(
	hashes: string[],
	options: TorznabFeedOptions,
	context?: TorznabSearchContext
): Promise<ProviderCacheAnswer> {
	const scope = options.cache;
	if (scope === 'any' || scope === 'rd' || scope === 'ad') {
		return { cached: await cachedHashesFromDb(hashes, scope), unresolved: 0 };
	}

	// A feed that names a provider is unusable without that provider's key, and
	// silently falling back to the plain feed would answer a different question
	// than the URL asks. The caller turns this into a Torznab error naming the
	// provider, so the fix is in the message rather than in an *arr's log.
	if (!context?.shortId) throw new MissingProviderKeyError(scope);
	const apiKey = await db.getSponsorProviderKey(context.shortId, scope);
	if (!apiKey) throw new MissingProviderKeyError(scope);

	return probeProviderCache(scope, apiKey, hashes);
}

function magnetUri(hash: string, title: string): string {
	// No trackers: every consumer of this feed resolves the hash against a debrid
	// account, which needs the infohash and nothing else. `dn` is carried because
	// a client that shows a queue before the metadata arrives has nothing else to
	// display.
	return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`;
}

function toRssItem(release: LibraryRelease, cached: boolean): TorznabRssItem {
	const seeders = cached ? CACHED_SEEDERS : UNCACHED_SEEDERS;
	return {
		title: release.title,
		infoHash: release.hash,
		magnetUrl: magnetUri(release.hash, release.title),
		pubDate: release.pubDate,
		size: release.size,
		categories: release.categories,
		seeders,
		peers: seeders,
	};
}

export interface TorznabPage {
	items: TorznabRssItem[];
	offset: number;
	/** The whole matching set, not this page — a client pages until it reaches it. */
	total: number;
	/**
	 * Hashes this request's probe budget did not reach, on a provider-backed
	 * feed. Always zero for `rd`, `ad` and the plain feed, which are exhaustive.
	 */
	unresolved: number;
}

/**
 * One client search, answered.
 *
 * The cache lookup runs over the whole matching set rather than over the page,
 * for two reasons. A filtered feed's `total` and every page after the first are
 * wrong if the filter is applied after slicing. And the plain feed is ordered by
 * it: measured against the live library, a movie search's first hundred results
 * were almost entirely 24-terabyte "top 5000 movies" packs, because the library
 * is stored biggest-first and a client reads page one. Cached-first puts what
 * the caller can actually grab where the caller will actually look, and makes
 * the order agree with the `seeders` the same release is reported with.
 *
 * The sort is stable, so each group keeps the order its path produced — size
 * for a search, recency for an RSS sync.
 */
export async function runSearch(
	t: SearchType,
	query: NextApiRequest['query'],
	options: TorznabFeedOptions = DEFAULT_FEED_OPTIONS,
	context?: TorznabSearchContext
): Promise<TorznabPage> {
	const params = normalizeSearchQuery(query);
	const releases = params.targeted ? await targetedReleases(t, params) : await recentReleases();

	const matching = releases.filter((release) =>
		matchesCategoryFilter(release.categories, params.categories)
	);
	const { cached, unresolved } = await resolveCache(
		matching.map((release) => release.hash),
		options,
		context
	);

	const kept = options.cachedOnly
		? matching.filter((release) => cached.has(release.hash))
		: matching;
	kept.sort((a, b) => Number(cached.has(b.hash)) - Number(cached.has(a.hash)));

	const page = kept.slice(params.offset, params.offset + params.limit);

	return {
		items: page.map((release) => toRssItem(release, cached.has(release.hash))),
		offset: params.offset,
		total: kept.length,
		unresolved,
	};
}
