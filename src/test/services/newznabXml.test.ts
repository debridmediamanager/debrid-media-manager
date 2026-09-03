import {
	capsXml,
	escapeXml,
	newznabErrorXml,
	NewznabRssItem,
	searchRssXml,
} from '@/services/newznab/xml';
import { beforeEach, describe, expect, it } from 'vitest';

const NEWZNAB_NS = 'http://www.newznab.com/DTD/2010/feeds/attributes/';

/** Parses and asserts well-formedness, so a broken document fails loudly. */
function parseXml(xml: string): Document {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
	return doc;
}

function item(overrides: Partial<NewznabRssItem> = {}): NewznabRssItem {
	return {
		title: 'Some.Release.2024.1080p',
		guid: 'opaque-token',
		enclosureUrl: 'https://debridmediamanager.com/api/newznab/nzb?id=opaque-token',
		...overrides,
	};
}

describe('escapeXml', () => {
	it('escapes the five XML entities', () => {
		expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
	});

	it('drops control characters XML has no escape for', () => {
		expect(escapeXml('a\u0000b\u0008c\u001Fd')).toBe('abcd');
	});

	it('keeps tab, newline and carriage return', () => {
		expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
	});
});

describe('newznabErrorXml', () => {
	it('emits a well-formed error document with the code and description', () => {
		const doc = parseXml(newznabErrorXml(910, 'API disabled'));
		const error = doc.documentElement;
		expect(error.tagName).toBe('error');
		expect(error.getAttribute('code')).toBe('910');
		expect(error.getAttribute('description')).toBe('API disabled');
	});

	it('escapes a description carrying quotes and angle brackets', () => {
		const xml = newznabErrorXml(200, `Missing parameter "q" & <t>`);
		expect(xml).toContain('&quot;q&quot; &amp; &lt;t&gt;');
		expect(parseXml(xml).documentElement.getAttribute('description')).toBe(
			'Missing parameter "q" & <t>'
		);
	});

	it('starts with the XML declaration', () => {
		expect(newznabErrorXml(100, 'Incorrect user credentials')).toMatch(
			/^<\?xml version="1\.0" encoding="UTF-8"\?>\n/
		);
	});
});

describe('capsXml', () => {
	let doc: Document;

	beforeEach(() => {
		doc = parseXml(capsXml());
	});

	it('advertises the server title and paging limits', () => {
		expect(doc.querySelector('server')?.getAttribute('title')).toBe('DMM');
		expect(doc.querySelector('limits')?.getAttribute('max')).toBe('100');
		expect(doc.querySelector('limits')?.getAttribute('default')).toBe('100');
	});

	it('advertises the supported search params', () => {
		const search = doc.querySelector('searching > search');
		expect(search?.getAttribute('available')).toBe('yes');
		expect(search?.getAttribute('supportedParams')).toBe('q');

		const tv = doc.querySelector('searching > tv-search');
		expect(tv?.getAttribute('available')).toBe('yes');
		expect(tv?.getAttribute('supportedParams')).toBe('q,tvdbid,imdbid,season,ep');

		const movie = doc.querySelector('searching > movie-search');
		expect(movie?.getAttribute('available')).toBe('yes');
		expect(movie?.getAttribute('supportedParams')).toBe('q,imdbid');
	});

	it('advertises the movie and TV categories with their subcategories', () => {
		const categories = Array.from(doc.querySelectorAll('categories > category')).map(
			(category) => ({
				id: category.getAttribute('id'),
				name: category.getAttribute('name'),
				subcats: Array.from(category.querySelectorAll('subcat')).map((subcat) => [
					subcat.getAttribute('id'),
					subcat.getAttribute('name'),
				]),
			})
		);

		expect(categories).toEqual([
			{
				id: '2000',
				name: 'Movies',
				subcats: [
					['2040', 'Movies/HD'],
					['2045', 'Movies/UHD'],
				],
			},
			{
				id: '5000',
				name: 'TV',
				subcats: [
					['5030', 'TV/SD'],
					['5040', 'TV/HD'],
					['5045', 'TV/UHD'],
					['5070', 'TV/Anime'],
				],
			},
		]);
	});
});

describe('searchRssXml', () => {
	it('declares the newznab namespace and the response offset and total', () => {
		const xml = searchRssXml([item()], 20, 137);
		expect(xml).toContain(`xmlns:newznab="${NEWZNAB_NS}"`);

		const doc = parseXml(xml);
		const response = doc.getElementsByTagNameNS(NEWZNAB_NS, 'response')[0];
		expect(response.getAttribute('offset')).toBe('20');
		expect(response.getAttribute('total')).toBe('137');
		// The response element belongs to the channel, not to an item.
		expect(response.parentElement?.tagName).toBe('channel');
	});

	it('writes the title, guid and enclosure of each item', () => {
		const doc = parseXml(
			searchRssXml(
				[
					item({
						title: 'One',
						guid: 'g1',
						enclosureUrl: 'https://dmm/nzb?id=g1',
						size: 42,
					}),
					item({ title: 'Two', guid: 'g2', enclosureUrl: 'https://dmm/nzb?id=g2' }),
				],
				0,
				2
			)
		);

		const items = Array.from(doc.querySelectorAll('item'));
		expect(items).toHaveLength(2);

		expect(items[0].querySelector('title')?.textContent).toBe('One');
		const guid = items[0].querySelector('guid');
		expect(guid?.textContent).toBe('g1');
		expect(guid?.getAttribute('isPermaLink')).toBe('false');

		const enclosure = items[0].querySelector('enclosure');
		expect(enclosure?.getAttribute('url')).toBe('https://dmm/nzb?id=g1');
		expect(enclosure?.getAttribute('length')).toBe('42');
		expect(enclosure?.getAttribute('type')).toBe('application/x-nzb');
	});

	it('escapes titles and enclosure URLs', () => {
		const xml = searchRssXml(
			[
				item({
					title: 'Tom & Jerry <2024> "REMUX"',
					enclosureUrl: 'https://dmm/nzb?id=a&apikey=b',
				}),
			],
			0,
			1
		);
		expect(xml).toContain('Tom &amp; Jerry &lt;2024&gt; &quot;REMUX&quot;');
		expect(xml).toContain('id=a&amp;apikey=b');

		const doc = parseXml(xml);
		expect(doc.querySelector('item > title')?.textContent).toBe('Tom & Jerry <2024> "REMUX"');
		expect(doc.querySelector('enclosure')?.getAttribute('url')).toBe(
			'https://dmm/nzb?id=a&apikey=b'
		);
	});

	it('emits pubDate only when the item carries one', () => {
		const withDate = parseXml(
			searchRssXml([item({ pubDate: 'Mon, 01 Sep 2026 12:00:00 +0000' })], 0, 1)
		);
		expect(withDate.querySelector('item > pubDate')?.textContent).toBe(
			'Mon, 01 Sep 2026 12:00:00 +0000'
		);

		const withoutDate = parseXml(searchRssXml([item()], 0, 1));
		expect(withoutDate.querySelector('item > pubDate')).toBeNull();
	});

	it('emits a size attr, defaulting to 0 when the size is unknown', () => {
		const doc = parseXml(searchRssXml([item({ size: 1234 }), item()], 0, 2));
		const items = Array.from(doc.querySelectorAll('item'));

		const sizeOf = (element: Element) =>
			Array.from(element.getElementsByTagNameNS(NEWZNAB_NS, 'attr'))
				.filter((attr) => attr.getAttribute('name') === 'size')
				.map((attr) => attr.getAttribute('value'));

		expect(sizeOf(items[0])).toEqual(['1234']);
		expect(sizeOf(items[1])).toEqual(['0']);
		expect(items[1].querySelector('enclosure')?.getAttribute('length')).toBe('0');
	});

	it('emits one category attr per category', () => {
		const doc = parseXml(searchRssXml([item({ category: ['5000', '5040'] })], 0, 1));
		const categories = Array.from(doc.getElementsByTagNameNS(NEWZNAB_NS, 'attr'))
			.filter((attr) => attr.getAttribute('name') === 'category')
			.map((attr) => attr.getAttribute('value'));

		expect(categories).toEqual(['5000', '5040']);
	});

	it('carries nothing that could name an upstream indexer', () => {
		const xml = searchRssXml([item({ size: 1, category: ['2040'], pubDate: 'now' })], 0, 1);
		expect(xml).not.toContain('<comments>');
		expect(xml).not.toContain('<link>');
		expect(xml).not.toContain('name="grabs"');
		expect(xml).not.toContain('name="group"');
		expect(xml).not.toContain('name="poster"');
	});

	it('is well-formed with no items', () => {
		const doc = parseXml(searchRssXml([], 0, 0));
		expect(doc.querySelectorAll('item')).toHaveLength(0);
		expect(doc.getElementsByTagNameNS(NEWZNAB_NS, 'response')[0].getAttribute('total')).toBe(
			'0'
		);
	});
});
