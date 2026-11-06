// The search half of the Torznab indexer: a client's query answered out of
// DMM's own torrent library, with debridio filling the gaps.
//
// Three things shape everything below and none of them are obvious:
//
//   * The library holds `{hash, title, fileSize}` per release and nothing else.
//     There is no posting date, no swarm, no category — so `pubDate` comes from
//     the library page's own `updatedAt` (on the RD and AD feeds' RSS sync, from
//     when DMM first recorded the release as cached), the category is derived
//     from the page key and the title, and `seeders` is repurposed.
//   * Only `ScrapedTrue` is served. The `Scraped` table holds results from
//     sources that have been measured filing fabricated titles against real
//     hashes, which a person browsing can see through and an *arr cannot: it
//     matches on the release name and would import the wrong film.
//   * A miss falls through to debridio, which answers in about a second, so a
//     title nothing has scraped yet is filled on this very request rather than
//     answered empty — the same trade `/api/torrents/movie` makes for the site.

import type { NewlyCachedRow, RdCachedNames } from '@/services/database/availability';
import type { ScrapedTrueEntry } from '@/services/database/scraped';
import { flattenAndRemoveDuplicates, ScrapeSearchResult } from '@/services/mediasearch';
import { repository as db } from '@/services/repository';
import { withoutTrashedResults } from '@/services/scrapedVerdicts/job';
import { isCyrillicLed } from '@/utils/cyrillicLed';
import {
	backfillFromDebridioNow,
	refreshDebridioAvailabilityInBackground,
} from '@/utils/debridioBackfill';
import { isRdBlockedName } from '@/utils/deInfringe';
import { MAX_SIZE_MB } from '@/utils/releaseSize';
import { isTorznabLiveService, type TorznabLiveService } from '@/utils/sponsorProviders';
import { createTvEpisodeReader, matchesTvEpisodeFilter } from '@/utils/tvEpisodes';
import type { NextApiRequest } from 'next';
import {
	categoriesFor,
	LibraryKind,
	matchesCategoryFilter,
	parseCategoryFilter,
} from './categories';
import {
	NEWLY_CACHED_DEPTH,
	NEWLY_CACHED_RESOLVE_LIMIT,
	NEWLY_CACHED_WINDOW_MS,
	newlyCachedStore,
	type NewlyCachedLists,
	type NewlyCachedRelease,
	type ResolvedRelease,
} from './newlyCached';
import {
	MissingProviderKeyError,
	probeProviderCache,
	type ProviderCacheAnswer,
} from './providerCache';
import { resolveTargets, SearchType, TorznabTarget } from './resolve';
import { DEFAULT_LIMIT, MAX_LIMIT, TorznabRssItem } from './xml';

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

/**
 * Which debrid cache the ⚡ signal is read from, and whether it filters.
 *
 * `rd` and `ad` are answered from DMM's own tables and cost nothing but a
 * query. The rest are asked of the provider with the sponsor's own key, which
 * is why they are named apart: everything that has to hold a credential, bound
 * a probe or fail loudly keys off this distinction.
 */
export type TorznabCacheScope = 'any' | 'rd' | 'ad' | 'dl' | TorznabLiveService;

/** A provider a feed path can name. */
export type TorznabProvider = Exclude<TorznabCacheScope, 'any'>;

const isTorznabProvider = (segment: string): segment is TorznabProvider =>
	segment === 'rd' || segment === 'ad' || segment === 'dl' || isTorznabLiveService(segment);

export interface TorznabFeedOptions {
	/** The one provider the path names, or `any` when it names none or several. */
	cache: TorznabCacheScope;
	cachedOnly: boolean;
	/** Two or more providers the path names, in its order: "cached on any of these". */
	providers?: TorznabProvider[];
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
 * Several providers may be named, in any order and each once
 * (`/api/torznab/rd/tb/cached`), for "cached on any of these"; `cached` comes
 * last. An unrecognised segment, a repeated one or `cached` elsewhere is
 * rejected rather than ignored: silently serving the default feed for
 * `/api/torznab/realdebrid`, or only the last provider of `/rd/ad` as this did
 * until 2026-11-06, looks like a working indexer that quietly answers the
 * wrong question.
 */
export function parseFeedOptions(segments: string[]): TorznabFeedOptions | null {
	const options = { ...DEFAULT_FEED_OPTIONS };
	const named: TorznabProvider[] = [];
	for (const [index, segment] of segments.entries()) {
		if (segment === 'cached' && index === segments.length - 1) options.cachedOnly = true;
		else if (isTorznabProvider(segment) && !named.includes(segment)) named.push(segment);
		else return null;
	}
	if (named.length === 1) options.cache = named[0];
	if (named.length > 1) options.providers = named;
	return options;
}

export interface NormalizedQuery {
	q?: string;
	imdbid?: string;
	tvdbid?: number;
	season?: number;
	/**
	 * `ep`, when it is an episode number. A daily show's `ep` is a date
	 * (`10/03`) and is left unread, as is a zero.
	 */
	episode?: number;
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
 */
export function normalizeSearchQuery(query: NextApiRequest['query']): NormalizedQuery {
	const q = firstValue(query.q);
	const imdbid = firstValue(query.imdbid);
	const tvdbid = integer(firstValue(query.tvdbid), 1, Number.MAX_SAFE_INTEGER);
	// Read from zero rather than clamped up from it, so `ep=0` is no episode
	// rather than episode one.
	const episode = integer(firstValue(query.ep), 0, Number.MAX_SAFE_INTEGER);

	return {
		q: q || undefined,
		imdbid: imdbid || undefined,
		tvdbid,
		season: integer(firstValue(query.season), 0, 9999),
		episode: episode !== undefined && episode >= 1 ? episode : undefined,
		categories: parseCategoryFilter(firstValue(query.cat)),
		limit: integer(firstValue(query.limit), 1, MAX_LIMIT) ?? DEFAULT_LIMIT,
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
	/** Which named providers hold it, where a several-provider path already knows. */
	cachedOn?: TorznabProvider[];
}

/**
 * Library rows as feed releases.
 *
 * `flattenAndRemoveDuplicates` is what the site's own read path runs them
 * through — it decodes the entity-encoded titles still in the table and drops
 * the degenerate hashes. Cyrillic-led names stay out, which is the one way the
 * feed's set differs from the website's: an *arr grabs without anyone reading
 * the name (see `isCyrillicLed`).
 */
function toReleases(
	results: ScrapeSearchResult[],
	kind: LibraryKind,
	updatedAt: Date
): LibraryRelease[] {
	const pubDate = updatedAt.toUTCString();
	return flattenAndRemoveDuplicates([results])
		.filter((result) => !isCyrillicLed(result.title))
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
	return toReleases(await withoutJudgedTrash(target, row.results), target.kind, row.updatedAt);
}

/**
 * Leaves out a movie page's releases the scraped-result verdicts judged not to
 * be that movie, as the movie page does before it renders them.
 *
 * The verdict pass moves those releases off the page into ScrapedTrash, but a
 * scraper that finds one again merges it back, and until the pass or the cron's
 * sweep reaches the page again this feed served it: on 2026-10-04, 27 of 393
 * randomly drawn judged movie pages held 137 such releases, and every one
 * checked had been trashed once already. The filter reads the titles as stored, before
 * `toReleases` decodes them, because a verdict is keyed by the stored title. A
 * failure serves the page unfiltered, as the report filter does.
 */
function withoutJudgedTrash(
	target: TorznabTarget,
	results: ScrapeSearchResult[]
): Promise<ScrapeSearchResult[]> {
	if (target.kind !== 'movie') return Promise.resolve(results);
	return withoutTrashedResults(target.imdbId, results);
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

/**
 * What an episode search is answered with: the releases whose own title names
 * that episode of that season, alone (`S03E10`, `3x10`) or inside a range
 * (`S03E09E10`, `S03E01-E10`). Null when the query asks for no one episode.
 *
 * DMM keys TV by season, so without this every episode search was answered
 * with the whole season. Sonarr takes almost none of that:
 * `SingleEpisodeSearchMatchSpecification` (Sonarr 4.0.20.3012) rejects a
 * release from another season ("Wrong season"), one that names no episode
 * ("Full season pack") and one whose episodes do not include the one searched
 * ("Wrong episode"), and a multi-episode release covering it passes. It also
 * stops reading at a thousand releases. On 2026-10-03 this feed served Silo's
 * season 3 as 1,432 releases, and 105 named episode 10. 33 of those came after
 * the thousandth, where Sonarr never saw them. Packs stay on the season search,
 * which Sonarr sends without `ep` and which this leaves alone.
 *
 * The reading is the season page's own (`parseTvEpisode`), not `ptt`'s, which
 * calls season packs single episodes; see `seasonNaming`. With no episode
 * counts to hand, a range spanning the whole season stays a range, which is
 * how Sonarr reads `S03E01-E10` too.
 *
 * Season 0 is left whole: Sonarr maps a release to a special by the episode's
 * title as well as by its number (`ParseSpecialEpisodeTitle`), and such a
 * title need not name `S00E05` at all. A daily show's date-shaped `ep` is not
 * read either. An anime episode search also asks by absolute number with no
 * `season` or `ep`, and that request reads the show's recent season pages
 * unfiltered, so a fansub release numbered by the whole run (`Show - 46`)
 * still reaches it there.
 */
function episodeFilter(
	targets: TorznabTarget[],
	params: NormalizedQuery
): ((release: LibraryRelease) => boolean) | null {
	const { season, episode } = params;
	if (season === undefined || season < 1 || episode === undefined) return null;
	if (!targets.every((target) => target.kind === 'tv' && target.season === season)) return null;

	const read = createTvEpisodeReader({ season, episodeCounts: {}, seasonCount: 0, anime: false });
	return (release) => matchesTvEpisodeFilter(read(release.title), episode);
}

async function targetedReleases(t: SearchType, params: NormalizedQuery): Promise<LibraryRelease[]> {
	const targets = await resolveTargets(t, params);
	if (targets.length === 0) return [];

	const pages = await Promise.all(targets.map(readTarget));
	const found = merge(pages);
	const releases = found.length > 0 ? found : await backfill(targets);
	if (found.length > 0) refreshAvailability(targets);

	const namesEpisode = episodeFilter(targets, params);
	const wanted = namesEpisode ? releases.filter(namesEpisode) : releases;
	const filtered = await withoutReported(targets[0].imdbId, wanted);
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
 * The untargeted feed where the newly cached list has nothing to answer with:
 * the most recently refreshed library pages.
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
			const kept = await withoutJudgedTrash(target, rows);
			const releases = toReleases(kept, target.kind, updatedAt).slice(0, RECENT_PER_KEY);
			return withoutReported(target.imdbId, releases);
		})
	);
	return merge(pages);
}

const resolvedKey = (row: NewlyCachedRow) => `${row.imdbId}:${row.hash}`;

/** Wanted hashes per page-finding query, so its key list stays a plannable range set. */
const RESOLVE_CHUNK = 50;

/**
 * The entries a cache row's release is served from: those on the title's movie
 * page, else on the row's own season page, else on the show's most recently
 * refreshed other one. A page of another title is never taken, though one
 * query can return it for a hash another row wanted.
 */
function entriesFor(row: NewlyCachedRow, entries: ScrapedTrueEntry[]): ScrapedTrueEntry[] {
	const own = entries.filter(
		(entry) =>
			entry.hash === row.hash &&
			(entry.key === `movie:${row.imdbId}` || entry.key.startsWith(`tv:${row.imdbId}:`))
	);
	const key =
		own.find((entry) => entry.key.startsWith('movie:'))?.key ??
		own.find((entry) => entry.key === `tv:${row.imdbId}:${row.season}`)?.key ??
		own[0]?.key;
	return own.filter((entry) => entry.key === key);
}

/**
 * What each cache row's hash is in the library, judged as a targeted search
 * judges it but over the wanted entries only: takedown, executable-only,
 * judged trash, then `toReleases` (entity decoding, the usable-hash rule,
 * Cyrillic-led, the size guard) and reports. The entries are the page's own
 * objects, so the same reader decides what they hold. A hash on no page of its
 * title, or filtered off it, is null. Where a page holds the hash twice, the
 * first entry wins, as it does in `flattenAndRemoveDuplicates`.
 *
 * Both answers are remembered, chunk by chunk, and only a bounded slice of the
 * unknown, newest first, is looked up per build. A chunk that fails (its query
 * capped at 15 s, say) leaves its rows unknown for a later build rather than
 * failing the build, which would otherwise retry the same newest rows first
 * and fail the same way until they aged out.
 */
async function resolveCacheRows(
	rows: NewlyCachedRow[]
): Promise<Map<string, ResolvedRelease | null>> {
	const unique = new Map<string, NewlyCachedRow>();
	for (const row of rows) if (!unique.has(resolvedKey(row))) unique.set(resolvedKey(row), row);

	const store = newlyCachedStore();
	const resolved = await store.readResolved([...unique.keys()]);
	const wanted = [...unique.values()]
		.filter((row) => !resolved.has(resolvedKey(row)))
		.slice(0, NEWLY_CACHED_RESOLVE_LIMIT);

	const failures: unknown[] = [];
	for (let start = 0; start < wanted.length; start += RESOLVE_CHUNK) {
		const chunk = wanted.slice(start, start + RESOLVE_CHUNK);
		let learned: Map<string, ResolvedRelease | null>;
		try {
			learned = await resolveChunk(chunk);
		} catch (error) {
			failures.push(error);
			continue;
		}
		await store.writeResolved(learned);
		for (const [key, release] of learned) resolved.set(key, release);
	}
	if (failures.length > 0) {
		const [first] = failures;
		console.error(
			`Torznab: ${failures.length} newly cached lookup chunk(s) failed, left for a later build:`,
			first instanceof Error ? first.message : first
		);
	}
	return resolved;
}

async function resolveChunk(chunk: NewlyCachedRow[]): Promise<Map<string, ResolvedRelease | null>> {
	const entries = await db.getScrapedTrueEntriesHolding(chunk);

	const byPage = new Map<string, ScrapedTrueEntry[]>();
	for (const row of chunk) {
		const chosen = entriesFor(row, entries);
		if (chosen.length > 0)
			byPage.set(chosen[0].key, [...(byPage.get(chosen[0].key) ?? []), ...chosen]);
	}

	const found = new Map<string, LibraryRelease>();
	for (const [key, onPage] of byPage) {
		const target = targetFromKey(key);
		if (!target) continue;
		onPage.sort((a, b) => a.position - b.position);
		const results = onPage.map((entry) => entry.result);
		const kept = await withoutJudgedTrash(target, results);
		const releases = toReleases(kept, target.kind, onPage[0].updatedAt);
		for (const release of await withoutReported(target.imdbId, releases)) {
			found.set(`${target.imdbId}:${release.hash.toLowerCase()}`, release);
		}
	}

	const learned = new Map<string, ResolvedRelease | null>();
	for (const row of chunk) {
		const release = found.get(resolvedKey(row));
		learned.set(
			resolvedKey(row),
			release
				? {
						hash: release.hash,
						title: release.title,
						size: release.size,
						categories: release.categories,
					}
				: null
		);
	}
	return learned;
}

/**
 * The releases DMM most recently recorded as cached, per provider, each dated
 * by the build that first listed it.
 *
 * Dated by listing rather than by the cache record, so the list only ever
 * grows at its head: a release resolved in a later build (the lookup bound, or
 * one scraped after it was cached) would otherwise land behind where an *arr
 * had already synced, and it would never page back to it. On 2026-11-06 a
 * live run listed 408 releases behind a bookmark taken after its first build.
 *
 * A build is incremental. What the last list holds is carried in its order
 * while its row is still among the newest, which is what drops takedowns
 * (the rows are read through the takedown filter every build), evictions and
 * rows past the depth. Rows not on it are judged now and listed at this
 * build's time; with no last list at all, at their own record's time. A
 * carried release is not judged again.
 */
export async function buildNewlyCached(
	previous: NewlyCachedLists | null,
	now: number = Date.now()
): Promise<NewlyCachedLists> {
	const since = new Date(now - NEWLY_CACHED_WINDOW_MS);
	const [rdRows, adRows] = await Promise.all([
		db.getNewlyCached('rd', since, NEWLY_CACHED_DEPTH),
		db.getNewlyCached('ad', since, NEWLY_CACHED_DEPTH),
	]);

	const listedOn = (list: NewlyCachedRelease[] = []) =>
		new Set(list.map((release) => release.hash.toLowerCase()));
	const listed = { rd: listedOn(previous?.rd), ad: listedOn(previous?.ad) };
	const unlisted = [
		...rdRows.filter((row) => !listed.rd.has(row.hash)),
		...adRows.filter((row) => !listed.ad.has(row.hash)),
	].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	const resolved = await resolveCacheRows(unlisted);

	const listOf = (provider: 'rd' | 'ad', rows: NewlyCachedRow[]): NewlyCachedRelease[] => {
		const current = new Set(rows.map((row) => row.hash));
		const carried = (previous?.[provider] ?? []).filter((release) =>
			current.has(release.hash.toLowerCase())
		);
		const fresh = rows.flatMap((row) => {
			if (listed[provider].has(row.hash)) return [];
			const release = resolved.get(resolvedKey(row));
			if (!release) return [];
			if (provider === 'rd' && isRefusedByRd(release, row)) return [];
			const cachedAt = row.createdAt.getTime();
			return [{ ...release, cachedAt, listedAt: previous ? now : cachedAt }];
		});
		return [...fresh, ...carried].slice(0, NEWLY_CACHED_DEPTH);
	};
	return { builtAt: now, rd: listOf('rd', rdRows), ad: listOf('ad', adRows) };
}

let building: Promise<void> | null = null;

/** Test seam: the build a request started, settled. */
export function newlyCachedBuildSettled(): Promise<void> {
	return building ?? Promise.resolve();
}

/**
 * The shared list. Whoever claims the build starts it in the background; no
 * request waits on one. Null when there is none yet: the caller then answers
 * as before the list existed. A failed build leaves the last list in place.
 */
async function newlyCachedLists(): Promise<NewlyCachedLists | null> {
	const store = newlyCachedStore();
	const stored = await store.readLists();
	if (!building && (await store.claimBuild())) {
		building = buildNewlyCached(stored)
			.then((built) => store.writeLists(built))
			.catch((error) => {
				console.error(
					'Torznab: newly cached list build failed, serving the last one:',
					error instanceof Error ? error.message : error
				);
			})
			.finally(() => {
				building = null;
			});
	}
	return stored;
}

/** Kind first, from `t`, then the client's own `cat=`. */
const KIND_CATEGORIES: Record<SearchType, number[]> = {
	search: [],
	tvsearch: [5000],
	movie: [2000],
};

const newestListing = (a: NewlyCachedRelease, b: NewlyCachedRelease) =>
	b.listedAt - a.listedAt || b.cachedAt - a.cachedAt;

/**
 * The untargeted feed on the scopes whose cache answer is DMM's own: what was
 * most recently listed as cached, dated by that listing, so an *arr paging
 * back to the last release it saw picks up everything listed since. On the
 * combined scope a hash both providers hold is listed once, at the earlier
 * listing.
 */
async function newlyCachedReleases(
	t: SearchType,
	params: NormalizedQuery,
	scope: 'any' | 'rd' | 'ad',
	providers?: TorznabProvider[]
): Promise<LibraryRelease[]> {
	const lists = await newlyCachedLists();
	if (!lists) return [];

	let listed = lists[scope === 'ad' ? 'ad' : 'rd'];
	if (scope === 'any') {
		const first = new Map<string, NewlyCachedRelease>();
		for (const release of [...lists.rd, ...lists.ad]) {
			const hash = release.hash.toLowerCase();
			const seen = first.get(hash);
			if (!seen || newestListing(release, seen) > 0) first.set(hash, release);
		}
		listed = [...first.values()].sort(newestListing);
	}

	return listed
		.filter(
			(release) =>
				matchesCategoryFilter(release.categories, KIND_CATEGORIES[t]) &&
				matchesCategoryFilter(release.categories, params.categories)
		)
		.map(({ cachedAt: _cachedAt, listedAt, ...release }) => ({
			...release,
			pubDate: new Date(listedAt).toUTCString(),
			...(providers && {
				cachedOn: providers.filter((provider) =>
					lists[provider as 'rd' | 'ad'].some(
						(on) => on.hash.toLowerCase() === release.hash.toLowerCase()
					)
				),
			}),
		}));
}

/**
 * A whole title's hash list can run to thousands, and the `cached` feeds have to
 * classify every one of them before a page can be cut out of the set. Chunked
 * so the `IN` list stays a shape MySQL plans well, and sequentially so a large
 * title cannot open a burst of connections of its own.
 */
const CACHE_LOOKUP_CHUNK = 500;

/** What DMM's own tables hold for a set of hashes. */
interface DbCacheRows {
	/** Hashes Real-Debrid holds, with the names its row records. */
	rd: Map<string, RdCachedNames>;
	/** Hashes AllDebrid holds. */
	ad: Set<string>;
}

async function lookupCached(hashes: string[], scope: 'any' | 'rd' | 'ad'): Promise<DbCacheRows> {
	const [rd, ad] = await Promise.all([
		scope === 'ad' ? new Map<string, RdCachedNames>() : db.getCachedRdNames(hashes),
		scope === 'rd' ? new Set<string>() : db.filterCachedHashesAd(hashes),
	]);
	return { rd, ad };
}

async function cachedRowsFromDb(
	hashes: string[],
	scope: 'any' | 'rd' | 'ad'
): Promise<DbCacheRows> {
	if (hashes.length <= CACHE_LOOKUP_CHUNK) return lookupCached(hashes, scope);

	const found: DbCacheRows = { rd: new Map(), ad: new Set() };
	for (let start = 0; start < hashes.length; start += CACHE_LOOKUP_CHUNK) {
		const chunk = await lookupCached(hashes.slice(start, start + CACHE_LOOKUP_CHUNK), scope);
		for (const [hash, names] of chunk.rd) found.rd.set(hash, names);
		for (const hash of chunk.ad) found.ad.add(hash);
	}
	return found;
}

/**
 * Whether Real-Debrid refuses this release by name, so that no RD account can
 * be handed it, held or not.
 *
 * RD judges an add on the torrent's own name and an unrestrict on each file's
 * name. The rule itself, and its 2026-10-03 measurement, is
 * `isRdBlockedName`'s. What this decides is which names to give it.
 *
 * The library title is what a scraper read off a listing, which is neither of
 * RD's names. On 2026-10-03, across the 7,497 RD-held hashes on the 300 most
 * recently refreshed library pages, 224 had a name on their RD row that RD
 * refuses under a title that does not show it, mostly a site writing `WEB-DL`
 * as `WEB DL`. So the names on RD's row are judged wherever there is one.
 *
 * The title is judged too, though 33 of those hashes had a refused title over
 * names RD takes. A title can be the name of one file inside a pack, which RD
 * then refuses to unrestrict, and a row filed from debridio holds a file name
 * rather than the torrent's. Leaving out one release RD would have taken costs
 * an entry in a long list; offering one it refuses costs the grab, which an
 * *arr then records as a failed download.
 */
function isRefusedByRd(release: { title: string }, rdNames?: RdCachedNames): boolean {
	const names = rdNames ? [rdNames.originalFilename, rdNames.filename] : [];
	return isRdBlockedName(release.title, names);
}

interface CacheAnswer extends ProviderCacheAnswer {
	/**
	 * Releases Real-Debrid refuses by name. Filled on the feeds that read RD's
	 * cache, empty on the rest.
	 */
	refusedByRd: Set<string>;
}

/**
 * The database's cache answer: exhaustive, so `unresolved` is always zero.
 *
 * A hash RD holds counts as cached on RD only when RD would hand it over. The
 * 2026-09-08 report was exactly this: `/rd/cached` served
 * `Dead.Of.Winter.2025.2160p.AMZN.WEB-DL.DDP5.1.H.265-FLUX`, which DMM's RD
 * table marked downloaded, and RD refused it on its name. The same discount
 * applies to the combined feed, where AllDebrid holding a release still counts.
 */
async function cacheFromDb(
	releases: LibraryRelease[],
	scope: 'any' | 'rd' | 'ad'
): Promise<CacheAnswer> {
	const rows = await cachedRowsFromDb(
		releases.map((release) => release.hash),
		scope
	);

	const refused = new Set<string>();
	if (scope !== 'ad') {
		for (const release of releases) {
			if (isRefusedByRd(release, rows.rd.get(release.hash))) refused.add(release.hash);
		}
	}

	const cached = new Set(rows.ad);
	for (const hash of rows.rd.keys()) {
		if (!refused.has(hash)) cached.add(hash);
	}
	return { cached, unresolved: 0, refusedByRd: refused };
}

/**
 * Debrid-Link's cache answer, from the releases DMM has recorded whole on it (`AvailableDl`).
 * Debrid-Link's own check is an add, which mutates, so the feed never asks Debrid-Link and
 * needs no key; like the RD and AD feeds it is exhaustive over what DMM knows.
 */
async function cacheFromDlRecord(releases: LibraryRelease[]): Promise<CacheAnswer> {
	const hashes = releases.map((release) => release.hash);
	const cached = new Set<string>();
	for (let start = 0; start < hashes.length; start += CACHE_LOOKUP_CHUNK) {
		for (const hash of await db.filterCachedHashesDl(
			hashes.slice(start, start + CACHE_LOOKUP_CHUNK)
		)) {
			cached.add(hash);
		}
	}
	return { cached, unresolved: 0, refusedByRd: new Set() };
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
	releases: LibraryRelease[],
	options: TorznabFeedOptions,
	context?: TorznabSearchContext
): Promise<CacheAnswer> {
	const scope = options.cache;
	if (scope === 'any' || scope === 'rd' || scope === 'ad') {
		return cacheFromDb(releases, scope);
	}
	if (scope === 'dl') return cacheFromDlRecord(releases);

	// A feed that names a provider is unusable without that provider's key, and
	// silently falling back to the plain feed would answer a different question
	// than the URL asks. The caller turns this into a Torznab error naming the
	// provider, so the fix is in the message rather than in an *arr's log.
	if (!context?.shortId) throw new MissingProviderKeyError(scope);
	const apiKey = await db.getSponsorProviderKey(context.shortId, scope);
	if (!apiKey) throw new MissingProviderKeyError(scope);

	const answer = await probeProviderCache(
		scope,
		apiKey,
		releases.map((release) => release.hash)
	);
	return { ...answer, refusedByRd: new Set() };
}

/**
 * The cache answer of a path naming several providers: each provider's own
 * answer, as its single feed gets it (RD's name rule, Debrid-Link's record, a
 * live probe with the sponsor's key, which fails the request without one), and
 * a release is cached when any of them holds it. RD's answer already leaves
 * out what RD refuses, so such a release counts only where another holds it.
 */
async function cacheFromProviders(
	releases: LibraryRelease[],
	providers: TorznabProvider[],
	context?: TorznabSearchContext
): Promise<CacheAnswer & { cachedOn: Map<string, TorznabProvider[]> }> {
	const answers = await Promise.all(
		providers.map((cache) => resolveCache(releases, { cache, cachedOnly: false }, context))
	);
	const cachedOn = new Map<string, TorznabProvider[]>();
	answers.forEach((answer, index) => {
		for (const hash of answer.cached) {
			cachedOn.set(hash, [...(cachedOn.get(hash) ?? []), providers[index]]);
		}
	});
	return {
		cached: new Set(cachedOn.keys()),
		unresolved: Math.max(...answers.map((answer) => answer.unresolved)),
		refusedByRd: new Set(),
		cachedOn,
	};
}

function magnetUri(hash: string, title: string): string {
	// No trackers: every consumer of this feed resolves the hash against a debrid
	// account, which needs the infohash and nothing else. `dn` is carried because
	// a client that shows a queue before the metadata arrives has nothing else to
	// display.
	return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`;
}

function toRssItem(
	release: LibraryRelease,
	cached: boolean,
	cachedOn = release.cachedOn
): TorznabRssItem {
	const seeders = cached ? CACHED_SEEDERS : UNCACHED_SEEDERS;
	return {
		...(cachedOn && { cachedOn }),
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

	// Every release on this list is cached by definition, so it skips the cache
	// lookup and answers the same on the `/cached` variant. An empty one answers
	// as before: Prowlarr and Sonarr call an indexer that returns nothing broken.
	// A path naming several providers uses it only when all of them are RD and
	// AD, which DMM keeps a cache history for; with any other it answers the
	// way those providers' own feeds do.
	const scope = options.providers
		? options.providers.every((provider) => provider === 'rd' || provider === 'ad')
			? 'any'
			: undefined
		: options.cache;
	if (!params.targeted && (scope === 'any' || scope === 'rd' || scope === 'ad')) {
		const listed = await newlyCachedReleases(t, params, scope, options.providers);
		if (listed.length > 0) {
			return {
				items: listed
					.slice(params.offset, params.offset + params.limit)
					.map((release) => toRssItem(release, true)),
				offset: params.offset,
				total: listed.length,
				unresolved: 0,
			};
		}
	}

	const releases = params.targeted ? await targetedReleases(t, params) : await recentReleases();

	const matching = releases.filter((release) =>
		matchesCategoryFilter(release.categories, params.categories)
	);
	const answer: CacheAnswer & { cachedOn?: Map<string, TorznabProvider[]> } = options.providers
		? await cacheFromProviders(matching, options.providers, context)
		: await resolveCache(matching, options, context);
	const { cached, unresolved, refusedByRd, cachedOn } = answer;

	// An `rd` feed is read by a Real-Debrid account, which can never take what RD
	// refuses by name, so those are left out rather than ranked low. The other
	// feeds keep them: AllDebrid and the rest apply no such rule.
	const offered =
		options.cache === 'rd'
			? matching.filter((release) => !refusedByRd.has(release.hash))
			: matching;
	const kept = options.cachedOnly
		? offered.filter((release) => cached.has(release.hash))
		: offered;
	kept.sort((a, b) => Number(cached.has(b.hash)) - Number(cached.has(a.hash)));

	const page = kept.slice(params.offset, params.offset + params.limit);

	return {
		items: page.map((release) =>
			toRssItem(
				release,
				cached.has(release.hash),
				cachedOn && (cachedOn.get(release.hash) ?? [])
			)
		),
		offset: params.offset,
		total: kept.length,
		unresolved,
	};
}
