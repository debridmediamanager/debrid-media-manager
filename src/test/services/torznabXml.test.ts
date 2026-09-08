import { capsXml, searchRssXml, torznabErrorXml, TorznabRssItem } from '@/services/torznab/xml';
import { describe, expect, it } from 'vitest';

const HASH = 'a'.repeat(40);

function item(overrides: Partial<TorznabRssItem> = {}): TorznabRssItem {
	return {
		title: 'Some.Release.1080p.WEB',
		infoHash: HASH,
		magnetUrl: `magnet:?xt=urn:btih:${HASH}&dn=Some.Release.1080p.WEB`,
		pubDate: 'Mon, 17 Nov 2025 22:08:02 GMT',
		size: 1234567,
		categories: [2000, 2040],
		seeders: 100,
		peers: 100,
		...overrides,
	};
}

describe('capsXml', () => {
	it('advertises only the categories the feed actually emits', () => {
		const xml = capsXml();
		for (const id of [2000, 2030, 2040, 2045, 5000, 5030, 5040, 5045]) {
			expect(xml).toContain(`id="${id}"`);
		}
		// Nothing in the torrent library carries an anime flag to label with, so
		// advertising 5070 would only buy empty searches.
		expect(xml).not.toContain('5070');
	});

	it('advertises the id parameters an *arr searches by', () => {
		const xml = capsXml();
		expect(xml).toContain(
			'<tv-search available="yes" supportedParams="q,imdbid,tvdbid,season,ep"/>'
		);
		expect(xml).toContain('<movie-search available="yes" supportedParams="q,imdbid"/>');
	});

	it('states the paging limit the search handler enforces', () => {
		expect(capsXml()).toContain('<limits max="10" default="10"/>');
	});
});

describe('searchRssXml', () => {
	it('declares the torznab namespace', () => {
		expect(searchRssXml([], 0, 0)).toContain(
			'xmlns:torznab="http://torznab.com/schemas/2015/feed"'
		);
	});

	it('reports the size of the whole set, not of the page', () => {
		const xml = searchRssXml([item()], 40, 512);
		expect(xml).toContain('<torznab:response offset="40" total="512"/>');
	});

	it('carries the magnet as link, enclosure and attribute', () => {
		const xml = searchRssXml([item()], 0, 1);
		// Clients disagree about which field is the download; all three are the
		// same magnet so none of them has to be the right guess.
		expect(xml).toContain(
			`<link>magnet:?xt=urn:btih:${HASH}&amp;dn=Some.Release.1080p.WEB</link>`
		);
		expect(xml).toContain(
			`<enclosure url="magnet:?xt=urn:btih:${HASH}&amp;dn=Some.Release.1080p.WEB" length="1234567" type="application/x-bittorrent"/>`
		);
		expect(xml).toContain('<torznab:attr name="magneturl" value="magnet:?xt=urn:btih:');
	});

	it('escapes the ampersand in a magnet URI everywhere it appears', () => {
		// One raw `&` makes the whole feed unparseable, which an *arr reads as a
		// dead indexer rather than as an empty result.
		const xml = searchRssXml([item()], 0, 1);
		expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
	});

	it('escapes a release title that carries markup characters', () => {
		const xml = searchRssXml([item({ title: 'A & B <CHECKMATE> "x"' })], 0, 1);
		expect(xml).toContain('<title>A &amp; B &lt;CHECKMATE&gt; &quot;x&quot;</title>');
	});

	it('emits the infohash as a non-permalink guid', () => {
		expect(searchRssXml([item()], 0, 1)).toContain(`<guid isPermaLink="false">${HASH}</guid>`);
	});

	it('emits every category both as an element and as an attribute', () => {
		const xml = searchRssXml([item()], 0, 1);
		expect(xml).toContain('<category>2000</category>');
		expect(xml).toContain('<category>2040</category>');
		expect(xml).toContain('<torznab:attr name="category" value="2000"/>');
		expect(xml).toContain('<torznab:attr name="category" value="2040"/>');
	});

	it('carries the swarm figures and marks the grab unmetered', () => {
		const xml = searchRssXml([item({ seeders: 100, peers: 137 })], 0, 1);
		expect(xml).toContain('<torznab:attr name="seeders" value="100"/>');
		expect(xml).toContain('<torznab:attr name="peers" value="137"/>');
		expect(xml).toContain('<torznab:attr name="downloadvolumefactor" value="0"/>');
		expect(xml).toContain('<torznab:attr name="uploadvolumefactor" value="1"/>');
	});

	it('always carries a pubDate, which an RSS parser refuses a feed without', () => {
		expect(searchRssXml([item()], 0, 1)).toContain(
			'<pubDate>Mon, 17 Nov 2025 22:08:02 GMT</pubDate>'
		);
	});

	it('serves an empty result as a well-formed empty channel', () => {
		const xml = searchRssXml([], 0, 0);
		expect(xml).toContain('<torznab:response offset="0" total="0"/>');
		expect(xml).not.toContain('<item>');
		expect(xml.trimEnd().endsWith('</rss>')).toBe(true);
	});
});

describe('torznabErrorXml', () => {
	it('is the Newznab error document, codes included', () => {
		expect(torznabErrorXml(100, 'Incorrect user credentials')).toContain(
			'<error code="100" description="Incorrect user credentials"/>'
		);
	});
});
