// The documents the Torznab endpoint serves.
//
// Torznab is Newznab's schema with a torrent namespace bolted on, so the error
// document and the escaper are literally the Newznab ones — imported rather than
// copied, because `escapeXml` also strips the C0 control characters that make a
// whole feed unparseable, and two copies of that rule would eventually disagree.
//
// What differs is the item: a torrent has no NZB to enclose, so the download is
// a magnet URI and the swarm figures live in `torznab:attr` elements.

import { escapeXml, newznabErrorXml } from '../newznab/xml';

/** Torznab's error document is Newznab's, protocol codes included. */
export const torznabErrorXml = newznabErrorXml;

/**
 * Matches `capsXml`'s `<limits max=…>`, which is what a client pages against.
 *
 * Ten rather than a full hundred: a page is cut out of the whole matching set,
 * which for a popular title runs to the better part of a thousand releases, and
 * a client that only ever reads page one was being handed ten times what it
 * would look at. What a client cannot see on one page it reaches with `offset`
 * — `total` still reports the whole set.
 */
export const MAX_LIMIT = 10;

/**
 * The static capabilities document.
 *
 * Only the categories DMM actually emits are advertised. A client filters on
 * this list before it ever issues a search, so advertising a category nothing is
 * ever labelled with buys empty searches — which is why there is no 5070/Anime
 * entry here even though the Newznab endpoint has one: the torrent library
 * carries no anime flag to label a release with.
 *
 * `available="no"` rows are spelled out rather than omitted; some clients only
 * detect a capability as absent when the element says so.
 */
export function capsXml(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
	<server title="DMM"/>
	<limits max="${MAX_LIMIT}" default="${MAX_LIMIT}"/>
	<searching>
		<search available="yes" supportedParams="q,imdbid"/>
		<tv-search available="yes" supportedParams="q,imdbid,tvdbid,season,ep"/>
		<movie-search available="yes" supportedParams="q,imdbid"/>
		<audio-search available="no" supportedParams=""/>
		<book-search available="no" supportedParams=""/>
	</searching>
	<categories>
		<category id="2000" name="Movies">
			<subcat id="2030" name="Movies/SD"/>
			<subcat id="2040" name="Movies/HD"/>
			<subcat id="2045" name="Movies/UHD"/>
		</category>
		<category id="5000" name="TV">
			<subcat id="5030" name="TV/SD"/>
			<subcat id="5040" name="TV/HD"/>
			<subcat id="5045" name="TV/UHD"/>
		</category>
	</categories>
</caps>`;
}

/**
 * One row of a search response.
 *
 * `pubDate` is required rather than optional: an RSS parser refuses a feed whose
 * items carry no date — Sonarr throws `UnsupportedFeedException` and reports the
 * indexer as broken — so a caller has to decide what the date of a release with
 * no recorded posting date is, and cannot decide to omit it.
 */
export interface TorznabRssItem {
	title: string;
	/** The infohash. Stable forever, which is what a guid has to be. */
	infoHash: string;
	magnetUrl: string;
	/** RFC 822/1123, as RSS requires. */
	pubDate: string;
	/** Bytes. */
	size: number;
	categories: number[];
	seeders: number;
	/** Seeders plus leechers — a client derives leechers by subtracting. */
	peers: number;
}

function attr(name: string, value: string | number): string {
	return `\t\t\t<torznab:attr name="${name}" value="${escapeXml(String(value))}"/>`;
}

function itemXml(item: TorznabRssItem): string {
	const magnet = escapeXml(item.magnetUrl);
	const lines = [
		'\t\t<item>',
		`\t\t\t<title>${escapeXml(item.title)}</title>`,
		// isPermaLink="false" because the guid is an infohash, not a URL. A client
		// that took it as a permalink would try to fetch it.
		`\t\t\t<guid isPermaLink="false">${escapeXml(item.infoHash)}</guid>`,
		`\t\t\t<pubDate>${escapeXml(item.pubDate)}</pubDate>`,
		`\t\t\t<size>${item.size}</size>`,
		// The magnet is both `link` and `enclosure`: clients disagree about which
		// one carries the download, and Sonarr hands a `magnet:` download URL
		// straight to the torrent client instead of trying to fetch it first.
		`\t\t\t<link>${magnet}</link>`,
	];
	for (const category of item.categories) {
		lines.push(`\t\t\t<category>${category}</category>`);
	}
	lines.push(
		`\t\t\t<enclosure url="${magnet}" length="${item.size}" type="application/x-bittorrent"/>`
	);
	for (const category of item.categories) {
		lines.push(attr('category', category));
	}
	lines.push(
		attr('size', item.size),
		attr('seeders', item.seeders),
		attr('peers', item.peers),
		attr('infohash', item.infoHash),
		attr('magneturl', item.magnetUrl),
		// Nothing here is metered: the grab is resolved against the client's own
		// debrid account, so there is no ratio to keep and no download to pay for.
		attr('downloadvolumefactor', 0),
		attr('uploadvolumefactor', 1)
	);
	lines.push('\t\t</item>');
	return lines.join('\n');
}

/**
 * The search response.
 *
 * `offset` and `total` drive a client's paging: `total` is the size of the whole
 * matching set, not of this page, and a client that sees
 * `offset + items.length < total` asks for the next one.
 */
export function searchRssXml(items: TorznabRssItem[], offset: number, total: number): string {
	const body = items.map(itemXml).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">
	<channel>
		<title>DMM</title>
		<torznab:response offset="${Math.trunc(offset)}" total="${Math.trunc(total)}"/>
${body}${body ? '\n' : ''}	</channel>
</rss>`;
}
