import { describe, expect, it } from 'vitest';
import {
	FALLBACK_GROUP,
	NzbSanitizeError,
	quoteFilenameInSubject,
	sanitizeNzb,
} from './nzbSanitize';

/**
 * Shaped on a real DrunkenSlug grab (2026-09-01): the `<meta type="tag">` is
 * that indexer's per-download token, and it is the reason this module exists.
 */
const DRUNKENSLUG = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
	<head>
		<meta type="tag">0a624180.27889905291</meta>
	</head>
	<file poster="JWPKEi710Ds54]zHiBQVAZBIyI@9WtdHEzo.2h0" date="1788097954" subject="[1/2] - &quot;My.File.par2&quot; yEnc (1/1) 17384">
		<groups>
			<group>alt.binaries.sleazemovies</group>
		</groups>
		<segments>
			<segment bytes="18089" number="1">JoXvCtFgOwLbMcMaJgYiEdIn-1788097954007@nyuu</segment>
		</segments>
	</file>
	<file poster="JWPKEi710Ds54]CxtEUoEzw0dz@9LbPyEir.Kul" date="1788097954" subject="[2/2] - &quot;My.File.mkv&quot; yEnc (1/2) 33571884">
		<groups>
			<group>alt.binaries.multimedia.alias</group>
		</groups>
		<segments>
			<segment bytes="739000" number="1">HsRvHpNtAiFhQkUaIuIvNeTo-1788097954246@nyuu</segment>
			<segment bytes="512000" number="2">ImBxLeYrJeKvNxFlWaFwQmUe-1788097954310@nyuu</segment>
		</segments>
	</file>
</nzb>`;

/** altHUB's shape: no head, a branded poster, and a trailing generator comment. */
const ALTHUB = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
<file poster="cmVsZWFzZXM@YWx0aHViLmNvLnph.com" date="1783805536" subject="[01/26] - &quot;TVnJ5cnoKPRUnRw4m.par2&quot; yEnc  23672 (1/1)">
 <groups>
  <group>alt.binaries.newznzb.yankee</group>
 </groups>
 <segments>
  <segment bytes="23672" number="1">d9ee5d0649364bbbad12e1fd634b6128@YWx0aHVi</segment>
 </segments>
</file>
<!-- newznab 2026-07-11 21:32:26 -->
</nzb>`;

/** Segment tuples in document order — what a downloader actually fetches. */
function articles(xml: string): string[] {
	return [...xml.matchAll(/<segment\b([^>]*)>([\s\S]*?)<\/segment>/gi)].map((match) => {
		const bytes = /bytes="(\d+)"/.exec(match[1])?.[1] ?? '';
		const number = /number="(\d+)"/.exec(match[1])?.[1] ?? '';
		return `${number}|${bytes}|${match[2].trim()}`;
	});
}

describe('sanitizeNzb', () => {
	it('strips the indexer watermark, DOCTYPE, poster and dates', () => {
		const result = sanitizeNzb(DRUNKENSLUG);

		expect(result.xml).not.toContain('0a624180.27889905291');
		expect(result.xml).not.toContain('<head>');
		expect(result.xml).not.toContain('<meta');
		expect(result.xml).not.toContain('poster=');
		expect(result.xml).not.toContain('date=');
		expect(result.xml).not.toMatch(/DOCTYPE/i);
		expect(result.removed[0]).toContain('<meta type="tag">');
		expect(result.removed).toContain('DOCTYPE');
		expect(result.removed).toContain('poster on every file (2 distinct)');
		expect(result.removed).toContain('post dates');
	});

	it('names the comment altHUB appends', () => {
		const result = sanitizeNzb(ALTHUB);

		expect(result.xml).not.toContain('<!--');
		expect(result.xml).not.toContain('cmVsZWFzZXM');
		expect(result.removed).toContain('1 XML comment');
	});

	// The whole point of cleaning rather than rewriting: the download has to be
	// the same download afterwards.
	it('keeps every article, in order, byte for byte', () => {
		const result = sanitizeNzb(DRUNKENSLUG);

		expect(articles(result.xml)).toEqual(articles(DRUNKENSLUG));
		expect(result.files).toBe(2);
		expect(result.segments).toBe(3);
		expect(result.droppedFiles).toBe(0);
		expect(result.droppedSegments).toBe(0);
		expect(result.suspectBytes).toBe(0);
	});

	it('emits the declaration, root and namespace both readers expect', () => {
		const result = sanitizeNzb(ALTHUB);

		expect(result.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
		expect(result.xml).toContain('<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">');
		expect(result.xml.trimEnd().endsWith('</nzb>')).toBe(true);
	});

	// SAB treats a missing <segments> as fatal for the entire NZB, not just the
	// file it belongs to, so it is emitted even around a single segment.
	it('always wraps segments in <segments>', () => {
		const result = sanitizeNzb(ALTHUB);

		expect(result.xml).toContain('<segments>');
		expect(result.xml).toContain('</segments>');
	});

	it('strips angle brackets from a Message-ID, which both readers add back', () => {
		const result =
			sanitizeNzb(`<nzb><file subject="&quot;a.mkv&quot;"><groups><group>a.b.c</group></groups><segments>
			<segment bytes="100" number="1">&lt;part1@news&gt;</segment>
		</segments></file></nzb>`);

		expect(result.xml).toContain('<segment bytes="100" number="1">part1@news</segment>');
	});

	it('drops a segment with no Message-ID and counts it', () => {
		const result =
			sanitizeNzb(`<nzb><file subject="&quot;a.mkv&quot;"><groups><group>a.b.c</group></groups><segments>
			<segment bytes="100" number="1">part1@news</segment>
			<segment bytes="100" number="2">   </segment>
			<segment bytes="100" number="3"/>
		</segments></file></nzb>`);

		expect(result.segments).toBe(1);
		expect(result.droppedSegments).toBe(2);
	});

	it('drops a file left with nothing and keeps the rest', () => {
		const result = sanitizeNzb(`<nzb>
			<file subject="&quot;empty.mkv&quot;"><groups><group>a.b.c</group></groups><segments></segments></file>
			<file subject="&quot;good.mkv&quot;"><groups><group>a.b.c</group></groups><segments>
				<segment bytes="100" number="1">part1@news</segment>
			</segments></file>
		</nzb>`);

		expect(result.files).toBe(1);
		expect(result.droppedFiles).toBe(1);
		expect(result.xml).toContain('good.mkv');
		expect(result.xml).not.toContain('empty.mkv');
	});

	// Handing back a document SAB will call an empty NZB is worse than saying so.
	it('refuses an NZB with no usable file', () => {
		expect(() =>
			sanitizeNzb(`<nzb><file subject="x"><segments></segments></file></nzb>`)
		).toThrow(NzbSanitizeError);
		expect(() => sanitizeNzb('<html><body>not an nzb</body></html>')).toThrow(/not an NZB/);
	});

	it('gives a group-less file the one the rest of the document uses', () => {
		const result = sanitizeNzb(`<nzb>
			<file subject="&quot;a.mkv&quot;"><groups><group>alt.binaries.real</group></groups><segments>
				<segment bytes="100" number="1">part1@news</segment>
			</segments></file>
			<file subject="&quot;b.mkv&quot;"><segments>
				<segment bytes="100" number="1">part2@news</segment>
			</segments></file>
		</nzb>`);

		expect(result.xml.match(/<group>alt\.binaries\.real<\/group>/g)).toHaveLength(2);
	});

	it('falls back to a placeholder group when the document names none', () => {
		const result = sanitizeNzb(`<nzb><file subject="&quot;a.mkv&quot;"><segments>
			<segment bytes="100" number="1">part1@news</segment>
		</segments></file></nzb>`);

		expect(result.xml).toContain(`<group>${FALLBACK_GROUP}</group>`);
	});

	it('numbers a segment by position when the source number is missing or junk', () => {
		const result =
			sanitizeNzb(`<nzb><file subject="&quot;a.mkv&quot;"><groups><group>a.b.c</group></groups><segments>
			<segment bytes="100">part1@news</segment>
			<segment bytes="100" number="0">part2@news</segment>
			<segment bytes="100" number="nope">part3@news</segment>
		</segments></file></nzb>`);

		expect(articles(result.xml)).toEqual([
			'1|100|part1@news',
			'2|100|part2@news',
			'3|100|part3@news',
		]);
	});

	// Reported rather than repaired: a fabricated size would turn a download SAB
	// refuses into one that silently produces a broken file.
	it('flags bytes SAB will not accept but leaves them alone', () => {
		const result =
			sanitizeNzb(`<nzb><file subject="&quot;a.mkv&quot;"><groups><group>a.b.c</group></groups><segments>
			<segment bytes="9000000" number="1">huge@news</segment>
			<segment bytes="0" number="2">zero@news</segment>
			<segment number="3">missing@news</segment>
		</segments></file></nzb>`);

		expect(result.suspectBytes).toBe(3);
		expect(result.xml).toContain('<segment bytes="9000000" number="1">huge@news</segment>');
		expect(result.xml).toContain('<segment bytes="0" number="2">zero@news</segment>');
		expect(result.xml).toContain('<segment number="3">missing@news</segment>');
	});

	it('keeps an archive password by default and drops it on request', () => {
		const withPassword = `<nzb><head><meta type="password">houseofusenet</meta><meta type="tag">abc.123</meta></head>
			<file subject="&quot;a.mkv&quot;"><groups><group>a.b.c</group></groups><segments>
				<segment bytes="100" number="1">part1@news</segment>
			</segments></file></nzb>`;

		const kept = sanitizeNzb(withPassword);
		expect(kept.xml).toContain('<meta type="password">houseofusenet</meta>');
		expect(kept.xml).not.toContain('abc.123');
		expect(kept.removed.some((entry) => entry.includes('password'))).toBe(false);

		const dropped = sanitizeNzb(withPassword, { keepPassword: false });
		expect(dropped.xml).not.toContain('houseofusenet');
		expect(dropped.removed.some((entry) => entry.includes('password'))).toBe(true);
	});

	it('round-trips entities in subjects and Message-IDs', () => {
		const result =
			sanitizeNzb(`<nzb><file subject="&quot;A &amp; B.mkv&quot; yEnc"><groups><group>a.b.c</group></groups><segments>
			<segment bytes="100" number="1">a&amp;b@news</segment>
		</segments></file></nzb>`);

		expect(result.xml).toContain('subject="&quot;A &amp; B.mkv&quot; yEnc"');
		expect(result.xml).toContain('>a&amp;b@news</segment>');
	});

	// `>` is legal unescaped in an attribute value, and a naive scan for the first
	// `>` would drop every attribute after it — here, the subject itself.
	it('reads a subject containing a bare > character', () => {
		const result =
			sanitizeNzb(`<nzb><file poster="x" subject="[1/2] Part 1 -> 2 &quot;a.mkv&quot;"><groups><group>a.b.c</group></groups><segments>
			<segment bytes="100" number="1">part1@news</segment>
		</segments></file></nzb>`);

		expect(result.xml).toContain('Part 1 -&gt; 2');
		expect(result.xml).toContain('&quot;a.mkv&quot;');
	});

	it('is a fixed point: cleaning a cleaned NZB changes nothing', () => {
		const once = sanitizeNzb(DRUNKENSLUG);
		const twice = sanitizeNzb(once.xml);

		expect(twice.xml).toBe(once.xml);
		expect(twice.removed).toEqual([]);
	});
});

describe('quoteFilenameInSubject', () => {
	it('leaves an already-quoted subject alone', () => {
		const subject = '[1/9] - "My.File.mkv" yEnc (1/2)';
		expect(quoteFilenameInSubject(subject)).toBe(subject);
	});

	// Both readers take the filename from the first quoted run; without one they
	// fall back to deobfuscation, the yEnc header or a par2 rename.
	it('quotes a bare filename in place, keeping the yEnc part counts around it', () => {
		expect(quoteFilenameInSubject('[1/9] - My.File.mkv yEnc (1/2)')).toBe(
			'[1/9] - "My.File.mkv" yEnc (1/2)'
		);
	});

	it('leaves a subject with no recognisable filename untouched', () => {
		expect(quoteFilenameInSubject('yEnc (1/2)')).toBe('yEnc (1/2)');
		expect(quoteFilenameInSubject('')).toBe('');
	});
});
