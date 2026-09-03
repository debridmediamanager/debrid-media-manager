import handler from '@/pages/api/newznab/api';
import type { CachedUsenetResult } from '@/services/database/newznabApiCache';
import { _resetUpstreamIndexersForTest } from '@/services/newznab/indexers';
import { _resetTokenSecretForTest, encryptReleaseId } from '@/services/newznab/opaqueId';
import { _resetUpstreamLimiterForTest, RSS_TTL_MS } from '@/services/newznab/search';
import { getStoredNzb, putStoredNzb } from '@/services/newznab/store';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// setup.ts stubs the whole rate limit module out, which would take
// `checkRateLimitFor` with it. The real limiter is what the 429 path is made of,
// so only the outer IP wrapper is stubbed here — otherwise every test in this
// file would share one 5-per-second budget under the identifier `unknown`.
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (wrapped: unknown) => wrapped };
});

vi.mock('@/services/repository');
vi.mock('@/services/newznab/store', () => ({
	getStoredNzb: vi.fn(),
	putStoredNzb: vi.fn(),
	isStoreConfigured: vi.fn(() => true),
}));

const mockRepo = vi.mocked(repository);
const mockGetStored = vi.mocked(getStoredNzb);
const mockPutStored = vi.mocked(putStoredNzb);

const SECRET = 'a'.repeat(64);
const SPONSOR_KEY = 'b'.repeat(64);

// Two upstreams whose hostnames and keys are distinctive strings, so a leak of
// either into a response is a substring search away.
const FIRST_HOST = 'https://first-upstream.invalid/api';
const FIRST_KEY = 'keyofthefirstupstream';
const SECOND_HOST = 'https://second-upstream.invalid/api';
const SECOND_KEY = 'keyofthesecondupstream';

const INDEXERS = [
	{ prefix: 'ds', name: 'First Upstream', url: FIRST_HOST, apiKey: FIRST_KEY },
	{ prefix: 'ah', name: 'Second Upstream', url: SECOND_HOST, apiKey: SECOND_KEY },
];

/**
 * The nZEDb dialect: `item` at the top level, `newznab:attr` with `_name`, an
 * enclosure carrying `_length`, and a guid that is a details URL.
 */
const FIRST_RESPONSE = {
	item: [
		{
			title: 'Some.Release.2160p.WEB',
			guid: 'https://first-upstream.invalid/details/first-native-id',
			pubDate: 'Mon, 17 Nov 2025 22:08:02 +0000',
			'newznab:attr': [
				{ _name: 'size', _value: '1234567' },
				{ _name: 'category', _value: '2000' },
				{ _name: 'category', _value: '2040' },
			],
			enclosure: { _length: '1234567' },
		},
	],
};

/** The altHUB dialect: a `channel` wrapper, `attr`/`@attributes`, one item. */
const SECOND_RESPONSE = {
	channel: {
		item: {
			title: 'Another.Release.1080p',
			guid: 'second-native-id',
			pubDate: 'Tue, 18 Nov 2025 10:00:00 +0000',
			attr: [
				{ '@attributes': { name: 'size', value: '7654321' } },
				{ '@attributes': { name: 'category', value: '5000' } },
			],
			enclosure: { '@attributes': { length: '7654321' } },
		},
	},
};

/** Carries a DrunkenSlug-style per-download watermark and a branded poster. */
const RAW_NZB = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
	<head>
		<meta type="name">Some.Release.2160p.WEB</meta>
		<meta type="tag">0a624180.27889905291</meta>
	</head>
	<file poster="releases@first-upstream.invalid" date="1700000000" subject="[1/1] &quot;Some.Release.2160p.WEB.part01.rar&quot; yEnc (1/2)">
		<groups><group>alt.binaries.test</group></groups>
		<segments>
			<segment bytes="500000" number="1">first-article@news</segment>
			<segment bytes="500000" number="2">second-article@news</segment>
		</segments>
	</file>
</nzb>`;

const ERROR_ENVELOPE =
	'<?xml version="1.0" encoding="UTF-8"?>\n<error code="300" description="No such item"/>';

let fetchMock: ReturnType<typeof vi.fn>;
let shortId: string;
let cacheStore: Map<string, CachedUsenetResult[]>;
/** Every `t=get` answers with this until a test says otherwise. */
let nzbBody: string;

function jsonResponse(body: unknown) {
	return {
		ok: true,
		status: 200,
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

function textResponse(body: string) {
	return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
}

function setIndexers(indexers: unknown[]): void {
	process.env.NEWZNAB_INDEXERS = JSON.stringify(indexers);
	_resetUpstreamIndexersForTest();
}

// Every request in a test shares this IP and every test gets a fresh one:
// the handler's pre-auth reject buckets on the client IP, and without this the
// whole file drains one 'unknown' bucket and unrelated tests answer 429.
let testIp = '10.0.0.1';

async function run(
	query: Record<string, string>,
	headers: Record<string, string> = {}
): Promise<MockResponse> {
	const req = createMockRequest({
		method: 'GET',
		query,
		headers: { 'x-real-ip': testIp, ...headers },
		url: '/api/newznab/api',
	});
	const res = createMockResponse();
	await handler(req as never, res as never);
	return res;
}

function body(res: MockResponse): string {
	return String(res._getData());
}

/** Every URL global fetch was called with, in order. */
function fetchedUrls(): string[] {
	return fetchMock.mock.calls.map(([input]) => String(input));
}

beforeAll(() => {
	// No Redis means the hybrid limiter counts in memory, and no whitelist means
	// the sponsor identifiers below are actually counted.
	delete process.env.REDIS_URL;
	delete process.env.RATE_LIMIT_WHITELIST_IPS;
});

beforeEach(() => {
	vi.clearAllMocks();

	process.env.NEWZNAB_TOKEN_SECRET = SECRET;
	_resetTokenSecretForTest();
	delete process.env.NEWZNAB_PUBLIC_BASE;
	setIndexers(INDEXERS);
	_resetUpstreamLimiterForTest();

	// A fresh sponsorship per test: the in-memory limiter is a module singleton
	// and its buckets are keyed on this.
	shortId = `Z${Math.random().toString(36).slice(2, 8)}`;
	testIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
	mockRepo.getSponsorByDmmApiKey = vi.fn().mockResolvedValue({
		isSponsor: true,
		sources: ['github'],
		shortId,
		githubUsername: 'someone',
		keyVersion: 1,
	});

	cacheStore = new Map();
	mockRepo.getCachedNewznabApiSearch = vi.fn(async (key: string) => {
		const results = cacheStore.get(key);
		return results ? { results, updatedAt: new Date(), isFresh: true } : null;
	});
	mockRepo.setCachedNewznabApiSearch = vi.fn(async (key: string, results) => {
		cacheStore.set(key, results as CachedUsenetResult[]);
	});

	mockGetStored.mockResolvedValue(null);
	mockPutStored.mockResolvedValue(true);

	nzbBody = RAW_NZB;
	fetchMock = vi.fn(async (input: unknown) => {
		const url = String(input);
		if (url.includes('t=get')) return textResponse(nzbBody);
		return jsonResponse(url.startsWith(FIRST_HOST) ? FIRST_RESPONSE : SECOND_RESPONSE);
	});
	global.fetch = fetchMock as never;
});

describe('GET /api/newznab/api caps', () => {
	it('answers without a key, because Prowlarr tests caps before it has one', async () => {
		const res = await run({ t: 'caps' });

		expect(res._getStatusCode()).toBe(200);
		expect(body(res)).toContain('<caps>');
		expect(mockRepo.getSponsorByDmmApiKey).not.toHaveBeenCalled();
		expect(res._getHeaders()['Cache-Control']).toBe('public, s-maxage=3600');
	});

	it('still answers when the token secret is missing', async () => {
		delete process.env.NEWZNAB_TOKEN_SECRET;
		_resetTokenSecretForTest();

		expect(body(await run({ t: 'caps' }))).toContain('<caps>');
	});

	it('advertises the same limit the search handler caps at', async () => {
		expect(body(await run({ t: 'caps' }))).toContain('<limits max="100" default="100"/>');
	});
});

describe('GET /api/newznab/api authentication', () => {
	it('answers 100 when no key is presented', async () => {
		const res = await run({ t: 'search', q: 'anything' });

		expect(res._getStatusCode()).toBe(200);
		expect(body(res)).toContain('<error code="100"');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('answers 100 for a key no sponsorship owns', async () => {
		mockRepo.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(null);

		expect(body(await run({ t: 'search', apikey: SPONSOR_KEY }))).toContain(
			'<error code="100"'
		);
	});

	// Split from "incorrect credentials" on purpose: a lapsed sponsor otherwise
	// re-copies the same working key forever.
	it('answers 101 once the sponsorship has lapsed', async () => {
		mockRepo.getSponsorByDmmApiKey = vi.fn().mockResolvedValue({
			isSponsor: false,
			sources: [],
			shortId,
			githubUsername: 'someone',
			keyVersion: 1,
		});

		const res = await run({ t: 'search', apikey: SPONSOR_KEY });

		expect(body(res)).toContain('<error code="101"');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('accepts the key from the x-api-key header too', async () => {
		const res = await run({ t: 'search', q: 'thing' }, { 'x-api-key': SPONSOR_KEY });

		expect(mockRepo.getSponsorByDmmApiKey).toHaveBeenCalledWith(SPONSOR_KEY);
		expect(body(res)).toContain('<rss');
	});

	it('refuses everything but caps when the token secret is missing', async () => {
		delete process.env.NEWZNAB_TOKEN_SECRET;
		_resetTokenSecretForTest();

		for (const t of ['search', 'tvsearch', 'movie', 'get']) {
			expect(body(await run({ t, apikey: SPONSOR_KEY }))).toContain('<error code="910"');
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('answers 202 for a function it does not have', async () => {
		expect(body(await run({ t: 'music', apikey: SPONSOR_KEY }))).toContain('<error code="202"');
		expect(body(await run({ apikey: SPONSOR_KEY }))).toContain('<error code="202"');
	});

	it('refuses a non-GET', async () => {
		const req = createMockRequest({ method: 'POST', query: { t: 'caps' } });
		const res = createMockResponse();
		await handler(req as never, res as never);

		expect(res._getStatusCode()).toBe(405);
	});
});

describe('GET /api/newznab/api search', () => {
	it('names no upstream anywhere in the response', async () => {
		const res = await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY });
		const xml = body(res);

		// The whole reason this endpoint rewrites every item: a hostname, a key or
		// a qualified id each names the paid accounts DMM fans out to.
		expect(xml).not.toContain('first-upstream.invalid');
		expect(xml).not.toContain('second-upstream.invalid');
		expect(xml).not.toContain(FIRST_KEY);
		expect(xml).not.toContain(SECOND_KEY);
		expect(xml).not.toContain('ds:');
		expect(xml).not.toContain('ah:');
		// And it did reach both of them, so this is not passing on an empty feed.
		expect(fetchedUrls()).toHaveLength(2);
	});

	it('gives every item a guid that is also its enclosure id', async () => {
		const xml = body(await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY }));

		const guids = [...xml.matchAll(/<guid isPermaLink="false">([^<]+)<\/guid>/g)].map(
			(match) => match[1]
		);
		const enclosures = [...xml.matchAll(/<enclosure url="([^"]+)"/g)].map((match) =>
			match[1].replace(/&amp;/g, '&')
		);

		expect(guids).toHaveLength(2);
		guids.forEach((guid, index) => {
			const url = new URL(enclosures[index]);
			expect(url.pathname).toBe('/api/newznab/api');
			expect(url.searchParams.get('t')).toBe('get');
			expect(url.searchParams.get('id')).toBe(guid);
			// The caller's own key, so the grab that follows arrives authenticated.
			expect(url.searchParams.get('apikey')).toBe(SPONSOR_KEY);
			expect(url.origin).toBe('https://debridmediamanager.com');
		});
	});

	it('builds enclosure URLs against NEWZNAB_PUBLIC_BASE, never the request host', async () => {
		process.env.NEWZNAB_PUBLIC_BASE = 'https://dmm.example.test/';

		const xml = body(
			await run(
				{ t: 'search', q: 'some release', apikey: SPONSOR_KEY },
				{ host: 'internal.tailnet' }
			)
		);

		expect(xml).toContain('https://dmm.example.test/api/newznab/api?t=get');
		expect(xml).not.toContain('internal.tailnet');
	});

	it('reads size, pubDate and categories out of both upstream dialects', async () => {
		const xml = body(await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY }));

		expect(xml).toContain('<title>Some.Release.2160p.WEB</title>');
		expect(xml).toContain('<pubDate>Mon, 17 Nov 2025 22:08:02 +0000</pubDate>');
		expect(xml).toContain('<newznab:attr name="size" value="1234567"/>');
		expect(xml).toContain('<newznab:attr name="category" value="2040"/>');

		expect(xml).toContain('<title>Another.Release.1080p</title>');
		expect(xml).toContain('<pubDate>Tue, 18 Nov 2025 10:00:00 +0000</pubDate>');
		expect(xml).toContain('<newznab:attr name="size" value="7654321"/>');
		expect(xml).toContain('<newznab:attr name="category" value="5000"/>');
	});

	it('forwards the normalised query upstream, imdb id stripped of its tt', async () => {
		await run({
			t: 'tvsearch',
			imdbid: 'tt0111161',
			tvdbid: '121361',
			season: '2',
			ep: '9',
			cat: '5000,5040',
			apikey: SPONSOR_KEY,
		});

		const url = new URL(fetchedUrls()[0]);
		expect(url.searchParams.get('t')).toBe('tvsearch');
		// Bare digits: House-of-Usenet and NinjaCentral return nothing for `tt…`.
		expect(url.searchParams.get('imdbid')).toBe('0111161');
		expect(url.searchParams.get('tvdbid')).toBe('121361');
		expect(url.searchParams.get('season')).toBe('2');
		expect(url.searchParams.get('ep')).toBe('9');
		expect(url.searchParams.get('cat')).toBe('5000,5040');
		expect(url.searchParams.get('apikey')).toBe(FIRST_KEY);
		expect(url.searchParams.get('o')).toBe('json');
		// A client asking for ten must not poison the cache with a set of ten.
		expect(url.searchParams.get('limit')).toBe('100');
	});

	it('drops a malformed parameter rather than forwarding it', async () => {
		await run({
			t: 'search',
			q: 'thing',
			cat: 'movies; drop table',
			imdbid: 'not-an-id',
			season: 'S02',
			apikey: SPONSOR_KEY,
		});

		const url = new URL(fetchedUrls()[0]);
		expect(url.searchParams.get('q')).toBe('thing');
		expect(url.searchParams.has('cat')).toBe(false);
		expect(url.searchParams.has('imdbid')).toBe(false);
		expect(url.searchParams.has('season')).toBe(false);
	});

	// The whole point of the cache: an *arr polls the same searches on a timer,
	// and every miss spends a call against one shared upstream account.
	it('serves an identical second search without touching an upstream', async () => {
		await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY });
		expect(fetchedUrls()).toHaveLength(2);

		fetchMock.mockClear();
		const res = await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(body(res)).toContain('<title>Some.Release.2160p.WEB</title>');
	});

	it('pages out of the one cached set, so a second page costs nothing', async () => {
		await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY, limit: '1' });
		fetchMock.mockClear();

		const res = await run({
			t: 'search',
			q: 'some release',
			apikey: SPONSOR_KEY,
			limit: '1',
			offset: '1',
		});

		expect(fetchMock).not.toHaveBeenCalled();
		const xml = body(res);
		expect(xml).toContain('<newznab:response offset="1" total="2"/>');
		expect(xml).toContain('Another.Release.1080p');
		expect(xml).not.toContain('Some.Release.2160p.WEB');
	});

	it('falls back to a stale entry when every upstream is down', async () => {
		await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY });

		mockRepo.getCachedNewznabApiSearch = vi.fn(async (key: string) => {
			const results = cacheStore.get(key);
			return results ? { results, updatedAt: new Date(0), isFresh: false } : null;
		});
		fetchMock.mockRejectedValue(new Error('upstream is down'));

		const res = await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY });

		// An empty feed reads to an *arr as "this release is gone".
		expect(body(res)).toContain('<title>Some.Release.2160p.WEB</title>');
		expect(mockRepo.setCachedNewznabApiSearch).toHaveBeenCalledTimes(1);
	});

	it('answers an empty feed when everything is down and nothing was cached', async () => {
		fetchMock.mockRejectedValue(new Error('upstream is down'));

		const res = await run({ t: 'search', q: 'nothing here', apikey: SPONSOR_KEY });

		expect(res._getStatusCode()).toBe(200);
		expect(body(res)).toContain('<newznab:response offset="0" total="0"/>');
		expect(mockRepo.setCachedNewznabApiSearch).not.toHaveBeenCalled();
	});

	it('skips an upstream that is over its configured pacing', async () => {
		setIndexers([INDEXERS[0], { ...INDEXERS[1], pacing: { rateLimit: 1, windowSeconds: 60 } }]);

		await run({ t: 'search', q: 'first query', apikey: SPONSOR_KEY });
		expect(fetchedUrls().filter((url) => url.startsWith(SECOND_HOST))).toHaveLength(1);

		fetchMock.mockClear();
		await run({ t: 'search', q: 'second query', apikey: SPONSOR_KEY });

		// Asked and refused would cost an *arr-side backoff; skipped costs one
		// query's coverage.
		expect(fetchedUrls()).toHaveLength(1);
		expect(fetchedUrls()[0].startsWith(FIRST_HOST)).toBe(true);
	});

	it('answers 429 with a Newznab error document once the search budget is spent', async () => {
		for (let i = 0; i < 30; i++) {
			// Rotate the IP so only the per-key budget is being spent: 30 calls
			// from one address would trip the pre-auth IP reject at 20 first.
			testIp = `10.200.${i}.1`;
			expect(
				(
					await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY })
				)._getStatusCode()
			).toBe(200);
		}

		testIp = '10.200.99.1';
		const res = await run({ t: 'search', q: 'some release', apikey: SPONSOR_KEY });

		expect(res._getStatusCode()).toBe(429);
		// JSON here would read to several clients as an unreachable indexer.
		expect(body(res)).toContain('<error code="500"');
		expect(body(res)).toContain('Request limit reached');
		expect(Number(res._getHeaders()['Retry-After'])).toBeGreaterThan(0);
	});
});

describe('GET /api/newznab/api grab', () => {
	const token = () => encryptReleaseId('ds', 'first-native-id');

	it('fetches from the upstream the token names and serves a sanitized NZB', async () => {
		const id = token();
		const res = await run({ t: 'get', id, apikey: SPONSOR_KEY });

		const url = new URL(fetchedUrls()[0]);
		expect(url.origin + url.pathname).toBe(FIRST_HOST);
		expect(url.searchParams.get('t')).toBe('get');
		expect(url.searchParams.get('id')).toBe('first-native-id');
		expect(url.searchParams.get('apikey')).toBe(FIRST_KEY);

		const xml = body(res);
		// The per-download watermark is what traces a leaked NZB back to the
		// account that grabbed it.
		expect(xml).not.toContain('0a624180.27889905291');
		expect(xml).not.toContain('first-upstream.invalid');
		expect(xml).toContain('<meta type="name">Some.Release.2160p.WEB</meta>');
		expect(xml).toContain('first-article@news');

		expect(res._getHeaders()['Content-Type']).toBe('application/x-nzb; charset=utf-8');
		expect(res._getHeaders()['Content-Disposition']).toContain(`filename="${id}.nzb"`);
		expect(res._getHeaders()['X-Nzb-Removed']).toContain('<meta type="tag">');
	});

	it('stores what it served, so the next grab of it is free', async () => {
		const res = await run({ t: 'get', id: token(), apikey: SPONSOR_KEY });

		expect(mockPutStored).toHaveBeenCalledWith('ds', 'first-native-id', body(res));
	});

	it('serves a store hit without touching an upstream', async () => {
		mockGetStored.mockResolvedValue('<nzb>already stored</nzb>');

		const res = await run({ t: 'get', id: token(), apikey: SPONSOR_KEY });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(body(res)).toBe('<nzb>already stored</nzb>');
		expect(res._getHeaders()['X-Nzb-Removed']).toBe('-');
		expect(mockPutStored).not.toHaveBeenCalled();
	});

	it('answers 300 for a tampered or foreign token', async () => {
		const valid = token();
		const tampered = `${valid.slice(0, -1)}${valid.endsWith('A') ? 'B' : 'A'}`;

		for (const id of [tampered, 'not-a-token', '']) {
			const res = await run({ t: 'get', id, apikey: SPONSOR_KEY });
			expect(res._getStatusCode()).toBe(200);
			expect(body(res)).toContain('<error code="300"');
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('answers 300 for a token naming an indexer no longer configured', async () => {
		const id = encryptReleaseId('gone', 'orphan-id');

		expect(body(await run({ t: 'get', id, apikey: SPONSOR_KEY }))).toContain(
			'<error code="300"'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// The upstreams answer a dead release with `<error/>` and HTTP 200, so status
	// alone cannot be trusted — without the envelope check the error document is
	// served as if it were the NZB.
	it('answers 300 when the upstream returns an error envelope with HTTP 200', async () => {
		nzbBody = ERROR_ENVELOPE;

		const res = await run({ t: 'get', id: token(), apikey: SPONSOR_KEY });

		expect(res._getStatusCode()).toBe(200);
		expect(body(res)).toContain('<error code="300"');
		// And the failure message may not name the server that refused it.
		expect(body(res)).not.toContain('First Upstream');
		expect(mockPutStored).not.toHaveBeenCalled();
	});

	it('answers 300 when the NZB has nothing left to download', async () => {
		nzbBody = '<?xml version="1.0"?><nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"></nzb>';

		const res = await run({ t: 'get', id: token(), apikey: SPONSOR_KEY });

		expect(body(res)).toContain('<error code="300"');
		expect(body(res)).toContain('not an NZB');
	});

	it('requires a sponsorship', async () => {
		const res = await run({ t: 'get', id: token() });

		expect(body(res)).toContain('<error code="100"');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('spends both grab budgets and answers 429 once the burst one is gone', async () => {
		for (let i = 0; i < 10; i++) {
			expect(
				(await run({ t: 'get', id: token(), apikey: SPONSOR_KEY }))._getStatusCode()
			).toBe(200);
		}

		const res = await run({ t: 'get', id: token(), apikey: SPONSOR_KEY });

		expect(res._getStatusCode()).toBe(429);
		expect(body(res)).toContain('<error code="500"');
		expect(Number(res._getHeaders()['Retry-After'])).toBeGreaterThan(0);
	});
});

describe('GET /api/newznab/api pre-auth IP reject', () => {
	// The outer guard used to be `withIpRateLimit`, whose 429 carries a JSON
	// body — which an *arr logs as a broken indexer rather than backing off.
	// This pins the replacement answering in the protocol, before any auth.
	it('answers 429 as a Newznab error document, without a sponsor lookup', async () => {
		let res: MockResponse | null = null;
		for (let i = 0; i < 21; i++) {
			res = await run({ t: 'caps' });
		}

		expect(res?._getStatusCode()).toBe(429);
		expect(body(res as MockResponse)).toContain('<error code="500"');
		expect(Number((res as MockResponse)._getHeaders()['Retry-After'])).toBeGreaterThan(0);
		expect(mockRepo.getSponsorByDmmApiKey).not.toHaveBeenCalled();
	});
});

describe('RSS-shaped queries get the short cache cap', () => {
	// An untargeted t=search is an *arr RSS sync: its results are always brand
	// new, so the age tiers alone would hold it 12h and new releases would reach
	// sponsors half a day late. Targeted queries keep the age-scaled TTL.
	it('passes RSS_TTL_MS for a query naming no title or id', async () => {
		await run({ t: 'search', cat: '5000', apikey: SPONSOR_KEY });

		expect(mockRepo.getCachedNewznabApiSearch).toHaveBeenCalledWith(
			expect.any(String),
			RSS_TTL_MS
		);
	});

	it('leaves targeted queries uncapped', async () => {
		await run({ t: 'search', q: 'some show', apikey: SPONSOR_KEY });
		await run({ t: 'movie', imdbid: 'tt1418646', apikey: SPONSOR_KEY });

		for (const call of (mockRepo.getCachedNewznabApiSearch as any).mock.calls) {
			expect(call[1]).toBeUndefined();
		}
	});
});
