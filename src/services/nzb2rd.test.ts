import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildPackQueries,
	buildSearchUrl,
	buildTextSearchUrl,
	fetchNzb,
	isSeasonPack,
	isValidImdbId,
	looksLikeEpisode,
	parseNewznabItem,
	parseNewznabResponse,
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

		expect(results).toEqual([{ id: 'abc123', title: 'A', size: 10 }]);
		expect(JSON.stringify(results)).not.toContain('secret-key');
	});

	it('throws when the indexer errors', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
		await expect(searchUsenet({ imdbId: 'tt1418646' })).rejects.toThrow('429');
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

		expect(packs.map((p) => p.id).sort()).toEqual(['a', 'b']); // 'a' deduped, episode dropped
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

		expect(results.map((r) => r.id)).toEqual(['pack1', 'ep1']);
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
});
