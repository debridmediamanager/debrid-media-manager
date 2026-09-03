import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildPackQueries,
	buildSearchUrl,
	buildTextSearchUrl,
	dedupeResults,
	fanOut,
	fetchNzb,
	fetchNzbFrom,
	getIndexers,
	isCompleteOAuth,
	isSeasonPack,
	isValidImdbId,
	looksLikeEpisode,
	newznabError,
	parseNewznabItem,
	parseNewznabResponse,
	parseReleaseId,
	releaseDedupKey,
	searchSeasonPacks,
	searchUsenet,
	submitNzb,
} from './nzb2rd';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	process.env.NEWZNAB_URL = 'https://indexer.test/api';
	process.env.NEWZNAB_API_KEY = 'secret-key';
	process.env.NZB2RD_URL = 'http://nzb2rd.test:3200';
});

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
	vi.restoreAllMocks();
});

describe('isValidImdbId', () => {
	it('accepts 7-to-9 digit ids and rejects anything else', () => {
		expect(isValidImdbId('tt1418646')).toBe(true);
		expect(isValidImdbId('tt123456789')).toBe(true);
		expect(isValidImdbId('tt123')).toBe(false);
		expect(isValidImdbId('1418646')).toBe(false);
		expect(isValidImdbId(undefined)).toBe(false);
	});
});

describe('buildSearchUrl', () => {
	it('strips the tt prefix, because the indexer wants bare digits', () => {
		const url = new URL(buildSearchUrl({ imdbId: 'tt1418646' }));
		expect(url.searchParams.get('imdbid')).toBe('1418646');
		expect(url.searchParams.get('t')).toBe('movie');
		expect(url.searchParams.get('season')).toBeNull();
		expect(url.searchParams.get('apikey')).toBe('secret-key');
	});

	it('switches to tvsearch when a season is given', () => {
		const url = new URL(buildSearchUrl({ imdbId: 'tt0944947', seasonNum: 3 }));
		expect(url.searchParams.get('t')).toBe('tvsearch');
		expect(url.searchParams.get('season')).toBe('3');
	});

	it('treats season 0 as a real season, not a missing one', () => {
		const url = new URL(buildSearchUrl({ imdbId: 'tt0944947', seasonNum: 0 }));
		expect(url.searchParams.get('t')).toBe('tvsearch');
		expect(url.searchParams.get('season')).toBe('0');
	});

	// The indexer matches TV against TVDB and its imdb mapping lags weeks behind a
	// premiere, so an imdbid-keyed season search returns nothing at all for a show
	// that is currently airing. Keying on TVDB is what makes those seasons findable.
	it('keys a season on the TVDB id when one is known, and drops imdbid', () => {
		const url = new URL(buildSearchUrl({ imdbId: 'tt27497393', seasonNum: 1, tvdbId: 465664 }));
		expect(url.searchParams.get('t')).toBe('tvsearch');
		expect(url.searchParams.get('tvdbid')).toBe('465664');
		expect(url.searchParams.get('season')).toBe('1');
		expect(url.searchParams.get('imdbid')).toBeNull();
	});

	it('falls back to imdbid when no TVDB id could be resolved', () => {
		const url = new URL(buildSearchUrl({ imdbId: 'tt0944947', seasonNum: 3 }));
		expect(url.searchParams.get('imdbid')).toBe('0944947');
		expect(url.searchParams.get('tvdbid')).toBeNull();
	});

	it('keeps season 0 on the TVDB id too', () => {
		const url = new URL(buildSearchUrl({ imdbId: 'tt0944947', seasonNum: 0, tvdbId: 121361 }));
		expect(url.searchParams.get('tvdbid')).toBe('121361');
		expect(url.searchParams.get('imdbid')).toBeNull();
	});

	// t=movie takes no other id — caps lists q,imdbid.
	it('ignores a TVDB id for a movie', () => {
		const url = new URL(buildSearchUrl({ imdbId: 'tt1418646', tvdbId: 465664 }));
		expect(url.searchParams.get('t')).toBe('movie');
		expect(url.searchParams.get('imdbid')).toBe('1418646');
		expect(url.searchParams.get('tvdbid')).toBeNull();
	});
});

describe('parseNewznabItem', () => {
	const item = {
		title: 'Some.Release.2010.1080p.BluRay.x264-GRP',
		guid: { _isPermaLink: 'true', text: 'https://indexer.test/details/abc123' },
		'newznab:attr': [
			{ _name: 'size', _value: '6459339787' },
			{ _name: 'grabs', _value: '35' },
		],
	};

	it('keeps only the guid last segment, which is what t=get wants', () => {
		expect(parseNewznabItem(item)).toEqual({
			id: 'abc123',
			title: 'Some.Release.2010.1080p.BluRay.x264-GRP',
			size: 6459339787,
		});
	});

	it('accepts a bare-string guid', () => {
		expect(parseNewznabItem({ ...item, guid: 'abc123' })?.id).toBe('abc123');
	});

	it('falls back to the enclosure length when no size attribute is present', () => {
		const parsed = parseNewznabItem({
			title: 'A',
			guid: 'x',
			'newznab:attr': [{ _name: 'grabs', _value: '1' }],
			enclosure: { _length: '1234' },
		});
		expect(parsed?.size).toBe(1234);
	});

	it('reports an unknown size as 0 rather than NaN', () => {
		const parsed = parseNewznabItem({ title: 'A', guid: 'x' });
		expect(parsed?.size).toBe(0);
	});

	it('handles a single attribute sent as an object instead of an array', () => {
		const parsed = parseNewznabItem({
			title: 'A',
			guid: 'x',
			'newznab:attr': { _name: 'size', _value: '99' },
		});
		expect(parsed?.size).toBe(99);
	});

	it('drops items with no title or no id', () => {
		expect(parseNewznabItem({ title: '', guid: 'x' })).toBeNull();
		expect(parseNewznabItem({ title: 'A', guid: '' })).toBeNull();
		expect(parseNewznabItem(null)).toBeNull();
	});
});

describe('parseNewznabResponse', () => {
	const one = { title: 'A', guid: 'a', 'newznab:attr': [{ _name: 'size', _value: '10' }] };

	it('reads the DrunkenSlug shape, where item sits at the top level', () => {
		expect(parseNewznabResponse({ item: [one] })).toHaveLength(1);
	});

	it('reads the standard shape, where item sits under channel', () => {
		expect(parseNewznabResponse({ channel: { item: [one] } })).toHaveLength(1);
	});

	it('treats a lone object item as a one-result list', () => {
		expect(parseNewznabResponse({ item: one })).toHaveLength(1);
	});

	it('returns nothing for an empty or malformed body', () => {
		expect(parseNewznabResponse({})).toEqual([]);
		expect(parseNewznabResponse(null)).toEqual([]);
	});
});

describe('searchUsenet', () => {
	it('never exposes the indexer link, which carries the api key', async () => {
		const leakyLink = 'https://indexer.test/getnzb/abc123.nzb&i=1&r=secret-key';
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					item: [
						{
							title: 'A',
							guid: 'https://indexer.test/details/abc123',
							link: leakyLink,
							enclosure: { _url: leakyLink, _length: '10' },
							'newznab:attr': [{ _name: 'size', _value: '10' }],
						},
					],
				}),
			})
		);

		const results = await searchUsenet({ imdbId: 'tt1418646' });

		expect(results).toEqual([
			{ id: 'ds:abc123', title: 'A', size: 10, indexer: 'DrunkenSlug' },
		]);
		expect(JSON.stringify(results)).not.toContain('secret-key');
	});

	it('throws when every indexer errors, so the caller can serve its cache', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
		await expect(searchUsenet({ imdbId: 'tt1418646' })).rejects.toThrow(
			'no indexer could be reached'
		);
	});
});

describe('fetchNzb', () => {
	it('asks for the release by id with t=get', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '<nzb></nzb>' });
		vi.stubGlobal('fetch', fetchMock);

		await expect(fetchNzb('abc123')).resolves.toBe('<nzb></nzb>');

		const url = new URL(fetchMock.mock.calls[0][0]);
		expect(url.searchParams.get('t')).toBe('get');
		expect(url.searchParams.get('id')).toBe('abc123');
		expect(url.searchParams.get('apikey')).toBe('secret-key');
	});

	it('throws when the download fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
		await expect(fetchNzb('abc123')).rejects.toThrow('404');
	});
});

describe('submitNzb', () => {
	it('posts the NZB with the submitter own RD key so it lands in their account', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			status: 201,
			json: async () => ({ id: 'job-1', status: 'pending' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await submitNzb({
			nzbText: '<nzb></nzb>',
			nzbName: 'release.nzb',
			imdbId: 'tt1418646',
			rdKey: 'user-rd-key',
		});

		expect(result).toEqual({ status: 201, data: { id: 'job-1', status: 'pending' } });

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://nzb2rd.test:3200/jobs');
		expect(init.method).toBe('POST');
		const form = init.body as FormData;
		expect(form.get('imdb_id')).toBe('tt1418646');
		expect(form.get('rd_api_key')).toBe('user-rd-key');
		expect((form.get('nzb') as File).name).toBe('release.nzb');
	});

	// The fix for `RD addTorrent failed: 401 bad_token`. `rdKey` is an OAuth
	// access token that RD expires 24h after login, and nzb2rd's queue is days
	// deep — so without something refreshable the job is guaranteed to reach the
	// hand-off with a dead credential.
	it('sends the long-lived OAuth credentials so a queued job can refresh its token', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ status: 201, json: async () => ({ id: 'job-1' }) });
		vi.stubGlobal('fetch', fetchMock);

		await submitNzb({
			nzbText: '<nzb></nzb>',
			nzbName: 'release.nzb',
			imdbId: 'tt1418646',
			rdKey: 'user-rd-key',
			oauth: { clientId: 'CID', clientSecret: 'CSEC', refreshToken: 'CREF' },
		});

		const form = fetchMock.mock.calls[0][1].body as FormData;
		expect(form.get('rd_client_id')).toBe('CID');
		expect(form.get('rd_client_secret')).toBe('CSEC');
		expect(form.get('rd_refresh_token')).toBe('CREF');
		// Still sent: it is what nzb2rd falls back to if RD cannot be reached.
		expect(form.get('rd_api_key')).toBe('user-rd-key');
	});

	// A partial triple cannot mint anything, so sending it would only put a
	// secret on the wire and in nzb2rd's database for no benefit.
	it.each([
		['none', undefined],
		['null', null],
		['partial', { clientId: 'CID', clientSecret: '', refreshToken: 'CREF' }],
	])('omits the OAuth fields entirely when they are %s', async (_label, oauth) => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ status: 201, json: async () => ({ id: 'job-1' }) });
		vi.stubGlobal('fetch', fetchMock);

		await submitNzb({
			nzbText: '<nzb></nzb>',
			nzbName: 'release.nzb',
			imdbId: 'tt1418646',
			rdKey: 'user-rd-key',
			oauth: oauth as never,
		});

		const form = fetchMock.mock.calls[0][1].body as FormData;
		expect(form.get('rd_client_id')).toBeNull();
		expect(form.get('rd_client_secret')).toBeNull();
		expect(form.get('rd_refresh_token')).toBeNull();
	});

	it('passes a non-2xx status through instead of throwing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ status: 400, json: async () => ({ error: 'empty NZB' }) })
		);
		const result = await submitNzb({
			nzbText: 'x',
			nzbName: 'a.nzb',
			imdbId: 'tt1418646',
			rdKey: 'k',
		});
		expect(result.status).toBe(400);
	});
});

describe('isCompleteOAuth', () => {
	it('accepts a complete triple and rejects anything less', () => {
		const full = { clientId: 'a', clientSecret: 'b', refreshToken: 'c' };
		expect(isCompleteOAuth(full)).toBe(true);
		expect(isCompleteOAuth({ ...full, refreshToken: '' })).toBe(false);
		expect(isCompleteOAuth({ clientId: 'a' })).toBe(false);
		expect(isCompleteOAuth(null)).toBe(false);
		expect(isCompleteOAuth(undefined)).toBe(false);
	});
});

describe('looksLikeEpisode', () => {
	// Every one of these forms is real indexer output. The spaced and EP variants
	// are the ones that would otherwise be mistaken for whole-season releases.
	it.each([
		'Game.of.Thrones.S02E08.The.Prince.of.Winterfell.1080p',
		'Game of Thrones S02 EP09.mkv',
		'Game_of_Thrones_S02_E10_BluRay_720p',
		'Some.Show.2x09.HDTV',
		'Some Show Episode 4 1080p',
	])('treats %s as an episode', (title) => {
		expect(looksLikeEpisode(title)).toBe(true);
	});

	it.each([
		'Game.of.Thrones.S02.2160p.MAX.WEB-DL.TrueHD.7.1.Atmos.DV.HDR.H.265',
		'Breaking.Bad.S03.1080p.NF.WEB-DL.EAC3.SDR.H265',
		'The.Wire.S01.1080p.BluRay.H264-GERUDO',
	])('does not treat %s as an episode', (title) => {
		expect(looksLikeEpisode(title)).toBe(false);
	});
});

describe('isSeasonPack', () => {
	it('accepts both the S0N and Season N spellings', () => {
		expect(isSeasonPack('The.Wire.S01.1080p.BluRay', 1)).toBe(true);
		expect(isSeasonPack('The Wire Season 1 1080p', 1)).toBe(true);
	});

	it('rejects a pack for a different season', () => {
		expect(isSeasonPack('The.Wire.S02.1080p.BluRay', 1)).toBe(false);
	});

	it('rejects single episodes even when they name the season', () => {
		expect(isSeasonPack('Game of Thrones S02 EP09.mkv', 2)).toBe(false);
		expect(isSeasonPack('Game.of.Thrones.S02E08.1080p', 2)).toBe(false);
	});
});

describe('buildPackQueries', () => {
	it('asks three ways, because each finds packs the others miss', () => {
		expect(buildPackQueries('Game of Thrones', 2)).toEqual([
			'Game of Thrones S02',
			'Game of Thrones S02 COMPLETE',
			'Game of Thrones Season 2',
		]);
	});

	it('zero-pads the season in the S0N form only', () => {
		expect(buildPackQueries('Show', 10)).toEqual([
			'Show S10',
			'Show S10 COMPLETE',
			'Show Season 10',
		]);
	});
});

describe('buildTextSearchUrl', () => {
	it('is a TV-category free-text search', () => {
		const url = new URL(buildTextSearchUrl('Game of Thrones S02'));
		expect(url.searchParams.get('t')).toBe('search');
		expect(url.searchParams.get('cat')).toBe('5000');
		expect(url.searchParams.get('q')).toBe('Game of Thrones S02');
	});
});

describe('searchSeasonPacks', () => {
	const item = (id: string, title: string) => ({
		title,
		guid: id,
		'newznab:attr': [{ _name: 'size', _value: '100' }],
	});

	it('unions the three phrasings and drops episodes', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ item: [item('a', 'Show.S02.2160p.WEB-DL')] }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ item: [item('b', 'Show.S02.COMPLETE.BluRay')] }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						item: [item('a', 'Show.S02.2160p.WEB-DL'), item('c', 'Show S02 EP03')],
					}),
				})
		);

		const packs = await searchSeasonPacks('Show', 2);

		expect(packs.map((p) => p.id).sort()).toEqual(['ds:a', 'ds:b']); // 'a' deduped, episode dropped
		expect(packs.every((p) => p.isPack)).toBe(true);
	});

	it('skips a phrasing that fails rather than losing the others', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockRejectedValueOnce(new Error('429'))
				.mockResolvedValue({
					ok: true,
					json: async () => ({ item: [item('b', 'Show.S02.COMPLETE.BluRay')] }),
				})
		);

		const packs = await searchSeasonPacks('Show', 2);
		expect(packs).toHaveLength(1);
	});
});

describe('searchUsenet with a show title', () => {
	it('puts packs ahead of the episode list', async () => {
		const fetchMock = vi
			.fn()
			// tvsearch (episodes)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					item: [
						{
							title: 'Show.S02E01.1080p',
							guid: 'ep1',
							'newznab:attr': [{ _name: 'size', _value: '10' }],
						},
					],
				}),
			})
			// the three pack phrasings
			.mockResolvedValue({
				ok: true,
				json: async () => ({
					item: [
						{
							title: 'Show.S02.COMPLETE.1080p',
							guid: 'pack1',
							'newznab:attr': [{ _name: 'size', _value: '99' }],
						},
					],
				}),
			});
		vi.stubGlobal('fetch', fetchMock);

		const results = await searchUsenet({ imdbId: 'tt0944947', seasonNum: 2, title: 'Show' });

		expect(results.map((r) => r.id)).toEqual(['ds:pack1', 'ds:ep1']);
		expect(results[0].isPack).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(4); // 1 tvsearch + 3 pack queries
	});

	it('does not run pack queries for a movie', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: [] }) });
		vi.stubGlobal('fetch', fetchMock);

		await searchUsenet({ imdbId: 'tt1418646' });

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not run pack queries for a season with no title to ask by', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: [] }) });
		vi.stubGlobal('fetch', fetchMock);

		await searchUsenet({ imdbId: 'tt0944947', seasonNum: 2 });

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	// The pack queries are by name and unaffected; it is the episode query that
	// has to carry the TVDB id, since that is the one keyed on an id at all.
	it('sends the TVDB id on the episode query and leaves the pack queries alone', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: [] }) });
		vi.stubGlobal('fetch', fetchMock);

		await searchUsenet({ imdbId: 'tt27497393', seasonNum: 1, title: 'Show', tvdbId: 465664 });

		const [episodeUrl, ...packUrls] = fetchMock.mock.calls.map(
			(call: unknown[]) => new URL(call[0] as string)
		);
		expect(episodeUrl.searchParams.get('tvdbid')).toBe('465664');
		expect(episodeUrl.searchParams.get('imdbid')).toBeNull();
		expect(packUrls).toHaveLength(3);
		expect(packUrls.every((url) => url.searchParams.get('t') === 'search')).toBe(true);
	});
});

// --- altHUB, the second indexer ------------------------------------------
//
// Everything below is shape-checked against real altHUB responses: it wraps
// attributes as {"@attributes":{name,value}} under an `attr` key, keeps the
// `channel` wrapper DrunkenSlug drops, and puts enclosure length inside
// @attributes too.

const withAlthub = () => {
	process.env.ALTHUB_URL = 'https://althub.test/api';
	process.env.ALTHUB_API_KEY = 'althub-key';
};

describe('getIndexers', () => {
	it('leaves out an indexer with no api key, so althub stays dormant until set', () => {
		expect(getIndexers().map((i) => i.prefix)).toEqual(['ds']);
	});

	it('puts DrunkenSlug first, so it wins a title collision', () => {
		withAlthub();
		expect(getIndexers().map((i) => i.prefix)).toEqual(['ds', 'ah']);
	});

	it('drops DrunkenSlug too when only althub is configured', () => {
		process.env.NEWZNAB_API_KEY = '';
		withAlthub();
		expect(getIndexers().map((i) => i.prefix)).toEqual(['ah']);
	});
});

describe('parseNewznabItem on the altHUB shape', () => {
	it('reads @attributes-wrapped attrs under the `attr` key', () => {
		const parsed = parseNewznabItem({
			title: 'The Shawshank Redemption (1994) (1080p BluRay x265)',
			guid: 'https://api.althub.co.za/details/059b7d67b61d504fd66ff052be4d8a0f',
			attr: [
				{ '@attributes': { name: 'size', value: '10481372683' } },
				{ '@attributes': { name: 'imdb', value: '0111161' } },
			],
		});
		expect(parsed).toEqual({
			id: '059b7d67b61d504fd66ff052be4d8a0f',
			title: 'The Shawshank Redemption (1994) (1080p BluRay x265)',
			size: 10481372683,
		});
	});

	it('reads the @attributes enclosure length when there is no size attr', () => {
		const parsed = parseNewznabItem({
			title: 'A',
			guid: 'x',
			enclosure: { '@attributes': { url: 'https://althub.test/getnzb/x', length: '4321' } },
		});
		expect(parsed?.size).toBe(4321);
	});

	it('still reads the DrunkenSlug shape, so one parser serves both', () => {
		const parsed = parseNewznabItem({
			title: 'A',
			guid: 'x',
			'newznab:attr': [{ _name: 'size', _value: '99' }],
		});
		expect(parsed?.size).toBe(99);
	});
});

describe('releaseDedupKey', () => {
	// The indexers format the same posting differently; without normalising, a
	// release present on both would show up twice.
	it('collapses dotted and spaced spellings of the same release', () => {
		expect(releaseDedupKey('The.Matrix.1999.1080p.BluRay.x264')).toBe(
			releaseDedupKey('The Matrix (1999) (1080p BluRay x264)')
		);
	});

	it('keeps genuinely different releases apart', () => {
		expect(releaseDedupKey('Show.S02E01.1080p')).not.toBe(releaseDedupKey('Show.S02E02.1080p'));
	});
});

describe('dedupeResults', () => {
	const result = (id: string, title: string, size = 0) => ({ id, title, size });

	it('keeps the earlier list on a collision, so the preferred indexer wins', () => {
		const merged = dedupeResults([
			[result('ds:a', 'The.Matrix.1999.1080p.BluRay.x264')],
			[result('ah:b', 'The Matrix (1999) (1080p BluRay x264)')],
		]);
		expect(merged.map((r) => r.id)).toEqual(['ds:a']);
	});

	// Measured against the live indexers: a season pack and one of its episodes
	// both reported 66.52 GB. Merging on size would have collapsed them into one
	// row and hidden the pack, so size must never take part in the key.
	it('does not merge a pack into an episode that happens to match on size', () => {
		const merged = dedupeResults([
			[result('ds:a', 'The.Last.of.Us.S02E01.Future.Days.2160p.UHD.BDRip', 66_520_000_000)],
			[result('ah:b', 'The.Last.of.Us.S02.2160p.UHD.BDRip', 66_520_000_000)],
		]);
		expect(merged).toHaveLength(2);
	});
});

describe('parseReleaseId', () => {
	it('routes a qualified id to its indexer', () => {
		withAlthub();
		expect(parseReleaseId('ah:abc')).toMatchObject({
			nativeId: 'abc',
			indexer: { prefix: 'ah', name: 'altHUB' },
		});
	});

	// Ids were bare before althub existed and are already stored that way in
	// transfer records and users' localStorage.
	it('reads a bare id as DrunkenSlug', () => {
		expect(parseReleaseId('abc123')).toMatchObject({
			nativeId: 'abc123',
			indexer: { prefix: 'ds' },
		});
	});

	it('returns null for an unconfigured indexer rather than guessing', () => {
		expect(parseReleaseId('ah:abc')).toBeNull();
	});
});

describe('fetchNzb across indexers', () => {
	it('downloads from the indexer named in the id, with that indexer key', async () => {
		withAlthub();
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '<nzb/>' });
		vi.stubGlobal('fetch', fetchMock);

		await fetchNzb('ah:059b7d');

		const url = new URL(fetchMock.mock.calls[0][0]);
		expect(url.origin + url.pathname).toBe('https://althub.test/api');
		expect(url.searchParams.get('id')).toBe('059b7d');
		expect(url.searchParams.get('apikey')).toBe('althub-key');
	});

	it('refuses an id whose indexer is not configured', async () => {
		await expect(fetchNzb('ah:059b7d')).rejects.toThrow('unknown indexer');
	});
});

describe('searchUsenet across indexers', () => {
	const body = (title: string, guid: string) => ({
		item: [{ title, guid, 'newznab:attr': [{ _name: 'size', _value: '10' }] }],
	});

	it('merges both indexers and tags each result with its source', async () => {
		withAlthub();
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => body('Only.On.DS.1080p', 'a'),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => body('Only.On.AH.1080p', 'b'),
				})
		);

		const results = await searchUsenet({ imdbId: 'tt1418646' });

		expect(results.map((r) => [r.id, r.indexer])).toEqual([
			['ds:a', 'DrunkenSlug'],
			['ah:b', 'altHUB'],
		]);
	});

	// One indexer being down must degrade coverage, not empty the section.
	it('returns the surviving indexer results when the other fails', async () => {
		withAlthub();
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockRejectedValueOnce(new Error('ECONNRESET'))
				.mockResolvedValueOnce({
					ok: true,
					json: async () => body('Only.On.AH.1080p', 'b'),
				})
		);

		const results = await searchUsenet({ imdbId: 'tt1418646' });
		expect(results.map((r) => r.id)).toEqual(['ah:b']);
	});

	it('asks every indexer for packs as well as episodes', async () => {
		withAlthub();
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: [] }) });
		vi.stubGlobal('fetch', fetchMock);

		await searchUsenet({ imdbId: 'tt0944947', seasonNum: 2, title: 'Show' });

		// 2 indexers x (1 episode query + 3 pack phrasings)
		expect(fetchMock).toHaveBeenCalledTimes(8);
	});
});

// altHUB reports failure in the body with HTTP 200 and ignores `o=json` while
// doing it: a bad key is `<error code="100">`, a dead release id `<error
// code="300">`. Status checks alone therefore pass an error document straight
// through — as an NZB, in fetchNzb's case, which the caller then posts to nzb2rd.
describe('newznab error envelopes returned with HTTP 200', () => {
	let errors: string[] = [];
	beforeEach(() => {
		errors = [];
		vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(' '));
		});
	});

	const BAD_KEY =
		'<?xml version="1.0" encoding="UTF-8"?>\n<error code="100" description="Incorrect user credentials"/>';
	const NO_ITEM =
		'<?xml version="1.0" encoding="UTF-8"?>\n<error code="300" description="No such item"/>';

	it('recognises the envelope and ignores ordinary bodies', () => {
		expect(newznabError(BAD_KEY)).toBe('Incorrect user credentials (code 100)');
		expect(newznabError(NO_ITEM)).toBe('No such item (code 300)');
		expect(newznabError('{"item":[]}')).toBeNull();
		expect(newznabError('<?xml version="1.0"?><nzb><file /></nzb>')).toBeNull();
	});

	it('refuses to hand an error document back as an NZB', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => NO_ITEM }));
		await expect(fetchNzb('ds:gone')).rejects.toThrow('No such item');
	});

	// The XML arrives where JSON was asked for, so the parse is what fails. The
	// message has to point at the key rather than at "unexpected token <".
	it('blames the api key when the search body is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => {
					throw new SyntaxError("Unexpected token '<'");
				},
			})
		);
		await expect(searchUsenet({ imdbId: 'tt1418646' })).rejects.toThrow(
			'no indexer could be reached'
		);
		expect(errors.some((line) => /check its API key/.test(line))).toBe(true);
	});

	it('still parses a healthy JSON body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					channel: {
						item: [
							{
								title: 'A',
								guid: 'x',
								attr: [{ '@attributes': { name: 'size', value: '5' } }],
							},
						],
					},
				}),
			})
		);
		const results = await searchUsenet({ imdbId: 'tt1418646' });
		expect(results).toEqual([{ id: 'ds:x', title: 'A', size: 5, indexer: 'DrunkenSlug' }]);
	});
});

// --- serving one named indexer ------------------------------------------
//
// The media pages ask every configured indexer and merge; a request that names
// its indexer must not do that. These two are what let a caller hold an
// `Indexer` and a native id and stay on that server for both halves of the
// round trip.

describe('fetchNzbFrom', () => {
	const indexer = {
		prefix: 'ah',
		name: 'altHUB',
		url: 'https://althub.test/api',
		apiKey: 'althub-key',
	};

	it('asks the indexer it was handed, with that indexer key and a native id', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '<nzb/>' });
		vi.stubGlobal('fetch', fetchMock);

		await expect(fetchNzbFrom(indexer, '059b7d')).resolves.toBe('<nzb/>');

		const url = new URL(fetchMock.mock.calls[0][0]);
		expect(url.origin + url.pathname).toBe('https://althub.test/api');
		expect(url.searchParams.get('t')).toBe('get');
		expect(url.searchParams.get('id')).toBe('059b7d');
		expect(url.searchParams.get('apikey')).toBe('althub-key');
	});

	// The whole reason it takes an Indexer rather than a qualified id: an indexer
	// this deployment does not have in `getIndexers()` is still servable when the
	// caller supplies it.
	it('serves an indexer that getIndexers does not list', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '<nzb/>' });
		vi.stubGlobal('fetch', fetchMock);

		expect(getIndexers().map((i) => i.prefix)).not.toContain('ah');
		await expect(fetchNzbFrom(indexer, '059b7d')).resolves.toBe('<nzb/>');
	});

	// Same checks fetchNzb has always run, in the one place both now share.
	it('keeps the status and error-envelope checks', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
		await expect(fetchNzbFrom(indexer, 'x')).rejects.toThrow('404');

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				text: async () => '<error code="300" description="No such item"/>',
			})
		);
		await expect(fetchNzbFrom(indexer, 'x')).rejects.toThrow(
			'altHUB refused the NZB: No such item'
		);
	});
});

describe('fetchNzb delegating to fetchNzbFrom', () => {
	it('resolves the prefix and downloads from the indexer it names', async () => {
		withAlthub();
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '<nzb/>' });
		vi.stubGlobal('fetch', fetchMock);

		await fetchNzb('ah:059b7d');
		const althubUrl = new URL(fetchMock.mock.calls[0][0]);
		expect(althubUrl.origin + althubUrl.pathname).toBe('https://althub.test/api');
		expect(althubUrl.searchParams.get('apikey')).toBe('althub-key');

		await fetchNzb('abc123'); // bare, so DrunkenSlug
		const dsUrl = new URL(fetchMock.mock.calls[1][0]);
		expect(dsUrl.origin + dsUrl.pathname).toBe('https://indexer.test/api');
		expect(dsUrl.searchParams.get('id')).toBe('abc123');
		expect(dsUrl.searchParams.get('apikey')).toBe('secret-key');
	});
});

describe('fanOut with an explicit indexer list', () => {
	const body = (guid: string) => ({
		item: [{ title: `Title ${guid}`, guid, 'newznab:attr': [{ _name: 'size', _value: '10' }] }],
	});

	// A request that names its indexer must not spend a grab on the others, nor
	// answer from one it was not asked for.
	it('queries only the indexers it is given', async () => {
		withAlthub();
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body('b') });
		vi.stubGlobal('fetch', fetchMock);

		const only = getIndexers().filter((indexer) => indexer.prefix === 'ah');
		const { ok, lists } = await fanOut((indexer) => `${indexer.url}?q=x`, 'test', only);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(new URL(fetchMock.mock.calls[0][0]).origin).toBe('https://althub.test');
		expect(ok).toBe(true);
		expect(lists.flat().map((r) => [r.id, r.indexer])).toEqual([['ah:b', 'altHUB']]);
	});

	it('still asks every configured indexer when no list is given', async () => {
		withAlthub();
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body('b') });
		vi.stubGlobal('fetch', fetchMock);

		await fanOut((indexer) => `${indexer.url}?q=x`, 'test');

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	// `ok` is what tells an outage apart from a genuine no-results, so an empty
	// list must not read as "every indexer answered".
	it('reports not-ok for an empty list rather than claiming success', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const { ok, lists } = await fanOut((indexer) => `${indexer.url}?q=x`, 'test', []);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(ok).toBe(false);
		expect(lists).toEqual([]);
	});
});

// --- pubDate and category ------------------------------------------------
//
// Both fixtures below are trimmed from live 2026-09-03 responses to the same
// movie search (`t=movie&imdbid=1418646`) on each indexer. The finding that
// mattered: `pubDate` is a plain item-level string in both dialects — the
// @attributes/underscore split only ever touches attrs and the enclosure — and
// `category` repeats, which is why it is collected as a list.

describe('parseNewznabItem capturing pubDate and category', () => {
	const DRUNKENSLUG_ITEM = {
		title: 'Beneath.Hill.60.2010.1080p.BluRay.x264-nikt0',
		guid: {
			_isPermaLink: 'true',
			text: 'https://drunkenslug.com/details/dcfa8ce0e7f355442d63bff0dde1e5c066045185',
		},
		pubDate: 'Mon, 17 Nov 2025 22:08:02 +0000',
		category: 'Movies > HD',
		'newznab:attr': [
			{ _name: 'category', _value: '2040' },
			{ _name: 'size', _value: '6459339787' },
			{ _name: 'grabs', _value: '37' },
		],
	};

	const ALTHUB_ITEM = {
		title: 'Beneath.Hill.60.2010.BluRay.Remux.1080p.AVC.DTS-HD.MA-5.1-ZQ',
		guid: 'https://api.althub.co.za/details/17de128214448f2bdbd7e79ea33e649f',
		pubDate: 'Fri, 06 Oct 2023 20:42:41 +0000',
		category: 'Movies > HD',
		attr: [
			{ '@attributes': { name: 'category', value: '2000' } },
			{ '@attributes': { name: 'category', value: '2040' } },
			{ '@attributes': { name: 'size', value: '22170715450' } },
		],
	};

	it('reads the nZEDb flat item', () => {
		expect(parseNewznabItem(DRUNKENSLUG_ITEM)).toEqual({
			id: 'dcfa8ce0e7f355442d63bff0dde1e5c066045185',
			title: 'Beneath.Hill.60.2010.1080p.BluRay.x264-nikt0',
			size: 6459339787,
			pubDate: 'Mon, 17 Nov 2025 22:08:02 +0000',
			category: ['2040'],
		});
	});

	it('reads the altHUB @attributes item, keeping every category it sends', () => {
		expect(parseNewznabItem(ALTHUB_ITEM)).toEqual({
			id: '17de128214448f2bdbd7e79ea33e649f',
			title: 'Beneath.Hill.60.2010.BluRay.Remux.1080p.AVC.DTS-HD.MA-5.1-ZQ',
			size: 22170715450,
			pubDate: 'Fri, 06 Oct 2023 20:42:41 +0000',
			// Parent and child both, which `attrValue` would have cut to one.
			category: ['2000', '2040'],
		});
	});

	// The ids are what a Newznab client filters on; the `<category>` element is
	// prose for a human and differs between indexers for the same release.
	it('takes the category ids, not the human category element', () => {
		expect(parseNewznabItem(DRUNKENSLUG_ITEM)?.category).not.toContain('Movies > HD');
	});

	// These rows are cached as JSON per title, so an absent field must stay absent
	// rather than becoming an empty one on every row.
	it('leaves both fields off entirely when the indexer sent neither', () => {
		const parsed = parseNewznabItem({
			title: 'A',
			guid: 'x',
			'newznab:attr': [{ _name: 'size', _value: '10' }],
		});
		expect(parsed).toEqual({ id: 'x', title: 'A', size: 10 });
		expect(Object.keys(parsed as object)).toEqual(['id', 'title', 'size']);
	});

	it('ignores a non-string pubDate rather than stringifying it', () => {
		const parsed = parseNewznabItem({ title: 'A', guid: 'x', pubDate: { text: 'nope' } });
		expect(Object.keys(parsed as object)).not.toContain('pubDate');
	});

	it('carries both fields through the response parser, in either dialect', () => {
		const [fromDs] = parseNewznabResponse({ item: [DRUNKENSLUG_ITEM] });
		expect([fromDs.pubDate, fromDs.category]).toEqual([
			'Mon, 17 Nov 2025 22:08:02 +0000',
			['2040'],
		]);

		// altHUB keeps the channel wrapper DrunkenSlug drops.
		const [fromAh] = parseNewznabResponse({ channel: { item: [ALTHUB_ITEM] } });
		expect([fromAh.pubDate, fromAh.category]).toEqual([
			'Fri, 06 Oct 2023 20:42:41 +0000',
			['2000', '2040'],
		]);
	});

	// The whitelist is what keeps the api key out of the browser, and these two
	// fields are additions to it — not a door to passing the raw item through.
	it('still exposes nothing else, api key included', async () => {
		const leaky = 'https://indexer.test/getnzb/x.nzb&i=1&r=secret-key';
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ item: [{ ...DRUNKENSLUG_ITEM, link: leaky }] }),
			})
		);

		const results = await searchUsenet({ imdbId: 'tt1418646' });

		expect(Object.keys(results[0]).sort()).toEqual([
			'category',
			'id',
			'indexer',
			'pubDate',
			'size',
			'title',
		]);
		expect(JSON.stringify(results)).not.toContain('secret-key');
	});
});
