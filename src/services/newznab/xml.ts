// The three XML documents the Newznab aggregation endpoint serves.
//
// Written by hand: the app has no XML serializer and these documents are small
// and fixed-shape, so a dependency would buy nothing. Everything that reaches a
// document goes through `escapeXml` — release titles come from upstream
// indexers and routinely carry `&` and quotes, and one unescaped ampersand
// makes the whole feed unparseable to an *arr, which reads the sync as an
// indexer failure rather than as an empty result.

/**
 * XML 1.0 forbids most C0 control characters outright — no escape exists for
 * them, so they have to be dropped rather than encoded. Upstream titles have
 * carried them; a single one poisons the entire response.
 */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;',
};

/** Escapes text or attribute content. Safe for both — `"` and `'` included. */
export function escapeXml(value: string): string {
	return String(value)
		.replace(INVALID_XML_CHARS, '')
		.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/**
 * A Newznab error document. The code is the protocol's own: 100 bad
 * credentials, 101 no such account, 200 missing parameter, 202 no such
 * function, 300 no such item, 500 request limit reached, 910 API disabled.
 *
 * Served with HTTP 200 unless the caller says otherwise — Newznab clients read
 * the document, and several treat a non-200 as an unreachable indexer without
 * ever looking at the reason.
 */
export function newznabErrorXml(code: number, description: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<error code="${escapeXml(String(code))}" description="${escapeXml(description)}"/>`;
}

/**
 * The static capabilities document.
 *
 * `limits max` is what a client uses to size its paging, so it has to match
 * what the search handler actually caps a request at. The categories advertised
 * here are the ones DMM maps upstream results onto; a client filters on them
 * before it ever issues a search, so an unlisted category is invisible.
 *
 * `available="no"` entries are spelled out rather than omitted: some clients
 * only detect a capability as absent when the element says so.
 */
export function capsXml(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
	<server title="DMM"/>
	<limits max="100" default="100"/>
	<searching>
		<search available="yes" supportedParams="q"/>
		<tv-search available="yes" supportedParams="q,tvdbid,imdbid,season,ep"/>
		<movie-search available="yes" supportedParams="q,imdbid"/>
		<audio-search available="no" supportedParams=""/>
		<book-search available="no" supportedParams=""/>
	</searching>
	<categories>
		<category id="2000" name="Movies">
			<subcat id="2040" name="Movies/HD"/>
			<subcat id="2045" name="Movies/UHD"/>
		</category>
		<category id="5000" name="TV">
			<subcat id="5030" name="TV/SD"/>
			<subcat id="5040" name="TV/HD"/>
			<subcat id="5045" name="TV/UHD"/>
			<subcat id="5070" name="TV/Anime"/>
		</category>
	</categories>
</caps>`;
}

/**
 * One row of a search response.
 *
 * The field set is deliberately tiny. Everything a real indexer also emits —
 * comments links, grab and view counts, poster, group, the upstream's own
 * `<link>` — either names the upstream indexer outright or narrows it down, so
 * none of it is carried and none of it may be added.
 */
export interface NewznabRssItem {
	title: string;
	/** The opaque release id from `opaqueId.ts`. Stable across syncs. */
	guid: string;
	/** RFC 822, as RSS requires. Omitted entirely when upstream gave no date. */
	pubDate?: string;
	/** Bytes. 0 when the indexer reported no size, matching `UsenetResult`. */
	size?: number;
	category?: string[];
	/** Absolute URL of this app's own NZB grab route. */
	enclosureUrl: string;
}

function itemXml(item: NewznabRssItem): string {
	const size = item.size ?? 0;
	const lines = [
		'\t\t<item>',
		`\t\t\t<title>${escapeXml(item.title)}</title>`,
		// isPermaLink="false" because the guid is an opaque token, not a URL. A
		// client that took it as a permalink would fetch it as one.
		`\t\t\t<guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
	];
	if (item.pubDate) {
		lines.push(`\t\t\t<pubDate>${escapeXml(item.pubDate)}</pubDate>`);
	}
	lines.push(
		`\t\t\t<enclosure url="${escapeXml(item.enclosureUrl)}" length="${size}" type="application/x-nzb"/>`,
		`\t\t\t<newznab:attr name="size" value="${size}"/>`
	);
	for (const category of item.category ?? []) {
		lines.push(`\t\t\t<newznab:attr name="category" value="${escapeXml(category)}"/>`);
	}
	lines.push('\t\t</item>');
	return lines.join('\n');
}

/**
 * The search response.
 *
 * `offset` and `total` drive a client's paging: `total` is the full result
 * count across every upstream, not the length of `items`, and a client that
 * sees `offset + items.length < total` will ask for the next page.
 */
export function searchRssXml(items: NewznabRssItem[], offset: number, total: number): string {
	const body = items.map(itemXml).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
	<channel>
		<title>DMM</title>
		<newznab:response offset="${Math.trunc(offset)}" total="${Math.trunc(total)}"/>
${body}${body ? '\n' : ''}	</channel>
</rss>`;
}
