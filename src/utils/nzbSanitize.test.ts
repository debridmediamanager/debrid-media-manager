import { describe, expect, it } from 'vitest';
import {
	FALLBACK_GROUP,
	NzbSanitizeError,
	quoteFilenameInSubject,
	sanitizeNzb,
	SMALL_FILE_THRESHOLD,
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

	// One indexer writes a different single group into every download, so the
	// source's groups cannot be trusted and are not needed: SAB never sends
	// GROUP, and NZBGet sends it only with JoinGroup=yes and still fetches by
	// Message-ID. One fixed group per file satisfies both.
	it('writes one fixed group for every file, whatever the source listed', () => {
		const result = sanitizeNzb(`<nzb>
			<file subject="&quot;a.mkv&quot;"><groups><group>alt.binaries.real</group><group>alt.binaries.other</group></groups><segments>
				<segment bytes="100" number="1">part1@news</segment>
			</segments></file>
			<file subject="&quot;b.mkv&quot;"><segments>
				<segment bytes="100" number="1">part2@news</segment>
			</segments></file>
		</nzb>`);

		expect(result.xml.match(/<group>[^<]*<\/group>/g)).toEqual([
			`<group>${FALLBACK_GROUP}</group>`,
			`<group>${FALLBACK_GROUP}</group>`,
		]);
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

// --- the head whitelist --------------------------------------------------
//
// `name`, `title`, `category` and `password` describe the release, not the
// download: identical for everyone who grabs it, and what SABnzbd names the job
// from. Everything else in <head> is still dropped, watermarks included.

describe('sanitizeNzb head metas', () => {
	const file = `<file subject="&quot;a.mkv&quot;"><groups><group>${FALLBACK_GROUP}</group></groups><segments>
			<segment bytes="739000" number="1">part1@news</segment>
		</segments></file>`;

	it('keeps name and category beside the password, in a fixed order', () => {
		const result = sanitizeNzb(
			`<nzb><head>
				<meta type="password">houseofusenet</meta>
				<meta type="category">TV &gt; HD</meta>
				<meta type="name">Some.Release.S01E01.1080p</meta>
			</head>${file}</nzb>`
		);

		expect(result.xml).toContain(`\t<head>
\t\t<meta type="name">Some.Release.S01E01.1080p</meta>
\t\t<meta type="category">TV &gt; HD</meta>
\t\t<meta type="password">houseofusenet</meta>
\t</head>`);
		expect(result.removed).toEqual([]);
	});

	// newznab's spelling of the same field. Emitting both would let a downstream
	// reader pick either one and get a different job name.
	it('normalises title to name on output', () => {
		const result = sanitizeNzb(
			`<nzb><head><meta type="title">Some.Release.1080p</meta></head>${file}</nzb>`
		);

		expect(result.xml).toContain('<meta type="name">Some.Release.1080p</meta>');
		expect(result.xml).not.toContain('type="title"');
		expect(result.removed).toEqual([]);
	});

	// In all 1,140 library NZBs carrying both, the name was the release and the
	// title was an indexer's per-download token, in either order (927 name first,
	// 213 title first). Taking whichever came first published the token 213 times.
	it('takes name over title, whichever the indexer wrote first', () => {
		const nameFirst = sanitizeNzb(
			`<nzb><head><meta type="name">From.Name</meta><meta type="title">From.Title</meta></head>${file}</nzb>`
		);
		expect(nameFirst.xml).toContain('<meta type="name">From.Name</meta>');
		expect(nameFirst.xml).not.toContain('From.Title');

		const titleFirst = sanitizeNzb(
			`<nzb><head><meta type="title">From.Title</meta><meta type="name">From.Name</meta></head>${file}</nzb>`
		);
		expect(titleFirst.xml).toContain('<meta type="name">From.Name</meta>');
		expect(titleFirst.xml).not.toContain('From.Title');
	});

	// The reason this module exists still holds: a kept meta beside the watermark
	// must not carry the watermark through with it.
	it('still strips the DrunkenSlug tag from a head it keeps other metas from', () => {
		const result = sanitizeNzb(
			`<nzb><head>
				<meta type="name">Some.Release.1080p</meta>
				<meta type="tag">0a624180.27889905291</meta>
			</head>${file}</nzb>`
		);

		expect(result.xml).toContain('<meta type="name">Some.Release.1080p</meta>');
		expect(result.xml).not.toContain('0a624180.27889905291');
		expect(result.removed[0]).toContain('<meta type="tag">');
	});

	it('emits no head at all when the source had no whitelisted meta', () => {
		expect(sanitizeNzb(`<nzb>${file}</nzb>`).xml).not.toContain('<head>');
		expect(sanitizeNzb(DRUNKENSLUG).xml).not.toContain('<head>');
	});

	it('is still a fixed point with a full head', () => {
		const once = sanitizeNzb(
			`<nzb><head>
				<meta type="title">Some.Release.1080p</meta>
				<meta type="category">TV &gt; HD</meta>
				<meta type="password">houseofusenet</meta>
				<meta type="tag">0a624180.27889905291</meta>
			</head>${file}</nzb>`
		);
		const twice = sanitizeNzb(once.xml);

		expect(twice.xml).toBe(once.xml);
		expect(twice.removed).toEqual([]);
	});
});

// --- planted payloads ----------------------------------------------------
//
// A one-segment file of a few hundred bytes is not part of a release; it is a
// "your user id is …" article wearing a filename. Flagged and kept, never
// dropped — a release can legitimately carry a tiny nfo, and removing a file
// would change the download this module exists to preserve.

describe('sanitizeNzb planted-file flagging', () => {
	const PLANTED = `<nzb>
		<file subject="&quot;downloaded-by-user-4417.txt&quot; yEnc (1/1)"><groups><group>${FALLBACK_GROUP}</group></groups><segments>
			<segment bytes="312" number="1">planted@news</segment>
		</segments></file>
		<file subject="&quot;real.mkv&quot; yEnc (1/1)"><groups><group>${FALLBACK_GROUP}</group></groups><segments>
			<segment bytes="739000" number="1">real@news</segment>
		</segments></file>
	</nzb>`;

	it('names the small file and leaves it in the document', () => {
		const result = sanitizeNzb(PLANTED);

		expect(result.plantedSuspects).toEqual(['"downloaded-by-user-4417.txt" yEnc (1/1)']);
		expect(result.files).toBe(2);
		expect(result.xml).toContain('planted@news');
		expect(result.droppedFiles).toBe(0);
		// Not a strip, so it stays out of the "what came off" report the download
		// endpoint puts in its X-Nzb-Removed header.
		expect(result.removed).toEqual([]);
	});

	it('sums the file segments rather than judging them one at a time', () => {
		const result =
			sanitizeNzb(`<nzb><file subject="&quot;a.txt&quot;"><groups><group>a.b.c</group></groups><segments>
			<segment bytes="1000" number="1">one@news</segment>
			<segment bytes="1000" number="2">two@news</segment>
		</segments></file></nzb>`);

		expect(result.plantedSuspects).toEqual(['"a.txt"']);
		expect(result.suspectBytes).toBe(0); // each segment is fine on its own
	});

	it.each([
		[SMALL_FILE_THRESHOLD - 1, true],
		[SMALL_FILE_THRESHOLD, false],
	])('treats a %i-byte file as suspect: %s', (bytes, suspect) => {
		const result =
			sanitizeNzb(`<nzb><file subject="&quot;a.bin&quot;"><groups><group>a.b.c</group></groups><segments>
			<segment bytes="${bytes}" number="1">one@news</segment>
		</segments></file></nzb>`);

		expect(result.plantedSuspects.length > 0).toBe(suspect);
	});

	it('finds nothing to flag in a healthy NZB from either indexer', () => {
		expect(sanitizeNzb(DRUNKENSLUG).plantedSuspects).toEqual([]);
		expect(sanitizeNzb(ALTHUB).plantedSuspects).toEqual([]);
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

// --- per-download watermarks, measured 2026-09-10 --------------------------
//
// One copy of an NZB cannot show what an indexer changes per download, so six
// indexers were each asked for the same release twice from one account and the
// copies were diffed. Three changed nothing. Three stamp every download:
//
//   one        a fresh token as the `title` (and on 612 of 618 passworded
//              files, as the `password`), a random poster on every file, a
//              jittered date and a different single group
//   another    one subject per download prefixed `[N3wZ] \<6 random><number>\::`,
//              the number the same in all 254 of its NZBs in the library: the
//              account
//   a third    a random prefix on every poster ahead of a constant marker
//
// These keep those shapes with every identifier replaced and the token
// encoding intact, because that is what the cleaner recognises.

const GEEK_A = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<!-- Provided by SomeIndexer Thursday 10th September 2026 - 21:47:05pm UTC -->
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
 <head>
  <meta type="category">TV &gt; Anime</meta>
  <meta type="name">Some.Show.S02E10.1080p.WEB.h264-GRP</meta>
  <meta type="x-rating-id">0f0e0d0c0b0a09080706050403020100</meta>
  <meta type="title">52731k40q61q2K8q3k90W12T5A118406.mkv</meta>
  <meta type="password">40682s15d3d0S71d6s2E8r5r29140</meta>
  <meta type="indexer">SomeIndexer</meta>
  <meta type="qT5nWx8Lp">27519v3h8h60V4h1v9Z0b7K46213</meta>
 </head>
 <file poster="aXq3Lp_Tz9Rm-K2v@hw7eQs.Nd" date="1400000100" subject="[01/02] - &quot;Some.Show.S02E10.1080p.WEB.h264-GRP.part1.rar&quot; yEnc (1/2)">
  <groups><group>alt.binaries.hdtv.repost</group></groups>
  <segments>
   <segment bytes="739000" number="1">part1-a@some.host</segment>
   <segment bytes="512000" number="2">part1-b@some.host</segment>
  </segments>
 </file>
 <file poster="aXq3Lp_Tz9Rm-K2v@hw7eQs.Nd" date="1400000100" subject="[02/02] - &quot;Some.Show.S02E10.1080p.WEB.h264-GRP.par2&quot; yEnc (1/1)">
  <groups><group>alt.binaries.hdtv.repost</group></groups>
  <segments><segment bytes="18089" number="1">par2-a@some.host</segment></segments>
 </file>
</nzb>`;

/** The same release again: another token, no password, the title ahead of the name. */
const GEEK_B = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<!-- Provided by SomeIndexer Thursday 10th September 2026 - 21:47:10pm UTC -->
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
 <head>
  <meta type="category">TV &gt; Anime</meta>
  <meta type="title">90318m7p22p5M40p8m6X3y71C9J64420.mkv</meta>
  <meta type="name">Some.Show.S02E10.1080p.WEB.h264-GRP</meta>
  <meta type="x-rating-id">0f0e0d0c0b0a09080706050403020100</meta>
  <meta type="indexer">SomeIndexer</meta>
  <meta type="Rb7yVn2">83105c2w6w71C3w0c8L4d9P50377</meta>
 </head>
 <file poster="Ls9-QwE2_pZx7Tk@c4VbR8.mY" date="1400000233" subject="[01/02] - &quot;Some.Show.S02E10.1080p.WEB.h264-GRP.part1.rar&quot; yEnc (1/2)">
  <groups><group>alt.binaries.movie</group></groups>
  <segments>
   <segment bytes="739000" number="1">part1-a@some.host</segment>
   <segment bytes="512000" number="2">part1-b@some.host</segment>
  </segments>
 </file>
 <file poster="Ls9-QwE2_pZx7Tk@c4VbR8.mY" date="1400000233" subject="[02/02] - &quot;Some.Show.S02E10.1080p.WEB.h264-GRP.par2&quot; yEnc (1/1)">
  <groups><group>alt.binaries.movie</group></groups>
  <segments><segment bytes="18089" number="1">par2-a@some.host</segment></segments>
 </file>
</nzb>`;

const LIFE_A = `<?xml version="1.0" encoding="UTF-8"?>
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
<head><meta type="category">TV &gt; HD</meta><meta type="name">Some.Show.S02E15.1080p.WEB-DL-GRP</meta></head>
<file poster="Uploader &lt;up@example.org&gt;" date="1757000000" subject="[N3wZ] \\Ab3Cd9100001\\::[1/2] &quot;Some.Show.S02E15.1080p.WEB-DL-GRP.mkv.vol07+08.par2&quot; yEnc (1/8)">
 <groups><group>alt.binaries.multimedia</group></groups>
 <segments><segment bytes="716800" number="1">vol-1@up.example</segment></segments>
</file>
<file poster="Uploader &lt;up@example.org&gt;" date="1757000000" subject="[2/2] &quot;Some.Show.S02E15.1080p.WEB-DL-GRP.mkv&quot; yEnc (1/3)">
 <groups><group>alt.binaries.multimedia</group></groups>
 <segments><segment bytes="716800" number="1">mkv-1@up.example</segment></segments>
</file>
<!-- newznab 2026-09-10 21:47:05 -->
</nzb>`;

/** The stamp lands on another file, with a new random prefix and the same account number. */
const LIFE_B = LIFE_A.replace('[N3wZ] \\Ab3Cd9100001\\::[1/2]', '[1/2]').replace(
	'subject="[2/2]',
	'subject="[N3wZ] \\Zz8Yy1100001\\::[2/2]'
);

const SLUG_A = `<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
	<file poster="aBcDeF123Xy45]user &lt;user@x.localdomain&gt;" date="1788097954" subject="[1/1] - &quot;Some.Movie.2023.1080p.mkv&quot; yEnc (1/2)">
		<groups><group>alt.binaries.multimedia.alias</group></groups>
		<segments>
			<segment bytes="739000" number="1">m1@nyuu</segment>
			<segment bytes="512000" number="2">m2@nyuu</segment>
		</segments>
	</file>
</nzb>`;
const SLUG_B = SLUG_A.replace('aBcDeF123Xy45]', 'GhIjKl123Xy45]');

describe('sanitizeNzb per-download watermarks', () => {
	// The whole point of an anonymized NZB: two people who grabbed the same
	// release publish the same bytes, so nothing in it says which one it was.
	it.each([
		['token-stamping', GEEK_A, GEEK_B],
		['subject-stamping', LIFE_A, LIFE_B],
		['poster-stamping', SLUG_A, SLUG_B],
	])('cleans two %s grabs of one release to the same bytes', (_indexer, first, second) => {
		expect(sanitizeNzb(first).xml).toBe(sanitizeNzb(second).xml);
	});

	it('leaves no per-download value behind', () => {
		const forbidden = [
			'52731k40q',
			'90318m7p',
			'40682s15d',
			'N3wZ',
			'100001',
			'123Xy45',
			'alt.binaries.hdtv.repost',
			'alt.binaries.movie',
			'poster=',
			'date=',
		];
		for (const source of [GEEK_A, GEEK_B, LIFE_A, LIFE_B, SLUG_A, SLUG_B]) {
			const { xml } = sanitizeNzb(source);
			for (const token of forbidden) expect(xml).not.toContain(token);
			expect(xml.match(/<group>[^<]*<\/group>/g)?.length).toBe(xml.match(/<file\b/g)?.length);
		}
		expect(sanitizeNzb(LIFE_A).xml).toContain(
			'subject="[1/2] &quot;Some.Show.S02E15.1080p.WEB-DL-GRP.mkv.vol07+08.par2&quot; yEnc (1/8)"'
		);
	});

	it('says what it took off', () => {
		expect(sanitizeNzb(GEEK_A).removed.join(' | ')).toMatch(/password/);
		expect(sanitizeNzb(GEEK_B).removed.join(' | ')).toMatch(/title/);
		expect(sanitizeNzb(LIFE_A).removed.join(' | ')).toMatch(/subject/);
		expect(sanitizeNzb(GEEK_A).removed.join(' | ')).toMatch(/group/);
	});

	// A token is dropped wherever it sits, and only a token. The six of that
	// indexer's passwords shaped like `YFHcE3qKxY8WVXQ` could be real, so they stay, and so
	// does every one of the 487 passwords the other indexers wrote.
	it('drops a head value only when it is token-shaped', () => {
		const file = `<file subject="&quot;a.mkv&quot;"><segments><segment bytes="739000" number="1">id@x</segment></segments></file>`;
		const titleOnly = sanitizeNzb(
			`<nzb><head><meta type="title">52731k40q61q2K8q3k90W12T5A118406.mkv</meta></head>${file}</nzb>`
		);
		expect(titleOnly.xml).not.toContain('<meta type="name">');

		for (const real of ['houseofusenet', 'YFHcE3qKxY8WVXQ', '0684-real-pass']) {
			expect(
				sanitizeNzb(`<nzb><head><meta type="password">${real}</meta></head>${file}</nzb>`)
					.xml
			).toContain(`<meta type="password">${real}</meta>`);
		}
		expect(
			sanitizeNzb(
				`<nzb><head><meta type="password">40682s15d3d0S71d6s2E8r5r29140</meta></head>${file}</nzb>`
			).xml
		).not.toContain('type="password"');
	});
});
