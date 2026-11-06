import handler from '@/pages/api/torznab/[...route]';
import type { NewlyCachedRow, RdCachedNames } from '@/services/database/availability';
import { pairKeyOf } from '@/services/database/scrapedVerdict';
import type { ScrapeSearchResult } from '@/services/mediasearch';
import { RATE_LIMIT_CONFIGS } from '@/services/rateLimit/middlewareRateLimiter';
import { repository } from '@/services/repository';
import writtenBack from '@/services/scrapedVerdicts/__fixtures__/written-back-trash.json';
import {
	resetBlocklistForTests,
	setBlocklistForTests,
	withoutBlockedHashes,
} from '@/services/takedown/blocklist';
import {
	NEWLY_CACHED_BUILD_SECONDS,
	NEWLY_CACHED_DEPTH,
	NEWLY_CACHED_RESOLVE_LIMIT,
	NEWLY_CACHED_WINDOW_MS,
	newlyCachedStore,
	NewlyCachedStore,
	REDIS_RETRY_MS,
	RESOLVED_TTL_SECONDS,
	setNewlyCachedStore,
	type NewlyCachedLists,
} from '@/services/torznab/newlyCached';
import { ProviderProbeError } from '@/services/torznab/providerCache';
import {
	buildNewlyCached,
	CACHED_SEEDERS,
	newlyCachedBuildSettled,
	parseFeedOptions,
	runSearch,
	UNCACHED_SEEDERS,
} from '@/services/torznab/search';
import { DEFAULT_LIMIT, MAX_LIMIT, TorznabRssItem } from '@/services/torznab/xml';
import rdNameFilterProbe from '@/test/fixtures/realdebrid/rd-name-filter-2026-10-14.json';
import rdRefusedNames from '@/test/fixtures/torznab/rd-refused-names-2026-10-03.json';
import sonarrEpisodeSearch from '@/test/fixtures/torznab/sonarr-episode-search-2026-09-17.json';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { fakeRedis } from '@/test/utils/fakeIoredis';
import { isCyrillicLed } from '@/utils/cyrillicLed';
import {
	backfillFromDebridioNow,
	refreshDebridioAvailabilityInBackground,
} from '@/utils/debridioBackfill';
import { isRdBlockedName } from '@/utils/deInfringe';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// setup.ts stubs the whole rate limit module out, which would take
// `checkRateLimitFor` with it — and that function is what the 429 path is made
// of. Only the outer IP wrapper is stubbed here, as in the Newznab suite.
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (wrapped: unknown) => wrapped };
});

vi.mock('@/services/repository');
// Only a store given a Redis URL uses it; this suite runs without REDIS_URL.
vi.mock('ioredis', async () => ({
	default: (await import('@/test/utils/fakeIoredis')).FakeIoredis,
}));

// The probe itself is covered in providerCache.test.ts. What matters here is
// the wiring around it: the key lookup, the filter, and how each failure
// reaches the client. The real error classes are kept so the route's
// `instanceof` checks are the ones under test.
vi.mock('@/services/torznab/providerCache', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/torznab/providerCache')>();
	return { ...actual, probeProviderCache: (...args: unknown[]) => probeMock(...args) };
});
const probeMock = vi.fn();
vi.mock('@/services/tvdbLookup', () => ({ resolveImdbIdFromTvdbId: vi.fn() }));
vi.mock('@/utils/debridioBackfill', () => ({
	backfillFromDebridioNow: vi.fn(async () => []),
	refreshDebridioAvailabilityInBackground: vi.fn(async () => {}),
}));

// The verdicts' own lookup, answered from a recorded page; everything else in
// the module is the real one, so the filter under test is the movie page's.
const { trashedPairKeys } = vi.hoisted(() => ({ trashedPairKeys: vi.fn() }));
vi.mock('@/services/database/scrapedVerdict', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/database/scrapedVerdict')>();
	return {
		...actual,
		ScrapedVerdictService: class {
			getTrashedPairKeys = (...args: unknown[]) => trashedPairKeys(...args);
		},
	};
});

const mockRepo = vi.mocked(repository);
const mockBackfill = vi.mocked(backfillFromDebridioNow);
const mockRefresh = vi.mocked(refreshDebridioAvailabilityInBackground);

const SPONSOR_KEY = 'b'.repeat(64);
const MOVIE_ID = 'tt0111161';
const SHOW_ID = 'tt0903747';

/** Distinct hashes so a test can name one without a 40-character literal. */
const hash = (marker: string) => marker.repeat(40).slice(0, 40);
const BIG = hash('1');
const SMALL = hash('2');
const CACHED_ON_AD = hash('3');

const PAGE_UPDATED_AT = new Date('2026-02-01T10:00:00Z');

let library: Map<string, { results: unknown[]; updatedAt: Date }>;
let rdCached: Set<string>;
/** The names RD's row records for a held hash, where a test cares what they are. */
let rdNames: Map<string, RdCachedNames>;
let adCached: Set<string>;
let dlCached: Set<string>;
let reported: string[];
/** What `Available` and `AvailableAd` hold, as the RSS sync reads them. */
let cacheRows: Record<'rd' | 'ad', NewlyCachedRow[]>;
let providerKey: string | null;
let providerCached: Set<string>;
let shortId: string;
let testIp: string;

function release(title: string, fileSize: number, torrentHash: string) {
	return { title, fileSize, hash: torrentHash };
}

/**
 * Replaces the movie page with `count` distinct uncached releases, for the
 * paging tests — the three-release fixture is smaller than the page cap and so
 * cannot show one being applied.
 */
function stockLibraryWith(count: number): void {
	library.set(`movie:${MOVIE_ID}`, {
		results: Array.from({ length: count }, (_, index) =>
			release(
				`Shawshank.1994.Cut${String(index).padStart(2, '0')}`,
				10_000 - index,
				// `a`-prefixed so index 0 is not the all-zero hash, which is dropped
				// as degenerate before the page is ever cut.
				hash(`a${String(index).padStart(2, '0')}`)
			)
		),
		updatedAt: PAGE_UPDATED_AT,
	});
	rdCached = new Set();
	adCached = new Set();
	dlCached = new Set();
}

async function run(
	query: Record<string, string | string[]>,
	{
		method = 'GET',
		route = ['api'],
		ip = testIp,
	}: { method?: string; route?: string[]; ip?: string } = {}
): Promise<MockResponse> {
	const req = createMockRequest({
		method,
		query: { route, ...query },
		headers: { 'x-real-ip': ip },
		url: `/api/torznab/${route.join('/')}`,
	});
	const res = createMockResponse();
	await handler(req as never, res as never);
	return res;
}

function body(res: MockResponse): string {
	return String(res._getData());
}

/** Every `<title>` in a feed, in order, minus the channel's own. */
function titles(res: MockResponse): string[] {
	return [...body(res).matchAll(/<title>([^<]*)<\/title>/g)]
		.map((match) => match[1])
		.filter((title) => title !== 'DMM');
}

function attrValue(xml: string, name: string): string[] {
	return [...xml.matchAll(new RegExp(`<torznab:attr name="${name}" value="([^"]*)"/>`, 'g'))].map(
		(match) => match[1]
	);
}

// A request may leave a build running in the background; let it finish
// before the next test resets the mocks it reads.
afterEach(() => newlyCachedBuildSettled());

beforeAll(() => {
	// No Redis means the hybrid limiter counts in memory; no whitelist means the
	// identifiers below are actually counted.
	delete process.env.REDIS_URL;
	delete process.env.RATE_LIMIT_WHITELIST_IPS;
});

beforeEach(() => {
	vi.clearAllMocks();

	// A fresh sponsorship and IP per test: the in-memory limiter is a module
	// singleton whose buckets are keyed on both.
	shortId = `Z${Math.random().toString(36).slice(2, 8)}`;
	testIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

	library = new Map([
		[
			`movie:${MOVIE_ID}`,
			{
				results: [
					release('Shawshank.1994.2160p.BluRay', 60_000, BIG),
					release('Shawshank.1994.1080p.WEB', 4_000, SMALL),
					release('Shawshank.1994.720p.WEB', 2_000, CACHED_ON_AD),
				],
				updatedAt: PAGE_UPDATED_AT,
			},
		],
	]);
	rdCached = new Set([BIG]);
	rdNames = new Map();
	adCached = new Set([CACHED_ON_AD]);
	dlCached = new Set([SMALL]);
	reported = [];
	cacheRows = { rd: [], ad: [] };
	// A fresh shared list and title memo per test: the real store, in memory,
	// which is what runs with no REDIS_URL.
	setNewlyCachedStore(new NewlyCachedStore());
	providerKey = 'provider-key';
	providerCached = new Set([SMALL]);

	mockRepo.getSponsorByDmmApiKey = vi.fn().mockResolvedValue({
		isSponsor: true,
		sources: ['github'],
		shortId,
		githubUsername: 'someone',
		keyVersion: 1,
	});
	mockRepo.getScrapedTrueRow = vi.fn(async (key: string) => library.get(key) ?? null) as never;
	// The untargeted feed reads pages through the SQL-paged call, which returns
	// the same rows a whole-row read would, already limited.
	mockRepo.getScrapedTrueResults = vi.fn(
		async (key: string) => library.get(key)?.results
	) as never;
	mockRepo.getScrapedTrueSeasonKeys = vi.fn().mockResolvedValue([]);
	mockRepo.getRecentScrapedTrueKeys = vi.fn().mockResolvedValue([]);
	mockRepo.getImdbTitleById = vi.fn().mockResolvedValue(null);
	mockRepo.searchImdbTitles = vi.fn().mockResolvedValue([]);
	mockRepo.getReportedHashes = vi.fn(async (_imdbId: string) => reported);
	// The query's own conditions over `cacheRows`; the takedown filter on top is
	// the repository's, covered in repository.takedown.test.ts.
	mockRepo.getNewlyCached = vi.fn(async (provider: 'rd' | 'ad', since: Date, limit: number) =>
		cacheRows[provider]
			.filter((row) => row.createdAt >= since)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			.slice(0, limit)
	);
	// What the JSON_TABLE query answers (scraped.integration.test.ts runs it on
	// MySQL): every entry, as stored, on a page of any title asked about whose
	// hash in lower case any row asked about, most recently refreshed page first
	// and page order within it. As in SQL, a hash wanted for one title comes
	// back from another title's page in the same call.
	mockRepo.getScrapedTrueEntriesHolding = vi.fn(
		async (wanted: Array<{ imdbId: string; hash: string }>) => {
			const hashes = new Set(wanted.map((w) => w.hash.toLowerCase()));
			return [...library]
				.filter(([key]) =>
					wanted.some(
						(w) => key === `movie:${w.imdbId}` || key.startsWith(`tv:${w.imdbId}:`)
					)
				)
				.sort(([, a], [, b]) => b.updatedAt.getTime() - a.updatedAt.getTime())
				.flatMap(([key, page]) =>
					(page.results as ScrapeSearchResult[])
						.map((result, index) => ({
							key,
							updatedAt: page.updatedAt,
							position: index + 1,
							hash: result.hash.toLowerCase(),
							result,
						}))
						.filter((entry) => hashes.has(entry.hash))
				);
		}
	);
	// A held hash with no entry in `rdNames` is held under its own hash, a name
	// RD has no reason to refuse.
	mockRepo.getCachedRdNames = vi.fn(
		async (hashes: string[]) =>
			new Map(
				hashes
					.filter((h) => rdCached.has(h))
					.map((h) => [h, rdNames.get(h) ?? { filename: h, originalFilename: h }])
			)
	);
	mockRepo.filterCachedHashesAd = vi.fn(
		async (hashes: string[]) => new Set(hashes.filter((h) => adCached.has(h)))
	);
	mockRepo.filterCachedHashesDl = vi.fn(
		async (hashes: string[]) => new Set(hashes.filter((h) => dlCached.has(h)))
	);
	mockRepo.getSponsorProviderKey = vi.fn(
		async (_shortId: string, _service: 'tb' | 'pm' | 'oc') => providerKey
	);
	probeMock.mockReset();
	probeMock.mockImplementation(async (_service: string, _key: string, hashes: string[]) => ({
		cached: new Set(hashes.filter((h) => providerCached.has(h))),
		unresolved: 0,
	}));
});

describe('dispatch', () => {
	it('answers caps without a key, because Prowlarr asks before it has one', async () => {
		const res = await run({ t: 'caps' });

		expect(res._getStatusCode()).toBe(200);
		expect(body(res)).toContain('<caps>');
		expect(res._getHeaders()['Cache-Control']).toBe('public, s-maxage=3600');
		expect(mockRepo.getSponsorByDmmApiKey).not.toHaveBeenCalled();
	});

	it('refuses a non-GET in the protocol rather than with a 405 page', async () => {
		const res = await run({ t: 'caps' }, { method: 'POST' });

		expect(res._getStatusCode()).toBe(405);
		expect(body(res)).toContain('code="202"');
	});

	it('answers an unknown function with 202', async () => {
		const res = await run({ t: 'music', apikey: SPONSOR_KEY });
		expect(body(res)).toContain('code="202"');
	});

	it('rejects a path segment it does not recognise', async () => {
		// Serving the default feed for `/api/torznab/realdebrid` would look like a
		// working indexer quietly answering a different question.
		const res = await run({ t: 'caps' }, { route: ['realdebrid', 'api'] });
		expect(body(res)).toContain('code="202"');
	});

	it('rejects a path that is not the /api an *arr appends', async () => {
		const res = await run({ t: 'caps' }, { route: ['rd'] });
		expect(body(res)).toContain('code="202"');
	});

	it('answers an internal failure in the protocol, not as an HTML 500', async () => {
		mockRepo.getScrapedTrueRow = vi.fn().mockRejectedValue(new Error('database is gone'));

		const res = await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });

		expect(res._getStatusCode()).toBe(200);
		expect(body(res)).toContain('code="900"');
	});
});

describe('auth', () => {
	it('separates an unknown key from a lapsed sponsorship', async () => {
		mockRepo.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(null);
		expect(body(await run({ t: 'search', apikey: SPONSOR_KEY }))).toContain('code="100"');

		mockRepo.getSponsorByDmmApiKey = vi.fn().mockResolvedValue({ isSponsor: false, shortId });
		expect(body(await run({ t: 'search', apikey: SPONSOR_KEY }))).toContain('code="101"');
	});

	it('refuses a search with no key at all', async () => {
		expect(body(await run({ t: 'search' }))).toContain('code="100"');
	});

	it('accepts the header form a person testing with curl would use', async () => {
		const req = createMockRequest({
			method: 'GET',
			query: { route: ['api'], t: 'movie', imdbid: MOVIE_ID },
			headers: { 'x-real-ip': testIp, 'x-api-key': SPONSOR_KEY },
			url: '/api/torznab/api',
		});
		const res = createMockResponse();
		await handler(req as never, res as never);

		expect(body(res)).toContain('<item>');
	});
});

describe('search', () => {
	it('serves the library page for a movie id', async () => {
		const res = await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });

		expect(res._getHeaders()['Content-Type']).toBe('application/rss+xml; charset=utf-8');
		// Cached first, then biggest first within each group.
		expect(titles(res)).toEqual([
			'Shawshank.1994.2160p.BluRay',
			'Shawshank.1994.720p.WEB',
			'Shawshank.1994.1080p.WEB',
		]);
	});

	it('accepts the bare, unpadded id Prowlarr sends', async () => {
		const res = await run({ t: 'movie', imdbid: '111161', apikey: SPONSOR_KEY });
		expect(mockRepo.getScrapedTrueRow).toHaveBeenCalledWith(`movie:${MOVIE_ID}`);
		expect(titles(res)).toHaveLength(3);
	});

	it('reads only the trusted table', async () => {
		// The other one carries fabricated titles against real hashes, which an
		// *arr matches on and would import as the wrong film.
		await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });
		expect(mockRepo.getScrapedResults).not.toHaveBeenCalled();
	});

	it('carries the infohash as the download, the guid and the attribute', async () => {
		const xml = body(await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY }));

		expect(xml).toContain(`<guid isPermaLink="false">${BIG}</guid>`);
		expect(xml).toContain(
			`<link>magnet:?xt=urn:btih:${BIG}&amp;dn=Shawshank.1994.2160p.BluRay`
		);
		expect(attrValue(xml, 'infohash')).toContain(BIG);
	});

	it('converts the library size from MiB to the bytes a client expects', async () => {
		const xml = body(await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY }));
		expect(attrValue(xml, 'size')[0]).toBe(String(60_000 * 1024 * 1024));
	});

	it('dates every release from the page it was read out of', async () => {
		// The library records no posting date, so the page's own timestamp is the
		// only real date there is — and a feed with no date at all is refused.
		const xml = body(await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY }));
		expect(xml).toContain(`<pubDate>${PAGE_UPDATED_AT.toUTCString()}</pubDate>`);
	});

	it('labels categories from the page kind and the release title', async () => {
		const xml = body(await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY }));
		expect(attrValue(xml, 'category')).toEqual([
			'2000',
			'2045',
			'2000',
			'2040',
			'2000',
			'2040',
		]);
	});

	it('reads a season page for a TV search', async () => {
		library.set(`tv:${SHOW_ID}:2`, {
			results: [release('Show.S02E01.1080p.WEB', 1_500, BIG)],
			updatedAt: PAGE_UPDATED_AT,
		});

		const res = await run({
			t: 'tvsearch',
			imdbid: SHOW_ID,
			season: '2',
			ep: '1',
			apikey: SPONSOR_KEY,
		});

		expect(mockRepo.getScrapedTrueRow).toHaveBeenCalledWith(`tv:${SHOW_ID}:2`);
		expect(titles(res)).toEqual(['Show.S02E01.1080p.WEB']);
	});

	describe('an episode search', () => {
		// Sonarr's `SingleEpisodeSearchMatchSpecification` rejects, on a search
		// for one episode, a release from another season, a season pack and a
		// release whose episodes leave the searched one out. These are the shapes
		// of each, plus what it accepts.
		const season2 = [
			release('Show.S02.COMPLETE.1080p.WEB', 20_000, hash('a')),
			release('Show.S02E07.1080p.WEB', 1_500, hash('b')),
			release('Show 2x07 720p', 700, hash('c')),
			release('Show.S02E06-E08.1080p.WEB', 4_500, hash('d')),
			release('Show.S02E06E07.720p.HDTV', 1_400, hash('e')),
			release('Show.S02E08.1080p.WEB', 1_500, hash('f')),
			release('Show.S01E07.1080p.WEB', 1_500, hash('7')),
			release('Show.S01-S05.1080p.BluRay', 90_000, hash('8')),
		];

		beforeEach(() => {
			library.set(`tv:${SHOW_ID}:2`, { results: season2, updatedAt: PAGE_UPDATED_AT });
		});

		const search = (extra: Record<string, string>) =>
			run({ t: 'tvsearch', imdbid: SHOW_ID, season: '2', apikey: SPONSOR_KEY, ...extra });

		it('answers with the releases that hold that episode, ranges included', async () => {
			expect(titles(await search({ ep: '7' }))).toEqual([
				'Show.S02E06-E08.1080p.WEB',
				'Show.S02E07.1080p.WEB',
				'Show.S02E06E07.720p.HDTV',
				'Show 2x07 720p',
			]);
		});

		it('leaves season packs to the season search, which still has them', async () => {
			expect(titles(await search({ ep: '7' }))).not.toContain('Show.S02.COMPLETE.1080p.WEB');

			const season = titles(await search({}));
			expect(season).toContain('Show.S02.COMPLETE.1080p.WEB');
			expect(season).toContain('Show.S01-S05.1080p.BluRay');
			expect(season).toHaveLength(season2.length);
		});

		it('names the filtered set as the total, so a client stops paging there', async () => {
			const xml = body(await search({ ep: '7', limit: '2' }));

			expect(xml).toContain('<torznab:response offset="0" total="4"/>');
		});

		it('does not take an episode out of a pack name the way ptt does', async () => {
			// From seasonNaming's corpus: `ptt` reads episode 2 out of `2xRus`.
			library.set(`tv:${SHOW_ID}:2`, {
				results: [release('The.Wire.S02.720p.WEB-DL.2xRus.Eng.HDCLUB', 30_000, BIG)],
				updatedAt: PAGE_UPDATED_AT,
			});

			expect(titles(await search({ ep: '2' }))).toEqual([]);
		});

		it('reads specials and a daily show’s date the way it always did', async () => {
			// Sonarr also matches a special by its episode title, which need not
			// carry `S00E03`, and a daily show's `ep` is a date.
			library.set(`tv:${SHOW_ID}:0`, {
				results: [release('Show.Behind.The.Scenes.1080p.WEB', 900, BIG)],
				updatedAt: PAGE_UPDATED_AT,
			});

			expect(titles(await search({ season: '00', ep: '3' }))).toEqual([
				'Show.Behind.The.Scenes.1080p.WEB',
			]);
			expect(titles(await search({ ep: '10/03' }))).toHaveLength(season2.length);
			expect(titles(await search({ ep: '0' }))).toHaveLength(season2.length);
		});
	});

	it('drops what the community reported as wrong content', async () => {
		reported = [BIG];

		const res = await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });

		expect(titles(res)).not.toContain('Shawshank.1994.2160p.BluRay');
		expect(titles(res)).toHaveLength(2);
	});

	it('serves the unfiltered set when the report lookup fails', async () => {
		mockRepo.getReportedHashes = vi.fn().mockRejectedValue(new Error('table is gone'));

		expect(
			titles(await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY }))
		).toHaveLength(3);
	});
});

// Recorded 2026-10-04: Doraemon: Nobita's Little Star Wars, four of whose seven
// ScrapedTrue releases carry a trash verdict. The verdict pass had moved all four
// to ScrapedTrash on 2026-09-29, and a scraper wrote them back on 2026-10-02.
describe('releases the verdicts judged not to be the movie', () => {
	const page = writtenBack.pages.find((p) => p.imdbId === 'tt0313990')!;
	const entries = page.ScrapedTrue!.entries;
	const trashed = entries.filter((e) => e.verdict === 'trash').map((e) => e.hash);
	const others = entries.filter((e) => e.verdict !== 'trash').map((e) => e.hash);
	const search = () => run({ t: 'movie', imdbid: page.imdbId, apikey: SPONSOR_KEY });
	const served = async (res?: MockResponse) =>
		attrValue(body(res ?? (await search())), 'infohash').sort();

	beforeEach(() => {
		vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
		library.set(page.key, {
			results: entries.map(({ hash, title, fileSize }) => ({ hash, title, fileSize })),
			updatedAt: new Date(page.ScrapedTrue!.updatedAt),
		});
		// What ScrapedVerdict holds for the page: a trash verdict per (hash, title).
		trashedPairKeys.mockReset().mockImplementation(async (imdbId: string, hashes: string[]) => {
			if (imdbId !== page.imdbId) return new Set();
			return new Set(
				entries
					.filter((e) => e.verdict === 'trash' && hashes.includes(e.hash))
					.map((e) => pairKeyOf(e.hash, e.title))
			);
		});
	});
	afterEach(() => vi.unstubAllEnvs());

	it('leaves out the trashed releases a scraper wrote back to the page', async () => {
		expect(trashed).toHaveLength(4);
		expect(await served()).toEqual([...others].sort());
		expect(trashedPairKeys).toHaveBeenCalledWith(page.imdbId, expect.any(Array));
	});

	it('leaves them out of the RSS sync too', async () => {
		mockRepo.getRecentScrapedTrueKeys = vi
			.fn()
			.mockResolvedValue([
				{ key: page.key, updatedAt: new Date(page.ScrapedTrue!.updatedAt) },
			]);

		const res = await run({ t: 'search', apikey: SPONSOR_KEY });

		expect(attrValue(body(res), 'infohash').sort()).toEqual([...others].sort());
	});

	it('serves the page whole when the verdicts are switched off or cannot be read', async () => {
		vi.stubEnv('TYPESAFE_API_KEY', '');
		expect(await served()).toEqual(entries.map((e) => e.hash).sort());

		vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
		trashedPairKeys.mockRejectedValue(new Error('table is gone'));
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await served()).toEqual(entries.map((e) => e.hash).sort());
	});

	it('does not ask about a season page', async () => {
		library.set(`tv:${SHOW_ID}:1`, {
			results: [release('Show.S01E01.1080p.WEB', 900, hash('7'))],
			updatedAt: PAGE_UPDATED_AT,
		});

		const res = await run({ t: 'tvsearch', imdbid: SHOW_ID, season: '1', apikey: SPONSOR_KEY });

		expect(attrValue(body(res), 'infohash')).toEqual([hash('7')]);
		expect(trashedPairKeys).not.toHaveBeenCalled();
	});
});

describe('paging and filtering', () => {
	it('reports the size of the whole set while serving one page', async () => {
		const res = await run({
			t: 'movie',
			imdbid: MOVIE_ID,
			limit: '1',
			offset: '1',
			apikey: SPONSOR_KEY,
		});

		expect(body(res)).toContain('<torznab:response offset="1" total="3"/>');
		expect(titles(res)).toEqual(['Shawshank.1994.720p.WEB']);
	});

	it('honours a category filter and counts what survives it', async () => {
		const res = await run({
			t: 'movie',
			imdbid: MOVIE_ID,
			cat: '2045',
			apikey: SPONSOR_KEY,
		});

		expect(titles(res)).toEqual(['Shawshank.1994.2160p.BluRay']);
		expect(body(res)).toContain('total="1"');
	});

	it('caps limit at what the caps document promises', async () => {
		stockLibraryWith(MAX_LIMIT + 5);

		const res = await run({
			t: 'movie',
			imdbid: MOVIE_ID,
			limit: '5000',
			apikey: SPONSOR_KEY,
		});

		expect(titles(res)).toHaveLength(MAX_LIMIT);
		// The whole set is still named, so a client knows to keep paging.
		expect(body(res)).toContain(`total="${MAX_LIMIT + 5}"`);
	});

	it('serves the default page to a client that names no limit', async () => {
		stockLibraryWith(25);

		const res = await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });

		expect(titles(res)).toHaveLength(DEFAULT_LIMIT);
		expect(body(res)).toContain('total="25"');
	});

	it('reaches what the cap held back through offset', async () => {
		stockLibraryWith(25);

		const first = titles(await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY }));
		const second = titles(
			await run({ t: 'movie', imdbid: MOVIE_ID, offset: '10', apikey: SPONSOR_KEY })
		);
		const third = titles(
			await run({ t: 'movie', imdbid: MOVIE_ID, offset: '20', apikey: SPONSOR_KEY })
		);

		expect(second).toHaveLength(DEFAULT_LIMIT);
		expect(third).toHaveLength(5);
		// Three pages, no overlap, and between them the whole set.
		expect(new Set([...first, ...second, ...third]).size).toBe(25);
	});
});

describe('the debrid cache signal', () => {
	it('reports a cached release above an uncached one', async () => {
		const xml = body(await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY }));

		// BIG is on Real-Debrid, CACHED_ON_AD on AllDebrid, SMALL on neither.
		expect(attrValue(xml, 'seeders')).toEqual([
			String(CACHED_SEEDERS),
			String(CACHED_SEEDERS),
			String(UNCACHED_SEEDERS),
		]);
	});

	// Measured against the live library: without this the first hundred results
	// of a movie search were almost all 24-terabyte "top 5000 movies" packs,
	// because the library is stored biggest-first and a client reads page one.
	it('puts cached releases on the first page, keeping size order within a group', async () => {
		library.set(`movie:${MOVIE_ID}`, {
			results: [
				release('Huge.Junk.Pack.1080p', 9_000_000, hash('5')),
				release('Small.But.Cached.1080p', 3_000, BIG),
			],
			updatedAt: PAGE_UPDATED_AT,
		});

		const res = await run({ t: 'movie', imdbid: MOVIE_ID, limit: '1', apikey: SPONSOR_KEY });

		expect(titles(res)).toEqual(['Small.But.Cached.1080p']);
	});

	it('orders by the cache the feed was asked about, not another provider’s', async () => {
		const res = await run(
			{ t: 'movie', imdbid: MOVIE_ID, limit: '1', apikey: SPONSOR_KEY },
			{ route: ['ad', 'api'] }
		);

		expect(titles(res)).toEqual(['Shawshank.1994.720p.WEB']);
	});

	it('never reports zero, which an *arr reads as a dead release', async () => {
		rdCached = new Set();
		adCached = new Set();

		const xml = body(await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY }));

		expect(attrValue(xml, 'seeders').every((value) => Number(value) > 0)).toBe(true);
	});

	it('scopes the signal to one provider when the path says so', async () => {
		const xml = body(
			await run(
				{ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY },
				{ route: ['rd', 'api'] }
			)
		);

		expect(mockRepo.filterCachedHashesAd).not.toHaveBeenCalled();
		expect(attrValue(xml, 'seeders')).toEqual([
			String(CACHED_SEEDERS),
			String(UNCACHED_SEEDERS),
			String(UNCACHED_SEEDERS),
		]);
	});

	it('serves only cached releases on the cached feed, and counts only those', async () => {
		const res = await run(
			{ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY },
			{ route: ['cached', 'api'] }
		);

		expect(titles(res)).toEqual(['Shawshank.1994.2160p.BluRay', 'Shawshank.1994.720p.WEB']);
		expect(body(res)).toContain('total="2"');
	});

	it('combines the provider and the filter', async () => {
		const res = await run(
			{ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY },
			{ route: ['ad', 'cached', 'api'] }
		);

		expect(titles(res)).toEqual(['Shawshank.1994.720p.WEB']);
	});

	// zurg serves Debrid-Link too, and DMM records its releases, but no feed read them.
	it("reads the Debrid-Link feed from DMM's record of it, with no provider key", async () => {
		providerKey = null;
		const xml = body(
			await run(
				{ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY },
				{ route: ['dl', 'api'] }
			)
		);
		expect(mockRepo.getCachedRdNames).not.toHaveBeenCalled();
		expect(mockRepo.filterCachedHashesAd).not.toHaveBeenCalled();
		expect(probeMock).not.toHaveBeenCalled();
		// cached first, as every feed orders
		expect(attrValue(xml, 'seeders')).toEqual([
			String(CACHED_SEEDERS),
			String(UNCACHED_SEEDERS),
			String(UNCACHED_SEEDERS),
		]);

		const cached = await run(
			{ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY },
			{ route: ['dl', 'cached', 'api'] }
		);
		expect(titles(cached)).toEqual(['Shawshank.1994.1080p.WEB']);
	});

	it('filters before paging, so the second page of a filtered feed is right', async () => {
		const res = await run(
			{ t: 'movie', imdbid: MOVIE_ID, offset: '1', apikey: SPONSOR_KEY },
			{ route: ['cached', 'api'] }
		);

		expect(titles(res)).toEqual(['Shawshank.1994.720p.WEB']);
		expect(body(res)).toContain('<torznab:response offset="1" total="2"/>');
	});
});

describe('provider-backed cache filters', () => {
	const feedTitles = async (route: string[]) =>
		titles(
			await run({ t: 'movie', imdbid: MOVIE_ID.slice(2), apikey: SPONSOR_KEY }, { route })
		);

	// Real-Debrid and AllDebrid come out of DMM's own tables, so a provider feed
	// is the only kind that needs anything linked. It has to say so rather than
	// quietly answering the plain feed, which would be a different question than
	// the URL asked.
	it('names the provider and where to link it when no key is stored', async () => {
		providerKey = null;

		const res = await run(
			{ t: 'movie', imdbid: MOVIE_ID.slice(2), apikey: SPONSOR_KEY },
			{ route: ['tb', 'cached', 'api'] }
		);

		expect(res._getStatusCode()).toBe(200);
		expect(body(res)).toContain('code="102"');
		expect(body(res)).toContain('TorBox');
		// The link form is on /torznab; Settings on the home page has none (#623).
		expect(body(res)).toContain('debridmediamanager.com/torznab');
		expect(body(res)).not.toContain('DMM Settings');
	});

	it('asks the provider named in the path, with that sponsor own key', async () => {
		await feedTitles(['pm', 'cached', 'api']);

		expect(mockRepo.getSponsorProviderKey).toHaveBeenCalledWith(shortId, 'pm');
		expect(probeMock).toHaveBeenCalledWith('pm', 'provider-key', expect.any(Array));
	});

	it('keeps only what the provider holds on a cached feed', async () => {
		providerCached = new Set([SMALL]);

		expect(await feedTitles(['tb', 'cached', 'api'])).toEqual(['Shawshank.1994.1080p.WEB']);
	});

	it('reports the provider signal without filtering on the plain variant', async () => {
		providerCached = new Set([SMALL]);

		const res = await run(
			{ t: 'movie', imdbid: MOVIE_ID.slice(2), apikey: SPONSOR_KEY },
			{ route: ['oc', 'api'] }
		);

		expect(titles(res)).toHaveLength(3);
		// Cached first, and carrying the seeder count a client ranks on.
		expect(titles(res)[0]).toBe('Shawshank.1994.1080p.WEB');
		expect(attrValue(body(res), 'seeders')[0]).toBe(String(CACHED_SEEDERS));
		expect(attrValue(body(res), 'seeders')[1]).toBe(String(UNCACHED_SEEDERS));
	});

	// An empty feed reads to an *arr as "this release does not exist" rather
	// than as a broken indexer, so a failed probe has to be said out loud.
	it('reports a probe failure rather than serving an empty feed', async () => {
		probeMock.mockRejectedValue(new ProviderProbeError('tb', 'TorBox said no'));

		const res = await run(
			{ t: 'movie', imdbid: MOVIE_ID.slice(2), apikey: SPONSOR_KEY },
			{ route: ['tb', 'cached', 'api'] }
		);

		expect(body(res)).toContain('code="900"');
		expect(body(res)).toContain('TorBox said no');
		expect(body(res)).not.toContain('<item>');
	});

	// Debrid-Link's own check is an add, which would spend the caller's quota on every
	// search, so its feed reads only DMM's record of it and never probes. An unknown segment
	// is still rejected rather than ignored.
	it('never probes Debrid-Link, and still rejects an unknown provider', async () => {
		await feedTitles(['dl', 'cached', 'api']);
		expect(probeMock).not.toHaveBeenCalled();
		expect(mockRepo.getSponsorProviderKey).not.toHaveBeenCalled();

		const res = await run(
			{ t: 'movie', imdbid: MOVIE_ID.slice(2), apikey: SPONSOR_KEY },
			{ route: ['realdebrid', 'api'] }
		);
		expect(body(res)).toContain('code="202"');
	});

	it('leaves the database-backed feeds asking nobody for a key', async () => {
		await feedTitles(['rd', 'cached', 'api']);

		expect(mockRepo.getSponsorProviderKey).not.toHaveBeenCalled();
		expect(probeMock).not.toHaveBeenCalled();
	});
});

describe('debridio', () => {
	it('fills a page nothing has scraped yet, on this very request', async () => {
		mockBackfill.mockResolvedValue([
			{ title: 'Unscraped.Film.2024.1080p.WEB', fileSize: 3_000, hash: SMALL },
		]);

		const res = await run({ t: 'movie', imdbid: 'tt5000000', apikey: SPONSOR_KEY });

		expect(mockBackfill).toHaveBeenCalledWith({
			imdbId: 'tt5000000',
			key: 'movie:tt5000000',
			kind: 'movie',
			season: undefined,
		});
		expect(titles(res)).toEqual(['Unscraped.Film.2024.1080p.WEB']);
	});

	it('asks about the season a TV search named', async () => {
		mockBackfill.mockResolvedValue([]);

		await run({ t: 'tvsearch', imdbid: SHOW_ID, season: '4', apikey: SPONSOR_KEY });

		expect(mockBackfill).toHaveBeenCalledWith({
			imdbId: SHOW_ID,
			key: `tv:${SHOW_ID}:4`,
			kind: 'series',
			season: 4,
		});
	});

	it('refreshes the cache markers of a page it did serve, without holding the response', async () => {
		await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });

		expect(mockBackfill).not.toHaveBeenCalled();
		expect(mockRefresh).toHaveBeenCalledWith({
			imdbId: MOVIE_ID,
			key: `movie:${MOVIE_ID}`,
			kind: 'movie',
			season: undefined,
		});
	});

	it('answers an empty feed rather than failing when debridio knows nothing', async () => {
		mockBackfill.mockResolvedValue([]);

		const res = await run({ t: 'movie', imdbid: 'tt5000000', apikey: SPONSOR_KEY });

		expect(res._getStatusCode()).toBe(200);
		expect(body(res)).toContain('total="0"');
		expect(body(res)).not.toContain('<item>');
	});
});

describe('the untargeted feed', () => {
	it('answers an RSS sync from the most recently refreshed pages', async () => {
		// Prowlarr tests an indexer with exactly this request and reports an empty
		// answer as a failure, so it has to return something.
		mockRepo.getRecentScrapedTrueKeys = vi.fn().mockResolvedValue([
			{ key: `movie:${MOVIE_ID}`, updatedAt: PAGE_UPDATED_AT },
			{ key: `tv:${SHOW_ID}:1`, updatedAt: PAGE_UPDATED_AT },
		]);
		library.set(`tv:${SHOW_ID}:1`, {
			results: [release('Show.S01.1080p.WEB', 9_000, hash('4'))],
			updatedAt: PAGE_UPDATED_AT,
		});

		const res = await run({ t: 'search', apikey: SPONSOR_KEY });

		expect(titles(res)).toEqual([
			'Shawshank.1994.2160p.BluRay',
			'Shawshank.1994.720p.WEB',
			'Shawshank.1994.1080p.WEB',
			'Show.S01.1080p.WEB',
		]);
	});

	it('reads recent pages through the SQL-paged call, not whole rows', async () => {
		// Eight pages of a popular title read whole, on every client's timer, is
		// megabytes over the wire per sync.
		mockRepo.getRecentScrapedTrueKeys = vi
			.fn()
			.mockResolvedValue([{ key: `movie:${MOVIE_ID}`, updatedAt: PAGE_UPDATED_AT }]);

		await run({ t: 'search', apikey: SPONSOR_KEY });

		expect(mockRepo.getScrapedTrueResults).toHaveBeenCalledWith(`movie:${MOVIE_ID}`, 0, 0);
		expect(mockRepo.getScrapedTrueRow).not.toHaveBeenCalled();
	});

	it('never scrapes for an RSS sync', async () => {
		mockRepo.getRecentScrapedTrueKeys = vi.fn().mockResolvedValue([]);

		await run({ t: 'search', apikey: SPONSOR_KEY });

		expect(mockBackfill).not.toHaveBeenCalled();
		expect(mockRefresh).not.toHaveBeenCalled();
	});
});

describe('the RSS sync on the Real-Debrid and AllDebrid feeds', () => {
	// The library is production's: Dead of Winter (2025) and The Crow (2024)
	// whole, with the RD row of every hash on them DMM marks cached, and Silo's
	// season 3 page. Only the times the rows were recorded are made up, and the
	// Silo rows carry their release's title as RD's names.
	const DEAD_OF_WINTER = 'tt7574556';
	const THE_CROW = 'tt1340094';
	const SILO = sonarrEpisodeSearch.page;
	const SILO_ID = 'tt14688458';
	const REFUSED = rdRefusedNames.reported.hash;
	const CYRILLIC = '15ce0237bc9706bef34fa2d798b847526fb32f35';
	const NOW = new Date('2026-11-06T12:00:00Z').getTime();
	const MINUTE = 60_000;
	const BUILD_INTERVAL = NEWLY_CACHED_BUILD_SECONDS * 1000;

	const titleOf = (torrentHash: string) =>
		[...rdRefusedNames.pages, SILO]
			.flatMap((page) => page.results)
			.find((result) => result.hash === torrentHash)!.title;

	/** The fixture's RD rows, the first newest, one a minute back from `newest`. */
	function movieRows(newest: number): NewlyCachedRow[] {
		return rdRefusedNames.rdCached.map((row, index) => ({
			hash: row.hash,
			imdbId: rdRefusedNames.pages
				.find((page) => page.results.some((result) => result.hash === row.hash))!
				.key.split(':')[1],
			season: null,
			createdAt: new Date(newest - index * MINUTE),
			filename: row.filename,
			originalFilename: row.originalFilename,
		}));
	}

	/**
	 * Silo releases every feed serves: 606 of the page's 1,503, the rest named
	 * the way RD refuses or Cyrillic-led, which the cases about those cover on
	 * the films' own rows.
	 */
	const SILO_SERVED = SILO.results.filter(
		(result) => !isRdBlockedName(result.title) && !isCyrillicLed(result.title)
	);

	/** Cache rows for served Silo releases `from` to `to`, the last newest, a second apart. */
	function siloRows(from: number, to: number, newest: number): NewlyCachedRow[] {
		return SILO_SERVED.slice(from, to).map((result, index, slice) => ({
			hash: result.hash,
			imdbId: SILO_ID,
			season: 3,
			createdAt: new Date(newest - (slice.length - 1 - index) * 1000),
			filename: result.title,
			originalFilename: result.title,
		}));
	}

	/** Cache rows whose hash no library page holds, the last newest, a second apart. */
	function strayRows(count: number, newest: number): NewlyCachedRow[] {
		return Array.from({ length: count }, (_, index) => ({
			hash: `5${index.toString(16).padStart(39, '0')}`,
			imdbId: SILO_ID,
			season: 3,
			createdAt: new Date(newest - (count - 1 - index) * 1000),
			filename: 'Stray',
			originalFilename: 'Stray',
		}));
	}

	/** What the list may hold of a row: what the library serves, minus RD's refusals. */
	const servable = (row: NewlyCachedRow, rd = true) =>
		!isCyrillicLed(titleOf(row.hash)) &&
		!(rd && isRdBlockedName(titleOf(row.hash), [row.originalFilename, row.filename]));

	const newestFirst = (rows: NewlyCachedRow[]) =>
		[...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

	/** One build, as the instance that claimed it runs it. */
	async function build(at: number = Date.now()): Promise<NewlyCachedLists> {
		const store = newlyCachedStore();
		const lists = await buildNewlyCached(await store.readLists(), at);
		await store.writeLists(lists);
		return lists;
	}

	/** The repository reads that take a whole page, which no build may make. */
	const wholePageReads = () => [
		mockRepo.getScrapedTrueRow,
		mockRepo.getScrapedTrueResults,
		mockRepo.getAllScrapedTrueResults,
		mockRepo.getRecentScrapedTrueKeys,
	];

	interface FeedItem {
		hash: string;
		pubDate: number;
		link: string;
		seeders: number;
		categories: number[];
	}

	function items(res: MockResponse): FeedItem[] {
		return [...body(res).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
			hash: /<guid isPermaLink="false">([^<]+)</.exec(item)![1],
			pubDate: Date.parse(/<pubDate>([^<]+)</.exec(item)![1]),
			link: /<link>([^<]+)</.exec(item)![1],
			seeders: Number(attrValue(item, 'seeders')[0]),
			categories: [...item.matchAll(/<category>(\d+)</g)].map((match) => Number(match[1])),
		}));
	}

	const sync = (query: Record<string, string>, route = ['rd', 'cached', 'api']) =>
		run({ apikey: SPONSOR_KEY, ...query }, { route });

	/** A request that claims the build, and the build it starts in the background. */
	async function buildThroughRoute(): Promise<void> {
		await sync({ t: 'search' });
		await newlyCachedBuildSettled();
	}

	const toSecond = (ms: number) => Math.floor(ms / 1000) * 1000;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		library = new Map(
			[...rdRefusedNames.pages, SILO].map((page) => [
				page.key,
				{ results: page.results, updatedAt: new Date(page.updatedAt) },
			])
		);
		// What the targeted and fallback paths read as cached.
		rdCached = new Set(rdRefusedNames.rdCached.map((row) => row.hash));
		rdNames = new Map(
			rdRefusedNames.rdCached.map((row) => [
				row.hash,
				{ filename: row.filename, originalFilename: row.originalFilename },
			])
		);
		adCached = new Set();
		// The old answer, so a fallback has something to show.
		mockRepo.getRecentScrapedTrueKeys = vi
			.fn()
			.mockResolvedValue([{ key: `movie:${DEAD_OF_WINTER}`, updatedAt: new Date(NOW) }]);
	});

	afterEach(async () => {
		await newlyCachedBuildSettled();
		vi.useRealTimers();
		vi.unstubAllEnvs();
		resetBlocklistForTests();
	});

	describe('a build', () => {
		it('first lists what was recorded as cached, newest first, dated by that record', async () => {
			cacheRows.rd = movieRows(NOW - MINUTE);

			const { rd } = await build();

			const expected = newestFirst(cacheRows.rd).filter((row) => servable(row));
			expect(rd.map((release) => release.hash)).toEqual(expected.map((row) => row.hash));
			for (const field of ['cachedAt', 'listedAt'] as const) {
				expect(rd.map((release) => release[field])).toEqual(
					expected.map((row) => row.createdAt.getTime())
				);
			}
			expect(rd[0].title).toBe(titleOf(expected[0].hash));
		});

		it('lists what arrives later at its own build, ahead of what was there', async () => {
			cacheRows.rd = siloRows(0, 10, NOW - MINUTE);
			const first = await build();

			// Recorded before the first build's newest, but first seen now.
			const late = siloRows(10, 12, NOW - 2 * MINUTE);
			cacheRows.rd.push(...late);
			const at = NOW + BUILD_INTERVAL;
			const { rd } = await build(at);

			expect(rd.slice(2)).toEqual(first.rd);
			expect(rd.slice(0, 2).map((release) => [release.hash, release.listedAt])).toEqual(
				newestFirst(late).map((row) => [row.hash, at])
			);
			expect(rd[0].cachedAt).toBe(newestFirst(late)[0].createdAt.getTime());
		});

		it('asks for the newest rows of each provider inside the window', async () => {
			await build();

			const since = new Date(NOW - NEWLY_CACHED_WINDOW_MS);
			expect(mockRepo.getNewlyCached).toHaveBeenCalledWith('rd', since, NEWLY_CACHED_DEPTH);
			expect(mockRepo.getNewlyCached).toHaveBeenCalledWith('ad', since, NEWLY_CACHED_DEPTH);
			expect(NEWLY_CACHED_DEPTH).toBe(3000);
			expect(NEWLY_CACHED_WINDOW_MS).toBe(7 * 24 * 60 * MINUTE);
		});

		it('leaves out a row whose hash is on no page of its own title', async () => {
			// Dead of Winter's page holds `onMovie`, asked about for The Crow in the
			// same query: the answer must not be taken from the other title's page.
			const [onMovie] = movieRows(NOW).filter((row) => row.imdbId === DEAD_OF_WINTER);
			const [onPage] = siloRows(0, 1, NOW);
			cacheRows.ad = [
				onPage,
				{ ...onMovie, imdbId: THE_CROW, createdAt: new Date(NOW - 1000) },
				...strayRows(1, NOW - 2000),
			];

			const { ad } = await build();

			expect(ad.map((release) => release.hash)).toEqual([onPage.hash]);
		});

		it("takes a hash two titles' pages hold from each row's own title", async () => {
			// One query asks about both; Dead of Winter's page comes back first.
			const [onMovie] = movieRows(NOW).filter((row) => row.imdbId === DEAD_OF_WINTER);
			const crow = library.get(`movie:${THE_CROW}`)!;
			library.set(`movie:${THE_CROW}`, {
				results: [...crow.results, release('The.Crow.2024.1080p.WEB', 1_000, onMovie.hash)],
				updatedAt: new Date('2025-01-01T00:00:00Z'),
			});
			cacheRows.ad = [onMovie, { ...onMovie, imdbId: THE_CROW }];
			adCached = new Set();

			await build();

			const memo = await newlyCachedStore().readResolved([
				`${DEAD_OF_WINTER}:${onMovie.hash}`,
				`${THE_CROW}:${onMovie.hash}`,
			]);
			expect([...memo.values()].map((release) => release?.title)).toEqual([
				titleOf(onMovie.hash),
				'The.Crow.2024.1080p.WEB',
			]);
		});

		it("serves a TV row from its own season's page, else another season's", async () => {
			const [own, elsewhere] = siloRows(0, 2, NOW);
			// Season 2 holds both under other names, refreshed more recently than season 3.
			library.set(`tv:${SILO_ID}:2`, {
				results: [own, elsewhere].map((row) =>
					release(`Silo.S02.${row.hash}`, 1_000, row.hash)
				),
				updatedAt: new Date(NOW),
			});
			library.set(SILO.key, {
				results: SILO.results.filter((result) => result.hash !== elsewhere.hash),
				updatedAt: new Date(SILO.updatedAt),
			});
			cacheRows.rd = [own, elsewhere];

			const { rd } = await build();

			expect(rd.map((release) => [release.hash, release.title])).toEqual([
				[elsewhere.hash, `Silo.S02.${elsewhere.hash}`],
				[own.hash, titleOf(own.hash)],
			]);
		});

		it('lists what a search of the same page serves, when the page holds the hash more than once', async () => {
			const [row] = siloRows(0, 1, NOW);
			library.set(SILO.key, {
				results: [
					release('', 1, row.hash),
					// A search never serves an upper-case hash.
					release('Silo.S03.upper', 1_000, row.hash.toUpperCase()),
					release('Silo &amp; Co.S03.1080p', 2_000, row.hash),
					release('Silo.S03.later', 3_000, row.hash),
				],
				updatedAt: new Date(SILO.updatedAt),
			});
			cacheRows.ad = [row];

			const { ad } = await build();
			const searched = items(
				await sync({ t: 'tvsearch', imdbid: SILO_ID, season: '3', limit: '100' }, ['api'])
			);

			expect(ad.map((release) => [release.hash, release.title])).toEqual([
				[row.hash, 'Silo & Co.S03.1080p'],
			]);
			expect(searched.map((item) => item.hash)).toEqual([row.hash]);
			// The same title, as the feed's XML escapes it.
			expect(
				titles(await sync({ t: 'tvsearch', imdbid: SILO_ID, season: '3' }, ['api']))
			).toEqual(['Silo &amp; Co.S03.1080p']);
		});

		it('leaves a hash whose only entry is upper case off the list, as a search does', async () => {
			const [row] = siloRows(0, 1, NOW);
			library.set(SILO.key, {
				results: [release('Silo.S03.upper', 1_000, row.hash.toUpperCase())],
				updatedAt: new Date(SILO.updatedAt),
			});
			cacheRows.ad = [row];

			expect((await build()).ad).toEqual([]);
			expect(
				items(await sync({ t: 'tvsearch', imdbid: SILO_ID, season: '3' }, ['api']))
			).toEqual([]);
		});

		it('keeps every other chunk when one fails, and remembers what those found', async () => {
			// Three chunks: 40 Silo releases and 10 strays, 50 Silo releases, and 50 more.
			cacheRows.ad = [...siloRows(0, 140, NOW - 10 * MINUTE), ...strayRows(10, NOW)];
			const query = mockRepo.getScrapedTrueEntriesHolding;
			let calls = 0;
			mockRepo.getScrapedTrueEntriesHolding = vi.fn(
				async (wanted: Array<{ imdbId: string; hash: string }>) => {
					if (++calls === 2) throw new Error('Query execution was interrupted');
					return query(wanted);
				}
			);
			vi.spyOn(console, 'error').mockImplementation(() => {});

			const chunks = newestFirst(cacheRows.ad).map((row) => row.hash);
			const [first, second, third] = [0, 1, 2].map((n) => chunks.slice(n * 50, n * 50 + 50));
			const listed = (await build()).ad.map((release) => release.hash);

			expect(listed).toEqual([...first.slice(10), ...third]);
			expect(console.error).toHaveBeenCalledTimes(1);

			const asked = vi.mocked(mockRepo.getScrapedTrueEntriesHolding);
			asked.mockClear();
			await build(NOW + BUILD_INTERVAL);
			// Only the failed chunk is asked again; the first chunk's strays are remembered.
			expect(asked.mock.calls.flatMap(([wanted]) => wanted.map((w) => w.hash))).toEqual(
				second
			);
		});

		it('leaves out of the RD list what RD refuses by name', async () => {
			cacheRows.rd = movieRows(NOW);

			const { rd } = await build();

			expect(isRdBlockedName(titleOf(REFUSED))).toBe(true);
			expect(rd.map((release) => release.hash)).not.toContain(REFUSED);
		});

		it('leaves out what is reported, judged not the movie or Cyrillic-led', async () => {
			const trashedPage = writtenBack.pages.find((p) => p.imdbId === 'tt0313990')!;
			const entries = trashedPage.ScrapedTrue!.entries;
			vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
			trashedPairKeys
				.mockReset()
				.mockImplementation(
					async (_imdbId: string, hashes: string[]) =>
						new Set(
							entries
								.filter((e) => e.verdict === 'trash' && hashes.includes(e.hash))
								.map((e) => pairKeyOf(e.hash, e.title))
						)
				);
			library.set(trashedPage.key, {
				results: entries.map(({ hash, title, fileSize }) => ({ hash, title, fileSize })),
				updatedAt: new Date(trashedPage.ScrapedTrue!.updatedAt),
			});
			const trashRows = entries.map((entry, index) => ({
				hash: entry.hash.toLowerCase(),
				imdbId: trashedPage.imdbId,
				season: null,
				createdAt: new Date(NOW - index * 1000),
				filename: entry.title,
				originalFilename: entry.title,
			}));
			const [reportedRow, ...movies] = movieRows(NOW - MINUTE).filter((row) =>
				servable(row, false)
			);
			reported = [reportedRow.hash];
			cacheRows.ad = [
				reportedRow,
				...movies,
				...trashRows,
				movieRows(NOW).find((row) => row.hash === CYRILLIC)!,
			];

			const listed = (await build()).ad.map((release) => release.hash);

			expect(listed).not.toContain(reportedRow.hash);
			expect(listed).not.toContain(CYRILLIC);
			const trashed = entries.filter((e) => e.verdict === 'trash');
			expect(trashed).toHaveLength(4);
			for (const entry of trashed) expect(listed).not.toContain(entry.hash);
			expect(listed).toContain(entries.find((e) => e.verdict !== 'trash')!.hash);
			expect(listed).toContain(movies[0].hash);
			// The verdicts were asked about each title's wanted hashes, not its page's.
			for (const [imdbId, hashes] of trashedPairKeys.mock.calls as Array<
				[string, string[]]
			>) {
				const wanted = cacheRows.ad.filter((r) => r.imdbId === imdbId).map((r) => r.hash);
				expect(hashes.every((h) => wanted.includes(h))).toBe(true);
			}
		});

		it('never reads a whole page, nor asks a filter about one', async () => {
			cacheRows.rd = [...movieRows(NOW - MINUTE), ...siloRows(0, 200, NOW)];
			reported = [];

			await build();

			for (const read of wholePageReads()) expect(read).not.toHaveBeenCalled();
			expect(mockRepo.getCachedRdNames).not.toHaveBeenCalled();
			expect(mockRepo.filterCachedHashesAd).not.toHaveBeenCalled();
			const asked = vi
				.mocked(mockRepo.getScrapedTrueEntriesHolding)
				.mock.calls.flatMap(([wanted]) => wanted.map((w) => w.hash));
			expect(new Set(asked)).toEqual(new Set(cacheRows.rd.map((row) => row.hash)));
		});

		it('drops a taken-down release at the next build, and its neighbours keep their date', async () => {
			// The repository's own filter, as `getNewlyCached` applies it.
			const rows = siloRows(0, 3, NOW - MINUTE);
			mockRepo.getNewlyCached = vi.fn(async (provider: 'rd' | 'ad') =>
				provider === 'rd' ? withoutBlockedHashes(newestFirst(rows)) : []
			);
			const first = (await build()).rd;
			expect(first).toHaveLength(3);

			setBlocklistForTests([rows[1].hash]);
			const { rd } = await build(NOW + BUILD_INTERVAL);

			expect(rd).toEqual(first.filter((release) => release.hash !== rows[1].hash));
		});

		it('carries from its own newer list when Redis kept an older one', async () => {
			fakeRedis.reset();
			setNewlyCachedStore(new NewlyCachedStore('redis://x'));
			const sharedBuiltAt = () =>
				JSON.parse(fakeRedis.values.get('torznab:newly:v3:lists')!.value).builtAt;
			cacheRows.ad = siloRows(0, 5, NOW - MINUTE);
			await build();

			// The build's memo write lands but is reported timed out, so the client
			// is dropped and the new list reaches this instance's memory only.
			cacheRows.ad.push(...siloRows(5, 8, NOW));
			fakeRedis.timedOut = true;
			let second: NewlyCachedLists;
			try {
				second = await build(NOW + BUILD_INTERVAL);
			} finally {
				fakeRedis.timedOut = false;
			}
			expect(sharedBuiltAt()).toBe(NOW);

			// A fresh client again, and the older shared copy: the build carries
			// from this instance's newer one, and its write heals the shared one.
			vi.setSystemTime(NOW + BUILD_INTERVAL + REDIS_RETRY_MS);
			cacheRows.ad.push(...siloRows(8, 10, NOW + BUILD_INTERVAL));
			const third = await build(NOW + 2 * BUILD_INTERVAL);

			expect(third.ad.slice(2)).toEqual(second.ad);
			expect(third.ad.slice(0, 2).every((r) => r.listedAt === NOW + 2 * BUILD_INTERVAL)).toBe(
				true
			);
			expect(sharedBuiltAt()).toBe(NOW + 2 * BUILD_INTERVAL);
		});

		it('judges a release once: a listed one and a memoised one are not looked up again', async () => {
			cacheRows.rd = [...movieRows(NOW - MINUTE), ...strayRows(5, NOW)];
			await build();
			// Two titles' worth of rows, in chunks; never a page.
			expect(mockRepo.getScrapedTrueEntriesHolding).toHaveBeenCalled();

			vi.mocked(mockRepo.getScrapedTrueEntriesHolding).mockClear();
			await build(NOW + BUILD_INTERVAL);
			// What RD refuses and what is on no page are remembered too.
			expect(mockRepo.getScrapedTrueEntriesHolding).not.toHaveBeenCalled();
		});

		it('asks again about a hash it could not find after six hours, not before', async () => {
			cacheRows.rd = strayRows(1, NOW);

			await build();
			await build(NOW + 31 * MINUTE);
			vi.setSystemTime(NOW + 31 * MINUTE);
			await build();
			expect(mockRepo.getScrapedTrueEntriesHolding).toHaveBeenCalledTimes(1);

			vi.setSystemTime(NOW + RESOLVED_TTL_SECONDS * 1000);
			await build();
			expect(mockRepo.getScrapedTrueEntriesHolding).toHaveBeenCalledTimes(2);
		});

		it('looks up a bounded slice per build, newest first, and lists the rest later', async () => {
			// More unknown rows than one build may look up: strays first, newest.
			cacheRows.ad = [...siloRows(0, 200, NOW - 30 * MINUTE), ...strayRows(900, NOW)];

			const first = (await build()).ad;
			const asked = () =>
				vi
					.mocked(mockRepo.getScrapedTrueEntriesHolding)
					.mock.calls.flatMap(([wanted]) => wanted.map((w) => w.hash));
			expect(asked()).toHaveLength(NEWLY_CACHED_RESOLVE_LIMIT);
			expect(asked()).toEqual(
				newestFirst(cacheRows.ad)
					.slice(0, NEWLY_CACHED_RESOLVE_LIMIT)
					.map((row) => row.hash)
			);
			expect(first).toHaveLength(NEWLY_CACHED_RESOLVE_LIMIT - 900);

			const at = NOW + BUILD_INTERVAL;
			const { ad } = await build(at);
			expect(ad).toHaveLength(200);
			expect(ad.slice(-first.length)).toEqual(first);
			expect(ad.slice(0, -first.length).every((release) => release.listedAt === at)).toBe(
				true
			);
		});
	});

	describe('through the route', () => {
		it('answers /rd/cached with the list, every item cached and dated by its listing', async () => {
			cacheRows.rd = movieRows(NOW - MINUTE);
			const expected = newestFirst(cacheRows.rd).filter((row) => servable(row));
			await build();

			const res = await sync({ t: 'search', limit: '100' });

			const served = items(res);
			expect(served.map((item) => item.hash)).toEqual(
				expected.slice(0, 100).map((row) => row.hash)
			);
			expect(served.map((item) => item.pubDate)).toEqual(
				expected.slice(0, 100).map((row) => toSecond(row.createdAt.getTime()))
			);
			expect(served.every((item) => item.seeders === CACHED_SEEDERS)).toBe(true);
			expect(body(res)).toContain(`total="${expected.length}"`);
			// No second cache lookup: being on the list is the cache answer.
			expect(mockRepo.getCachedRdNames).not.toHaveBeenCalled();
			expect(mockRepo.getRecentScrapedTrueKeys).not.toHaveBeenCalled();
		});

		it('answers the same on the plain variant of a scope', async () => {
			cacheRows.rd = movieRows(NOW - MINUTE);
			await build();
			const cached = body(await sync({ t: 'search', limit: '100' }));
			const plain = body(await sync({ t: 'search', limit: '100' }, ['rd', 'api']));
			expect(plain).toBe(cached);
		});

		it('narrows the kind by t=, then by cat=', async () => {
			cacheRows.rd = [...movieRows(NOW - MINUTE).slice(0, 20), ...siloRows(0, 20, NOW)];
			await build();

			const kinds = async (query: Record<string, string>) =>
				new Set(
					items(await sync({ limit: '100', ...query })).map((item) => item.categories[0])
				);
			expect(await kinds({ t: 'tvsearch' })).toEqual(new Set([5000]));
			expect(await kinds({ t: 'movie' })).toEqual(new Set([2000]));
			expect(await kinds({ t: 'search' })).toEqual(new Set([5000, 2000]));

			const uhdTv = items(await sync({ t: 'search', cat: '5045', limit: '100' }));
			expect(uhdTv.length).toBeGreaterThan(0);
			expect(uhdTv.every((item) => item.categories.includes(5045))).toBe(true);
		});

		it('pages with offset and limit, and counts what survives the filters', async () => {
			cacheRows.rd = siloRows(0, 250, NOW);
			await build();
			const expected = newestFirst(cacheRows.rd).map((row) => row.hash);

			const pages = [];
			for (const offset of [0, 100, 200]) {
				const res = await sync({ t: 'tvsearch', offset: String(offset), limit: '100' });
				expect(body(res)).toContain(`total="${expected.length}"`);
				pages.push(...items(res).map((item) => item.hash));
			}
			expect(pages).toEqual(expected);
		});

		it('lists a hash both providers hold once on the combined feed, at the earlier listing', async () => {
			const [both, rdOnly] = siloRows(0, 2, NOW - MINUTE);
			cacheRows.rd = [both, rdOnly];
			await build();
			cacheRows.ad = [{ ...both, createdAt: new Date(NOW) }];
			await build(NOW + BUILD_INTERVAL);

			for (const route of [['api'], ['cached', 'api']]) {
				const served = items(await sync({ t: 'search' }, route));
				expect(served.map((item) => item.hash)).toEqual([rdOnly.hash, both.hash]);
				expect(served[1].pubDate).toBe(toSecond(both.createdAt.getTime()));
			}
		});

		it('counts what RD refuses on the combined feed only where AllDebrid holds it', async () => {
			const refused = movieRows(NOW).find((row) => row.hash === REFUSED)!;
			cacheRows.rd = [refused, ...siloRows(0, 1, NOW - MINUTE)];
			await build();
			expect(items(await sync({ t: 'search' }, ['api'])).map((i) => i.hash)).not.toContain(
				REFUSED
			);

			cacheRows.ad = [refused];
			await build(NOW + BUILD_INTERVAL);
			expect(items(await sync({ t: 'search' }, ['api'])).map((i) => i.hash)).toContain(
				REFUSED
			);
			expect(
				items(await sync({ t: 'search' }, ['rd', 'api'])).map((i) => i.hash)
			).not.toContain(REFUSED);
			expect(items(await sync({ t: 'search' }, ['ad', 'api'])).map((i) => i.hash)).toEqual([
				REFUSED,
			]);
		});

		it('answers before the build it starts has finished', async () => {
			cacheRows.rd = siloRows(0, 5, NOW);
			let release!: () => void;
			const held = new Promise<void>((resolve) => (release = resolve));
			const query = mockRepo.getNewlyCached;
			mockRepo.getNewlyCached = vi.fn(
				async (provider: 'rd' | 'ad', since: Date, limit: number) => {
					await held;
					return query(provider, since, limit);
				}
			);

			// Raced against a short timer, so a request that waits on the build fails
			// here by name rather than hanging the suite.
			let res: MockResponse;
			try {
				res = await Promise.race([
					sync({ t: 'search' }),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error('the request waited on the build')),
							2_000
						)
					),
				]);
			} finally {
				release();
			}

			// The build was still waiting on its query, and this request answered
			// as before the list existed.
			expect(mockRepo.getNewlyCached).toHaveBeenCalled();
			expect(mockRepo.getRecentScrapedTrueKeys).toHaveBeenCalled();
			expect(body(res)).not.toContain(`<guid isPermaLink="false">${SILO_SERVED[0].hash}<`);
			await newlyCachedBuildSettled();
			expect(items(await sync({ t: 'search', limit: '100' }))).toHaveLength(5);
		});

		it('builds at most once per interval, and serves the list to every scope', async () => {
			cacheRows.rd = siloRows(0, 5, NOW);
			await buildThroughRoute();
			await sync({ t: 'search' }, ['api']);
			await sync({ t: 'tvsearch' }, ['ad', 'cached', 'api']);
			await newlyCachedBuildSettled();
			expect(mockRepo.getNewlyCached).toHaveBeenCalledTimes(2);
			expect(items(await sync({ t: 'search' }))).toHaveLength(5);

			cacheRows.rd.push(...siloRows(5, 6, NOW + MINUTE));
			vi.setSystemTime(NOW + MINUTE);
			await buildThroughRoute();
			expect(items(await sync({ t: 'search' }))).toHaveLength(5);
			vi.setSystemTime(NOW + BUILD_INTERVAL);
			await buildThroughRoute();
			expect(items(await sync({ t: 'search' }))).toHaveLength(6);
			expect(mockRepo.getNewlyCached).toHaveBeenCalledTimes(4);
		});

		it('answers as before while another instance holds the claim and no list exists', async () => {
			const before = body(await sync({ t: 'movie' }, ['api']));
			await newlyCachedBuildSettled();
			setNewlyCachedStore(new NewlyCachedStore());
			cacheRows.rd = movieRows(NOW);
			vi.spyOn(newlyCachedStore(), 'claimBuild').mockResolvedValue(false);
			vi.mocked(mockRepo.getNewlyCached).mockClear();

			expect(body(await sync({ t: 'movie' }, ['api']))).toBe(before);
			expect(mockRepo.getNewlyCached).not.toHaveBeenCalled();
		});

		it('keeps serving the last list when a build fails', async () => {
			cacheRows.rd = siloRows(0, 5, NOW);
			await build();
			const served = body(await sync({ t: 'search' }));
			await newlyCachedBuildSettled();

			mockRepo.getNewlyCached = vi.fn().mockRejectedValue(new Error('database is gone'));
			vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.setSystemTime(NOW + BUILD_INTERVAL);
			await buildThroughRoute();
			expect(console.error).toHaveBeenCalled();

			vi.setSystemTime(NOW + 2 * BUILD_INTERVAL);
			expect(body(await sync({ t: 'search' }))).toBe(served);
			expect(mockRepo.getRecentScrapedTrueKeys).not.toHaveBeenCalled();
		});

		it('answers as before when the list has nothing for the request', async () => {
			const before = body(await sync({ t: 'movie' }));
			await newlyCachedBuildSettled();

			// Only TV on the list, so a movie sync finds nothing on it.
			cacheRows.rd = siloRows(0, 5, NOW);
			vi.setSystemTime(NOW + BUILD_INTERVAL);
			await buildThroughRoute();
			expect(body(await sync({ t: 'movie' }))).toBe(before);
			expect(items(await sync({ t: 'tvsearch' }))).toHaveLength(5);
		});

		it('leaves the provider-probed feeds as they were', async () => {
			cacheRows.rd = siloRows(0, 5, NOW);

			const res = await sync({ t: 'search' }, ['tb', 'cached', 'api']);

			expect(mockRepo.getNewlyCached).not.toHaveBeenCalled();
			expect(mockRepo.getRecentScrapedTrueKeys).toHaveBeenCalled();
			expect(probeMock).toHaveBeenCalled();
			expect(body(res)).not.toContain('<error');
		});

		it('leaves a targeted search as it was', async () => {
			cacheRows.rd = movieRows(NOW);
			const res = await sync({ t: 'movie', imdbid: THE_CROW });

			expect(mockRepo.getNewlyCached).not.toHaveBeenCalled();
			expect(mockRepo.getScrapedTrueRow).toHaveBeenCalledWith(`movie:${THE_CROW}`);
			expect(mockRepo.getCachedRdNames).toHaveBeenCalled();
			expect(items(res).length).toBeGreaterThan(0);
		});

		it('never scrapes or refreshes for an RSS sync', async () => {
			cacheRows.rd = movieRows(NOW);
			await buildThroughRoute();
			await sync({ t: 'search' }, ['api']);
			expect(mockBackfill).not.toHaveBeenCalled();
			expect(mockRefresh).not.toHaveBeenCalled();
		});

		// Sonarr's RSS sync, from its source (`HttpIndexerBase.FetchReleases`
		// with `isRecent`, Sonarr main on 2026-11-06): it remembers the newest
		// release of its last sync, reads pages newest first and stops at the
		// first page whose oldest `pubDate` is older than that release or that
		// holds its download URL, at a short page, or at a thousand releases. A
		// first sync reads one page.
		describe('a Sonarr RSS sync', () => {
			const SONARR_PAGE = 100;
			const SONARR_MAX = 1000;

			interface Seen {
				pubDate: number;
				link: string;
			}

			async function sonarrSync(
				last: Seen | null
			): Promise<{ found: FeedItem[]; pages: FeedItem[][]; last: Seen | null }> {
				const found: FeedItem[] = [];
				const pages: FeedItem[][] = [];
				for (let index = 0; index < 30; index++) {
					vi.setSystemTime(Date.now() + 2_000);
					const res = await sync({
						t: 'tvsearch',
						cat: '5000,5030,5040,5045',
						offset: String(index * SONARR_PAGE),
						limit: String(SONARR_PAGE),
					});
					expect(res._getStatusCode()).toBe(200);
					const page = items(res);
					pages.push(page);
					found.push(...page);
					if (page.length > 0) {
						if (!last) break;
						const oldest = Math.min(...page.map((item) => item.pubDate));
						if (oldest < last.pubDate || page.some((item) => item.link === last.link))
							break;
						if (found.length >= SONARR_MAX && oldest < Date.now() - 24 * 60 * MINUTE)
							break;
					}
					if (page.length < SONARR_PAGE) break;
				}
				const newest = [...found].sort((a, b) => b.pubDate - a.pubDate)[0];
				return {
					found,
					pages,
					last: newest ? { pubDate: newest.pubDate, link: newest.link } : last,
				};
			}

			it('collects every release once, never one dated behind what it saw', async () => {
				// Silo's last served release is cached early but scraped only later.
				const late = SILO_SERVED[SILO_SERVED.length - 1];
				library.set(SILO.key, {
					results: SILO.results.filter((result) => result.hash !== late.hash),
					updatedAt: new Date(SILO.updatedAt),
				});
				const lateRow = {
					...siloRows(0, 1, NOW - 30 * MINUTE)[0],
					hash: late.hash,
					filename: late.title,
					originalFilename: late.title,
				};
				// Films are on the list too; Sonarr's tvsearch never sees them.
				cacheRows.rd = [...movieRows(NOW - 2 * MINUTE), ...siloRows(0, 150, NOW - MINUTE)];

				const seen = new Map<string, number>();
				let last: Seen | null = null;
				let newestSeen = 0;
				const syncNow = async () => {
					const result = await sonarrSync(last);
					const hashes = result.found.map((item) => item.hash);
					expect(new Set(hashes).size).toBe(hashes.length);
					for (const item of result.found) {
						if (seen.has(item.hash)) continue;
						// Nothing new is ever dated behind what an earlier sync saw.
						expect(item.pubDate).toBeGreaterThanOrEqual(newestSeen);
						seen.set(item.hash, item.pubDate);
					}
					if (last) {
						const stop = result.pages.at(-1)!;
						expect(
							stop.some((item) => item.link === last!.link) ||
								Math.min(...stop.map((item) => item.pubDate)) < last.pubDate
						).toBe(true);
					}
					newestSeen = Math.max(newestSeen, ...result.found.map((item) => item.pubDate));
					last = result.last;
					return result;
				};

				await buildThroughRoute();
				const first = await syncNow();
				expect(first.pages).toHaveLength(1);
				expect(first.found).toHaveLength(SONARR_PAGE);
				// A first sync reads one page, so what the first list held below it
				// is never read; everything listed after it must be.
				const listedBeforeFirstSync = new Set(
					(await newlyCachedStore().readLists())!.rd.map((release) => release.hash)
				);
				const firstSeen = new Set(seen.keys());

				// More rows than a build may look up arrive, strays newest, so the
				// rest of Silo waits for the next build; and the late release.
				cacheRows.rd.push(
					...siloRows(150, SILO_SERVED.length - 1, NOW + 5 * MINUTE),
					...strayRows(NEWLY_CACHED_RESOLVE_LIMIT - 100, NOW + 6 * MINUTE),
					lateRow
				);
				let at = NOW + 2 * BUILD_INTERVAL;
				for (const step of [0, 1, 2]) {
					vi.setSystemTime(at + step * BUILD_INTERVAL);
					await buildThroughRoute();
					await syncNow();
				}

				// It is scraped, and listed once its miss is forgotten.
				library.set(SILO.key, {
					results: SILO.results,
					updatedAt: new Date(SILO.updatedAt),
				});
				at += 3 * BUILD_INTERVAL + RESOLVED_TTL_SECONDS * 1000;
				vi.setSystemTime(at);
				await buildThroughRoute();
				await syncNow();

				const everyTvRelease = cacheRows.rd
					.filter(
						(row) => row.filename !== 'Stray' && row.imdbId === SILO_ID && servable(row)
					)
					.map((row) => row.hash);
				expect(everyTvRelease).toContain(late.hash);
				const listedSince = everyTvRelease.filter(
					(hash) => !listedBeforeFirstSync.has(hash) || firstSeen.has(hash)
				);
				expect(listedSince.length).toBeGreaterThan(NEWLY_CACHED_RESOLVE_LIMIT / 2);
				expect([...seen.keys()].sort()).toEqual([...listedSince].sort());
			});
		});
	});
});

describe('rate limits', () => {
	it('spends exactly the configured per-key budget, then refuses in the protocol', async () => {
		// The budget is read from the config rather than written out here, so
		// changing the limit cannot leave this asserting one that no longer
		// exists. Every request comes from its own IP, so the per-key budget is
		// the only thing that can refuse one — a sponsor's *arr fleet shares a
		// budget wherever the boxes run from. A JSON 429 would be logged as a
		// broken indexer instead of backed off.
		const { rateLimit } = RATE_LIMIT_CONFIGS.torznabSearch;

		let last: MockResponse | undefined;
		for (let attempt = 0; attempt < rateLimit; attempt++) {
			last = await run(
				{ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY },
				{ ip: `172.16.0.${attempt}` }
			);
		}
		expect(last!._getStatusCode()).toBe(200);

		const refused = await run(
			{ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY },
			{ ip: '172.16.1.1' }
		);
		expect(refused._getStatusCode()).toBe(429);
		expect(body(refused)).toContain('code="500"');
		expect(res429IsXml(refused)).toBe(true);
	});

	it('rejects an unauthenticated flood on the IP budget before any lookup', async () => {
		let last: MockResponse | undefined;
		for (let attempt = 0; attempt < 21; attempt++) {
			last = await run({ t: 'caps' });
		}

		expect(last!._getStatusCode()).toBe(429);
		expect(body(last!)).toContain('code="500"');
	});
});

function res429IsXml(res: MockResponse): boolean {
	return res._getHeaders()['Content-Type'] === 'application/xml; charset=utf-8';
}

describe('an *arr search pages to its end inside the budget', () => {
	// Reported in dmm-support on 2026-09-17: Sonarr found nothing on DMM and
	// logged a 429 on `offset=200&limit=10`. The fixture is that search as
	// dmm-01's proxy log recorded it, every request at its second, and the
	// library page it was paging through as production held it on 2026-10-03.
	const reported = sonarrEpisodeSearch.reported;
	const { page } = sonarrEpisodeSearch;
	const route = reported.path.split('/').slice(3);

	/**
	 * The same search for the whole season, which is what Sonarr sends for a
	 * season and what DMM answered the episode search with while it left `ep`
	 * unread: the paging cases below need a search that runs deep.
	 */
	const { ep: _searchedEpisode, ...seasonQuery } = reported.query;

	/** What Sonarr and Radarr give up at, whatever the indexer's total says. */
	const ARR_MAX_PAGES = 30;
	const ARR_MAX_RESULTS = 1000;
	/** `HttpIndexerBase.RateLimit`: one request per indexer every two seconds. */
	const ARR_SPACING_MS = 2_000;

	interface ArrRequest {
		at: number;
		offset: number;
		limit: number;
		status: number;
	}

	/** Sonarr's and Radarr's `GetProviderPageSize`, read off a caps document. */
	function arrPageSize(caps: string): number {
		const limits = /<limits\b([^>]*)\/>/.exec(caps)?.[1] ?? '';
		const read = (name: string) => Number(new RegExp(`${name}="(\\d+)"`).exec(limits)?.[1]);
		return Math.min(100, Math.max(read('default'), read('max')));
	}

	const start = new Date(reported.started).getTime();

	/** The caps DMM advertises, read the way an *arr holds them: well before the search. */
	async function dmmCaps(): Promise<string> {
		vi.setSystemTime(start - 3_600_000);
		return body(await run({ t: 'caps' }, { route }));
	}

	/**
	 * One search the way Sonarr and Radarr run it, from their source:
	 * `NewznabRequestGenerator.GetPagedRequests` asks for page after page by
	 * offset, and `HttpIndexerBase.FetchReleases` stops at a short page, at
	 * thirty pages or at a thousand releases, never reading `total`. A 429
	 * throws out of that loop, so every page already read is discarded with it
	 * and the search comes back empty.
	 */
	async function arrSearch(
		caps: string,
		query: Record<string, string> = reported.query
	): Promise<{ requests: ArrRequest[]; found: string[] }> {
		const pageSize = arrPageSize(caps);
		const requests: ArrRequest[] = [];
		const found: string[] = [];
		for (let index = 0; index < ARR_MAX_PAGES; index++) {
			vi.setSystemTime(start + index * ARR_SPACING_MS);
			const offset = index * pageSize;
			const res = await run(
				{
					...query,
					offset: String(offset),
					limit: String(pageSize),
					apikey: SPONSOR_KEY,
				},
				{ route }
			);
			requests.push({
				at: (index * ARR_SPACING_MS) / 1000,
				offset,
				limit: pageSize,
				status: res._getStatusCode(),
			});
			if (res._getStatusCode() !== 200) return { requests, found: [] };

			const items = [...body(res).matchAll(/<guid isPermaLink="false">([^<]+)<\/guid>/g)];
			found.push(...items.map((match) => match[1]));
			if (found.length >= ARR_MAX_RESULTS || items.length < pageSize) break;
		}
		return { requests, found };
	}

	function refusals(requests: ArrRequest[]): string[] {
		return requests
			.filter((request) => request.status !== 200)
			.map(
				({ status, offset, limit, at }) =>
					`${status} on offset=${offset}&limit=${limit} at ${at}s`
			);
	}

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		library = new Map([
			[page.key, { results: page.results, updatedAt: new Date(page.updatedAt) }],
		]);
		rdCached = new Set();
		adCached = new Set();
		providerCached = new Set();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('reproduces the recorded search from the caps the reporter’s Sonarr held', async () => {
		// The paging model and the fixture checked against each other: a Sonarr
		// still holding a caps document that offered ten a page sends exactly
		// what the log recorded, and is refused exactly where it was. DMM read
		// no `ep` then, so the pages it served were the season search's.
		const { requests } = await arrSearch(
			'<caps><limits max="10" default="10"/></caps>',
			seasonQuery
		);

		expect(requests).toEqual(reported.requests);
	});

	it('answers every page of a season search, reading what DMM advertises', async () => {
		const { requests, found } = await arrSearch(await dmmCaps(), seasonQuery);

		expect(refusals(requests)).toEqual([]);
		expect(found).toHaveLength(Math.min(ARR_MAX_RESULTS, page.results.length));
		expect(new Set(found).size).toBe(found.length);
		// One sponsor's fleet shares the budget, so a search that needed all of
		// it would still fail the moment a second one ran beside it.
		expect(requests.length).toBeLessThanOrEqual(RATE_LIMIT_CONFIGS.torznabSearch.rateLimit / 2);
	});

	describe('the reported search, which asked for episode 10', () => {
		// Sonarr accepts a release on an episode search only when its title
		// names that season and an episode list holding the one searched, and
		// gives up at the thousandth release. Read here with a plain pattern
		// rather than with DMM's own reader, which is what is under test. The
		// page holds no multi-episode release reaching episode 10, so the
		// pattern is exact for it.
		const NAMES_S03E10 = /(?:^|[^a-z0-9])s0?3[ ._-]*e10(?![0-9])/i;
		const NAMES_3X10 = /(?:^|[^a-z0-9])3x10(?![0-9])/i;
		const namesEpisode = (title: string) => NAMES_S03E10.test(title) || NAMES_3X10.test(title);

		const titleOf = new Map(page.results.map((result) => [result.hash, result.title]));
		const wanted = page.results.filter((result) => namesEpisode(result.title));

		it('holds the shapes this is measured against', () => {
			expect(wanted.filter((result) => NAMES_S03E10.test(result.title))).toHaveLength(103);
			expect(wanted.filter((result) => NAMES_3X10.test(result.title))).toHaveLength(2);
		});

		it('returns every release naming S03E10 inside Sonarr’s thousand', async () => {
			const { requests, found } = await arrSearch(await dmmCaps());

			expect(refusals(requests)).toEqual([]);
			const reached = new Set(found);
			const unseen = wanted.filter((result) => !reached.has(result.hash));
			expect(unseen.map((result) => result.title)).toEqual([]);
			const rejectedBySonarr = found.filter((hash) => !namesEpisode(titleOf.get(hash) ?? ''));
			expect(rejectedBySonarr).toHaveLength(0);
			expect(found).toHaveLength(wanted.length);
			expect(requests).toHaveLength(2);
		});

		it('finishes on the caps the reporter’s Sonarr held too', async () => {
			// An *arr keeps caps for up to seven days, so a Sonarr still paging at
			// ten is served the same set in eleven requests rather than refused on
			// the twenty-first.
			const { requests, found } = await arrSearch(
				'<caps><limits max="10" default="10"/></caps>'
			);

			expect(refusals(requests)).toEqual([]);
			expect(new Set(found)).toEqual(new Set(wanted.map((result) => result.hash)));
			expect(requests).toHaveLength(Math.ceil(wanted.length / 10));
		});
	});
});

describe('a size the library cannot mean', () => {
	// Library rows record megabytes, and some scrapers write bytes or kilobytes
	// there instead. The feed publishes biggest-first, so one of those rows does
	// not sit quietly at the bottom of a page — it takes the top of it.
	//
	// Measured against the live feed on 2026-09-09: the first result of a
	// `Sicario` search was `Sicario 2015 1080p BluRay x264-OFT` published at
	// 30,408.7 GB, whose real size TorBox reports as 5.65 GB. The numbers below
	// are that row: fileSize 29,000,000 in a column that means MB.
	const MIS_UNITED = hash('9');

	beforeEach(() => {
		library.set(`movie:${MOVIE_ID}`, {
			results: [
				release('Sicario.2015.1080p.BluRay.x264-OFT', 29_000_000, MIS_UNITED),
				release('Shawshank.1994.2160p.BluRay', 60_000, BIG),
				release('Shawshank.1994.1080p.WEB', 4_000, SMALL),
			],
			updatedAt: PAGE_UPDATED_AT,
		});
		rdCached = new Set([MIS_UNITED, BIG, SMALL]);
		adCached = new Set();
	});

	it('publishes it as unknown rather than as thirty terabytes', async () => {
		const res = await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });

		const sizes = attrValue(body(res), 'size');
		expect(sizes).not.toContain('30408704000000');
		expect(sizes[sizes.length - 1]).toBe('0');
	});

	it('keeps the release, because only its size is wrong', async () => {
		const res = await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });

		expect(titles(res)).toContain('Sicario.2015.1080p.BluRay.x264-OFT');
	});

	it('stops it taking the top of the page from a real release', async () => {
		const res = await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });

		expect(titles(res)[0]).toBe('Shawshank.1994.2160p.BluRay');
	});

	// A size the row could plausibly mean is published unchanged, ceiling or no
	// ceiling: 500 GB is a real remux collection, not a unit mistake.
	it('leaves a large but believable size alone', async () => {
		library.set(`movie:${MOVIE_ID}`, {
			results: [release('Shawshank.1994.Remux.Collection', 500 * 1024, BIG)],
			updatedAt: PAGE_UPDATED_AT,
		});
		rdCached = new Set([BIG]);

		const res = await run({ t: 'movie', imdbid: MOVIE_ID, apikey: SPONSOR_KEY });

		expect(attrValue(body(res), 'size')).toEqual([String(500 * 1024 * 1024 * 1024)]);
	});
});

describe('releases Real-Debrid refuses by name', () => {
	// Reported in Discord #sponsors on 2026-09-08: on `/api/torznab/rd/cached`,
	// zurg's qBittorrent endpoint was handed
	// `Dead.Of.Winter.2025.2160p.AMZN.WEB-DL.DDP5.1.H.265-FLUX` and logged
	// "realdebrid it refuses this release on its filename". DMM's RD table had
	// the hash as downloaded, so the feed listed it as cached. The fixture is
	// that title's whole library page and The Crow (2024)'s as production held
	// them on 2026-10-03, with the RD row of every hash on them that DMM marks
	// cached, so these run against the names the feed really serves.
	const DEAD_OF_WINTER = 'tt7574556';
	const THE_CROW = 'tt1340094';
	const REPORTED = rdRefusedNames.reported.hash;

	const titleOf = (torrentHash: string) =>
		rdRefusedNames.pages
			.flatMap((page) => page.results)
			.find((result) => result.hash === torrentHash)?.title;

	/**
	 * Every item a feed serves for a title, paged at the largest page a client
	 * may ask for. Through `runSearch` rather than the route: these are about
	 * what the feed holds, not about how a client reaches it.
	 */
	async function wholeFeed(segments: string[], imdbid: string): Promise<TorznabRssItem[]> {
		const options = parseFeedOptions(segments);
		if (!options) throw new Error(`not a feed: ${segments.join('/')}`);
		const items: TorznabRssItem[] = [];
		for (let offset = 0; ; offset += MAX_LIMIT) {
			const page = await runSearch(
				'movie',
				{ imdbid, offset: String(offset), limit: String(MAX_LIMIT) },
				options,
				{ shortId }
			);
			items.push(...page.items);
			if (page.items.length === 0 || items.length >= page.total) return items;
		}
	}

	const hashesOf = (items: TorznabRssItem[]) => items.map((item) => item.infoHash);

	/** Whether RD refuses a served item by its title or by its RD row's names. */
	const refusedByRd = (item: TorznabRssItem) => {
		const names = rdNames.get(item.infoHash);
		return isRdBlockedName(item.title, names ? [names.originalFilename, names.filename] : []);
	};

	beforeEach(() => {
		library = new Map(
			rdRefusedNames.pages.map((page) => [
				page.key,
				{ results: page.results, updatedAt: new Date(page.updatedAt) },
			])
		);
		rdCached = new Set(rdRefusedNames.rdCached.map((row) => row.hash));
		rdNames = new Map(
			rdRefusedNames.rdCached.map((row) => [
				row.hash,
				{ filename: row.filename, originalFilename: row.originalFilename },
			])
		);
		adCached = new Set();
	});

	it('answers the reported request without the release RD refused', async () => {
		const res = await run(
			{ t: 'movie', imdbid: DEAD_OF_WINTER, apikey: SPONSOR_KEY },
			{ route: ['rd', 'cached', 'api'] }
		);

		// 76 of the page's releases are held on RD; RD refuses 54 of them by name.
		expect(body(res)).toContain('total="22"');
		expect(attrValue(body(res), 'infohash')).not.toContain(REPORTED);
	});

	it('serves only what an RD account can take on /rd/cached', async () => {
		const deadOfWinter = await wholeFeed(['rd', 'cached'], DEAD_OF_WINTER);
		const theCrow = await wholeFeed(['rd', 'cached'], THE_CROW);

		expect(deadOfWinter).toHaveLength(22);
		// 79 held once the Cyrillic titles the site also hides are gone; 29 refused.
		expect(theCrow).toHaveLength(50);
		expect(hashesOf(deadOfWinter)).not.toContain(REPORTED);
		expect([...deadOfWinter, ...theCrow].filter(refusedByRd)).toEqual([]);
		expect([...deadOfWinter, ...theCrow].every((item) => item.seeders === CACHED_SEEDERS)).toBe(
			true
		);
	});

	// RD took these on 2026-10-03 and refused the rip family and BluRay.x264
	// again, in any case, on 2026-10-10.
	it('leaves out held releases RD refuses again since 2026-10-10', async () => {
		const served = hashesOf([
			...(await wholeFeed(['rd', 'cached'], DEAD_OF_WINTER)),
			...(await wholeFeed(['rd', 'cached'], THE_CROW)),
		]);

		for (const control of [
			'c2fdb63df75dc80570b6fe4250f521cbb66c88e1', // Dead.of.Winter.2025.720p.BluRay.x264-PiGNUS
			'9b7f7e2f52470681222a00cd5a4f82252de411bc', // Dead.of.Winter.2025.1080p.WEBRip.x265-KONTRAST
			'c06e262ee527b9c7b923f913341018fe2cb4b8d8', // The.Crow.2024.1080p.BluRay.x264-ATELiER_EniaHD.mkv
		]) {
			expect(rdCached.has(control), control).toBe(true);
			expect(served, titleOf(control)).not.toContain(control);
		}
	});

	it("judges the names on RD's row, not only the scraped title", async () => {
		// A listing that wrote `WEB-DL` as `WEB DL` hides the refused name from
		// the title; RD's row still carries the torrent's own name.
		const spacedTitles = rdRefusedNames.rdCached.filter((row) => {
			const title = titleOf(row.hash) ?? '';
			return (
				title.startsWith('The Crow') &&
				!isRdBlockedName(title) &&
				isRdBlockedName(row.originalFilename, [row.filename])
			);
		});
		expect(spacedTitles).toHaveLength(10);

		const served = hashesOf(await wholeFeed(['rd', 'cached'], THE_CROW));
		for (const row of spacedTitles) {
			expect(served, titleOf(row.hash)).not.toContain(row.hash);
		}
	});

	it('leaves refused releases out of /rd too, held or not', async () => {
		const deadOfWinter = await wholeFeed(['rd'], DEAD_OF_WINTER);
		const theCrow = await wholeFeed(['rd'], THE_CROW);

		expect(deadOfWinter).toHaveLength(227 - 137);
		expect(theCrow).toHaveLength(411 - 185);
		expect(hashesOf(deadOfWinter)).not.toContain(REPORTED);
		expect([...deadOfWinter, ...theCrow].filter(refusedByRd)).toEqual([]);
	});

	it("stops counting RD's copy as cached on the combined feed, and keeps AllDebrid's", async () => {
		expect(hashesOf(await wholeFeed(['cached'], DEAD_OF_WINTER))).not.toContain(REPORTED);

		// Still in the plain feed, which AllDebrid users read, just not as cached.
		const plain = await wholeFeed([], DEAD_OF_WINTER);
		expect(plain.find((item) => item.infoHash === REPORTED)?.seeders).toBe(UNCACHED_SEEDERS);

		adCached = new Set([REPORTED]);
		expect(hashesOf(await wholeFeed(['cached'], DEAD_OF_WINTER))).toContain(REPORTED);
		expect(hashesOf(await wholeFeed(['ad', 'cached'], DEAD_OF_WINTER))).toContain(REPORTED);
	});

	// RD's own answers from the recorded probe of 2026-10-14, each a fresh
	// webseed torrent so only the names decided. An add is judged on the root
	// name, and multi-file entries whose files RD later refused to unrestrict
	// were still taken; an unrestrict is judged on the file's own name, which
	// is what RD's row records as `filename` when one file was selected.
	it('lists exactly the names RD took when they were added', async () => {
		const probes = rdNameFilterProbe.add.map((probe, index) => ({
			...probe,
			hash: `c${index.toString(16).padStart(39, '0')}`,
		}));
		library.set(`movie:${MOVIE_ID}`, {
			results: probes.map((probe) => release(probe.name, 1_000, probe.hash)),
			updatedAt: PAGE_UPDATED_AT,
		});
		rdCached = new Set(probes.map((probe) => probe.hash));
		rdNames = new Map(
			probes.map((probe) => [
				probe.hash,
				{ filename: probe.name, originalFilename: probe.name },
			])
		);

		const served = new Set(hashesOf(await wholeFeed(['rd', 'cached'], MOVIE_ID)));

		expect(probes.filter((probe) => probe.status === 451)).toHaveLength(111);
		for (const probe of probes) {
			expect(served.has(probe.hash), `${probe.name} answered ${probe.status}`).toBe(
				probe.status === 201
			);
		}
	});

	it('leaves out a held file RD refused to unrestrict, under a clean pack name', async () => {
		const probes = rdNameFilterProbe.unrestrict.map((probe, index) => ({
			...probe,
			hash: `d${index.toString(16).padStart(39, '0')}`,
			pack: `Probe.Pack${index}.2026.1080p.x265-PRB`,
		}));
		library.set(`movie:${MOVIE_ID}`, {
			results: probes.map((probe) => release(probe.pack, 1_000, probe.hash)),
			updatedAt: PAGE_UPDATED_AT,
		});
		rdCached = new Set(probes.map((probe) => probe.hash));
		rdNames = new Map(
			probes.map((probe) => [
				probe.hash,
				{ filename: probe.name, originalFilename: probe.pack },
			])
		);

		const served = new Set(hashesOf(await wholeFeed(['rd', 'cached'], MOVIE_ID)));

		for (const probe of probes) {
			expect(served.has(probe.hash), `${probe.name} answered ${probe.status}`).toBe(
				probe.status === 200
			);
		}
	});
});
