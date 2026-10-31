import { idsOfSearch, postsById } from '@/services/newznab/search';
import { parseNewznabResponse } from '@/services/nzb2rd';
import althubMovie from '@/test/fixtures/newznab-fresh/althub-movie-2026-10-31.json';
import drunkenslugMovie from '@/test/fixtures/newznab-fresh/drunkenslug-movie-2026-10-31.json';
import { describe, expect, it } from 'vitest';

// The newest film posts DrunkenSlug and altHUB answered DMM's account with on
// 2026-10-31 (t=movie&cat=2000&o=json&extended=1, first 30 of 100, keys and
// user ids redacted): the two JSON dialects DMM reads.
describe('the IMDb ids new film posts name', () => {
	it('reads them out of both dialects, as plain numbers', () => {
		const ds = parseNewznabResponse(drunkenslugMovie);
		const ah = parseNewznabResponse(althubMovie);
		expect(ds).toHaveLength(30);
		expect(ds.filter((r) => r.imdb)).toHaveLength(26);
		// altHUB says `imdb` 0 for the two posts it has no film for: no id.
		expect(ah.filter((r) => r.imdb)).toHaveLength(28);
		for (const r of [...ds, ...ah].filter((r) => r.imdb)) expect(r.imdb).toMatch(/^[1-9]\d*$/);
	});

	it('keeps the newest post of each film', () => {
		const results = parseNewznabResponse(drunkenslugMovie);
		const posts = postsById(results);
		expect(posts.size).toBeGreaterThan(10);
		for (const [id, at] of posts) {
			const named = results.filter((r) => `imdb:${r.imdb}` === id);
			expect(at.getTime()).toBe(Math.max(...named.map((r) => Date.parse(r.pubDate!))));
		}
	});
});

describe('idsOfSearch', () => {
	it('names the film a movie search asks for by IMDb id', () => {
		expect(idsOfSearch('movie:cat=2000,2010&imdbid=0133093')).toEqual(['imdb:133093']);
	});

	// altHUB and NzbLife name no TheTVDB id on their TV posts (2026-10-31), so a
	// show's answer cannot be kept by them.
	it('names nothing for a show, a title search or a feed', () => {
		expect(idsOfSearch('tvsearch:cat=5000&tvdbid=81189')).toEqual([]);
		expect(idsOfSearch('tvsearch:cat=5000&imdbid=0903747')).toEqual([]);
		expect(idsOfSearch('search:cat=2000&q=mallari')).toEqual([]);
		expect(idsOfSearch('movie:cat=2000')).toEqual([]);
	});
});
