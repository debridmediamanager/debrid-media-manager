import handler from '@/pages/api/torznab/[...route]';
import type { RdCachedNames } from '@/services/database/availability';
import { RATE_LIMIT_CONFIGS } from '@/services/rateLimit/middlewareRateLimiter';
import { repository } from '@/services/repository';
import { ProviderProbeError } from '@/services/torznab/providerCache';
import {
	CACHED_SEEDERS,
	parseFeedOptions,
	runSearch,
	UNCACHED_SEEDERS,
} from '@/services/torznab/search';
import { DEFAULT_LIMIT, MAX_LIMIT, TorznabRssItem } from '@/services/torznab/xml';
import rdNameFilterProbe from '@/test/fixtures/realdebrid/rd-name-filter-2026-10-03.json';
import rdRefusedNames from '@/test/fixtures/torznab/rd-refused-names-2026-10-03.json';
import sonarrEpisodeSearch from '@/test/fixtures/torznab/sonarr-episode-search-2026-09-17.json';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
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
let reported: string[];
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
	reported = [];
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
		expect(body(res)).toContain('DMM Settings');
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

	// Debrid-Link has no way to ask whether a hash is held without adding it,
	// which would spend the caller's quota on every search. An unknown segment
	// is rejected rather than ignored, so this stays a 404-shaped answer.
	it('does not offer a Debrid-Link feed', async () => {
		const res = await run(
			{ t: 'movie', imdbid: MOVIE_ID.slice(2), apikey: SPONSOR_KEY },
			{ route: ['dl', 'cached', 'api'] }
		);

		expect(body(res)).toContain('code="202"');
		expect(probeMock).not.toHaveBeenCalled();
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

		// 76 of the page's releases are held on RD; RD refuses 29 of them by name.
		expect(body(res)).toContain('total="47"');
		expect(attrValue(body(res), 'infohash')).not.toContain(REPORTED);
	});

	it('serves only what an RD account can take on /rd/cached', async () => {
		const deadOfWinter = await wholeFeed(['rd', 'cached'], DEAD_OF_WINTER);
		const theCrow = await wholeFeed(['rd', 'cached'], THE_CROW);

		expect(deadOfWinter).toHaveLength(47);
		// 79 held once the Cyrillic titles the site also hides are gone; 20 refused.
		expect(theCrow).toHaveLength(59);
		expect(hashesOf(deadOfWinter)).not.toContain(REPORTED);
		expect([...deadOfWinter, ...theCrow].filter(refusedByRd)).toEqual([]);
		expect([...deadOfWinter, ...theCrow].every((item) => item.seeders === CACHED_SEEDERS)).toBe(
			true
		);
	});

	it('keeps the releases RD has taken since dropping the rip family and BluRay.x264', async () => {
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
			expect(served, titleOf(control)).toContain(control);
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
		expect(spacedTitles).toHaveLength(9);

		const served = hashesOf(await wholeFeed(['rd', 'cached'], THE_CROW));
		for (const row of spacedTitles) {
			expect(served, titleOf(row.hash)).not.toContain(row.hash);
		}
	});

	it('leaves refused releases out of /rd too, held or not', async () => {
		const deadOfWinter = await wholeFeed(['rd'], DEAD_OF_WINTER);
		const theCrow = await wholeFeed(['rd'], THE_CROW);

		expect(deadOfWinter).toHaveLength(227 - 74);
		expect(theCrow).toHaveLength(411 - 99);
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

	// RD's own answers from the recorded probe of 2026-10-03, each a fresh
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

		expect(probes.filter((probe) => probe.status === 451)).toHaveLength(20);
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
