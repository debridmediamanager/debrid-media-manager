/**
 * Rebuilds an NZB from scratch, keeping only what a downloader actually needs.
 *
 * An indexer stamps the NZBs it serves. Measured 2026-09-01 against the two
 * indexers behind the Usenet panel:
 *
 *   DrunkenSlug  `<head><meta type="tag">0a624180.27889905291</meta></head>`
 *                — an opaque per-download token, the one thing here that ties a
 *                file back to the account that grabbed it.
 *   altHUB       `<!-- newznab 2026-07-11 21:32:26 -->` before `</nzb>`, and a
 *                branded `poster` (`cmVsZWFzZXM@YWx0aHViLmNvLnph.com`, which is
 *                base64 for releases@althub.co.za).
 *   both         a `<!DOCTYPE nzb PUBLIC …>` line and per-file `poster`/`date`.
 *
 * Rather than blacklisting those — a list that goes stale the moment an indexer
 * adds a field — this emits a fresh document containing only the elements the
 * readers require, so anything an indexer adds in future is dropped by default.
 *
 * What SABnzbd and NZBGet actually need, and nothing else:
 *
 *   - well-formed XML; the root element name and xmlns are conventional, not
 *     enforced (though NZBGet does break on a prefixed root like `<nzb:file>`)
 *   - at least one `<file>` holding at least one valid `<segment>`; without one
 *     SAB reports an empty NZB and NZBGet "file has no content"
 *   - the `<segments>` wrapper, which SAB requires — its absence kills the whole
 *     NZB rather than just that file — and NZBGet ignores
 *   - `segment@number`, an integer above zero, required by both
 *   - `segment@bytes`, required by SAB and needed for size accounting in NZBGet
 *   - the Message-ID as element text with no angle brackets; both add their own
 *   - `<groups><group>`, which SAB never uses (it fetches by Message-ID and
 *     never sends GROUP) and NZBGet needs only with JoinGroup=yes — one is
 *     emitted anyway, because it costs nothing and a missing one is fatal there
 *   - `subject`, optional, but with the filename quoted or both readers fall
 *     back to deobfuscation, the yEnc header or a par2 rename
 *
 * The `<?xml?>` declaration, DOCTYPE, `<head>`, `poster` and `date` are all
 * optional, so none of them are emitted.
 */

/** Encoded segment size SAB rejects at or above. */
export const MAX_SEGMENT_BYTES = 8 * 1024 * 1024;

/** Emitted for a file whose groups the source omitted entirely. */
export const FALLBACK_GROUP = 'alt.binaries.misc';

export interface NzbSanitizeReport {
	/** Files in the rebuilt document. */
	files: number;
	/** Segments in the rebuilt document. */
	segments: number;
	/**
	 * What was stripped, phrased for a person rather than a parser. Ordered with
	 * the account-identifying parts first, since that is what this is for.
	 */
	removed: string[];
	/** Segments left out because they carried no Message-ID. */
	droppedSegments: number;
	/** Files left out because no valid segment survived. */
	droppedFiles: number;
	/**
	 * Segments whose `bytes` SAB will not accept — missing, unreadable, zero or
	 * at least 8 MiB. Carried through unchanged rather than invented or dropped:
	 * a source NZB with these was already broken for SAB, and guessing a size
	 * would turn a visible failure into a corrupt download.
	 */
	suspectBytes: number;
}

export interface SanitizedNzb extends NzbSanitizeReport {
	xml: string;
}

export class NzbSanitizeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NzbSanitizeError';
	}
}

export interface SanitizeOptions {
	/**
	 * Keep `<head><meta type="password">`. On by default: the password belongs to
	 * the archive and is identical for everyone who downloads it, so it identifies
	 * nobody, and dropping it silently breaks extraction of the releases that
	 * carry one (House-of-Usenet posts all do).
	 */
	keepPassword?: boolean;
}

interface ParsedSegment {
	number: number;
	bytes: number | null;
	messageId: string;
}

interface ParsedFile {
	subject: string;
	groups: string[];
	segments: ParsedSegment[];
}

const ATTR_RE = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
const GROUP_RE = /<group\b[^>]*>([\s\S]*?)<\/group>/gi;
const META_RE = /<meta\b([^>]*)>([\s\S]*?)<\/meta>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const DOCTYPE_RE = /<!DOCTYPE\b/i;
const QUOTED_NAME_RE = /"([^"]+)"/;
const BARE_NAME_RE =
	/(\S+\.(?:par2|rar|r\d{2,3}|\d{3}|mkv|mp4|avi|m4v|mov|ts|nfo|sfv|zip|7z))(?=\s|$)/i;

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
};

function decodeEntities(raw: string): string {
	return raw.replace(
		/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
		(_full, dec?: string, hex?: string, named?: string) => {
			if (dec !== undefined) return String.fromCodePoint(Number(dec));
			if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
			return NAMED_ENTITIES[named as string];
		}
	);
}

function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
	return escapeText(value).replace(/"/g, '&quot;');
}

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of raw.matchAll(ATTR_RE)) {
		attrs[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
	}
	return attrs;
}

/**
 * Index of the `>` that closes the tag opening at `start`, honouring quotes.
 *
 * `>` is legal unescaped inside an attribute value, and subjects do carry it
 * ("Part 1 -> 2"). Scanning for the first `>` would cut the tag in half there
 * and lose every attribute after it, which for a sanitizer means silently
 * emitting a mangled file rather than failing.
 */
function findTagEnd(xml: string, start: number): number {
	let quote: string | null = null;
	for (let i = start; i < xml.length; i++) {
		const char = xml[i];
		if (quote) {
			if (char === quote) quote = null;
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === '>') {
			return i;
		}
	}
	return -1;
}

/** Every `<tag …>body</tag>` at any depth, with quote-aware attribute scanning. */
function* scanElements(
	xml: string,
	tag: string
): Generator<{ attrs: Record<string, string>; body: string }> {
	const open = new RegExp(`<${tag}\\b`, 'gi');
	const close = `</${tag}>`;
	// Lowered once. A real NZB holds thousands of segments, and lowering the
	// document inside the loop turned a 680 KB file into gigabytes of copying.
	const lower = xml.toLowerCase();
	let match: RegExpExecArray | null;
	while ((match = open.exec(xml)) !== null) {
		const tagEnd = findTagEnd(xml, match.index);
		if (tagEnd === -1) return;
		const raw = xml.slice(match.index + tag.length + 1, tagEnd);
		// Self-closing: no body, which for <file> and <segment> alike means
		// nothing usable — yielded anyway so the caller counts it as dropped.
		if (raw.endsWith('/')) {
			yield { attrs: parseAttrs(raw.slice(0, -1)), body: '' };
			open.lastIndex = tagEnd + 1;
			continue;
		}
		const bodyEnd = lower.indexOf(close, tagEnd);
		if (bodyEnd === -1) return;
		yield { attrs: parseAttrs(raw), body: xml.slice(tagEnd + 1, bodyEnd) };
		open.lastIndex = bodyEnd + close.length;
	}
}

/**
 * Both readers take the filename from the first quoted run in the subject, and
 * fall back to guesswork without one. If the source left a bare filename
 * unquoted it is quoted in place, which keeps the yEnc part counts around it
 * intact — those are what tell a reader how many articles to expect.
 */
export function quoteFilenameInSubject(subject: string): string {
	if (!subject || QUOTED_NAME_RE.test(subject)) return subject;
	const bare = BARE_NAME_RE.exec(subject);
	if (!bare) return subject;
	return `${subject.slice(0, bare.index)}"${bare[1]}"${subject.slice(bare.index + bare[1].length)}`;
}

function parseFiles(xml: string): { files: ParsedFile[]; droppedSegments: number } {
	const files: ParsedFile[] = [];
	let droppedSegments = 0;

	for (const file of scanElements(xml, 'file')) {
		const segments: ParsedSegment[] = [];
		for (const segment of scanElements(file.body, 'segment')) {
			const messageId = decodeEntities(segment.body)
				.trim()
				.replace(/^<+/, '')
				.replace(/>+$/, '');
			if (!messageId) {
				droppedSegments++;
				continue;
			}
			const parsedNumber = Number.parseInt(segment.attrs.number ?? '', 10);
			const parsedBytes = Number.parseInt(segment.attrs.bytes ?? '', 10);
			segments.push({
				// Required by both readers and must be above zero. A source that
				// omits it or writes junk gets the position it was found at, which
				// is what a reader would have assumed anyway.
				number:
					Number.isFinite(parsedNumber) && parsedNumber > 0
						? parsedNumber
						: segments.length + 1,
				bytes: Number.isFinite(parsedBytes) ? parsedBytes : null,
				messageId,
			});
		}
		segments.sort((a, b) => a.number - b.number);

		files.push({
			subject: quoteFilenameInSubject((file.attrs.subject ?? '').trim()),
			groups: [...file.body.matchAll(GROUP_RE)]
				.map((match) => decodeEntities(match[1]).trim())
				.filter(Boolean),
			segments,
		});
	}

	return { files, droppedSegments };
}

function describeStripped(xml: string, metas: Record<string, string>, kept: string[]): string[] {
	const removed: string[] = [];

	// First, because it is the only field here that is per-download rather than
	// per-release: DrunkenSlug's `tag` is what a leaked NZB would be traced by.
	for (const [type, value] of Object.entries(metas)) {
		if (kept.includes(type)) continue;
		removed.push(`<meta type="${type}"> (${value.slice(0, 40)})`);
	}

	const comments = xml.match(COMMENT_RE);
	if (comments) removed.push(`${comments.length} XML comment${comments.length > 1 ? 's' : ''}`);
	if (DOCTYPE_RE.test(xml)) removed.push('DOCTYPE');

	const posters = new Set(
		[...xml.matchAll(/<file\b[^>]*?\bposter\s*=\s*"([^"]*)"/gi)].map((m) => m[1])
	);
	if (posters.size > 0) {
		removed.push(`poster on every file (${posters.size} distinct)`);
	}
	if (/<file\b[^>]*?\bdate\s*=\s*"/i.test(xml)) removed.push('post dates');

	return removed;
}

/**
 * Strips an NZB back to the parts a downloader needs and returns the rebuilt
 * document plus what came off it.
 *
 * Throws `NzbSanitizeError` rather than returning an unusable document: both
 * readers reject an NZB with no file or no segment, and handing someone a file
 * that fails inside SABnzbd is worse than telling them here.
 */
export function sanitizeNzb(xml: string, options: SanitizeOptions = {}): SanitizedNzb {
	const { keepPassword = true } = options;

	const metas: Record<string, string> = {};
	for (const match of xml.matchAll(META_RE)) {
		const type = parseAttrs(match[1]).type;
		if (type) metas[type] = decodeEntities(match[2]).trim();
	}
	const password = keepPassword ? metas.password : undefined;

	const { files: parsed, droppedSegments } = parseFiles(xml);
	const usable = parsed.filter((file) => file.segments.length > 0);
	if (usable.length === 0) {
		throw new NzbSanitizeError(
			parsed.length === 0
				? 'That file has no <file> entries — it is not an NZB'
				: 'Every file in that NZB was empty, so there is nothing to download'
		);
	}

	// One group for the whole document when a file lists none: NZBGet with
	// JoinGroup=yes needs a group name, and any group the same NZB already names
	// is a better guess than a constant.
	const documentGroup =
		usable.find((file) => file.groups.length > 0)?.groups[0] ?? FALLBACK_GROUP;

	let segments = 0;
	let suspectBytes = 0;
	const lines: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">',
	];

	if (password) {
		lines.push('\t<head>');
		lines.push(`\t\t<meta type="password">${escapeText(password)}</meta>`);
		lines.push('\t</head>');
	}

	for (const file of usable) {
		lines.push(file.subject ? `\t<file subject="${escapeAttr(file.subject)}">` : '\t<file>');
		const groups = file.groups.length > 0 ? file.groups : [documentGroup];
		lines.push('\t\t<groups>');
		for (const group of groups) lines.push(`\t\t\t<group>${escapeText(group)}</group>`);
		lines.push('\t\t</groups>');
		lines.push('\t\t<segments>');
		for (const segment of file.segments) {
			segments++;
			const valid =
				segment.bytes !== null && segment.bytes > 0 && segment.bytes < MAX_SEGMENT_BYTES;
			if (!valid) suspectBytes++;
			const bytes = segment.bytes === null ? '' : ` bytes="${segment.bytes}"`;
			lines.push(
				`\t\t\t<segment${bytes} number="${segment.number}">${escapeText(segment.messageId)}</segment>`
			);
		}
		lines.push('\t\t</segments>');
		lines.push('\t</file>');
	}

	lines.push('</nzb>');

	const removed = describeStripped(xml, metas, password ? ['password'] : []);

	return {
		xml: `${lines.join('\n')}\n`,
		files: usable.length,
		segments,
		removed,
		droppedSegments,
		droppedFiles: parsed.length - usable.length,
		suspectBytes,
	};
}
