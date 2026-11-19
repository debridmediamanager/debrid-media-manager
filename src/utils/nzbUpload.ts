/**
 * An NZB a sponsor's zurg uploads for other sponsors' zurgs (PUT
 * /api/sponsor/wanted/nzb/<sha>), rebuilt before it is stored.
 *
 * zurg anonymizes the file before it sends it, but the sender is a stranger's
 * machine, so nothing in it is taken on trust. `sanitizeNzbAsync` reads raw text
 * with regular expressions: it would take a `<file>` inside a comment or an entity
 * declaration for a real one, and several of its patterns go quadratic on input
 * built for that. So the upload is first read by the one-pass scanner below, which
 * keeps only each file's subject and its segments (number, bytes, Message-ID) and
 * the archive password, and writes them out as plain well-formed XML. That is what
 * the sanitizer then cleans, as it does every NZB DMM stores, so the stored copy is
 * one the Newznab grab's own cleaning pass leaves unchanged.
 *
 * Comments, processing instructions, the DOCTYPE with any entities it declares,
 * every other meta, every other element and attribute, posters, dates and groups
 * never reach the output. No entity beyond XML's five and numeric references is
 * expanded.
 */
import {
	NzbSanitizeError,
	escapeAttr,
	escapeText,
	findTagEnd,
	sanitizeNzbAsync,
} from './nzbSanitize';

/** The largest upload taken, in bytes, compressed or not. */
export const MAX_UPLOADED_NZB = 8 * 1024 * 1024;

const MAX_SUBJECT = 512;
/**
 * The sanitizer's subject patterns can cost the square of a subject's length, on this
 * upload and on every grab of it after. 8 MB of files with 512-character subjects took
 * 2.4 s to clean (2026-11-19), which is 3.9e9 here; 10,000 files with 200-character
 * subjects, more than a real season pack holds, is 4e8.
 */
const MAX_SUBJECT_COST = 5e8;
const MAX_PASSWORD = 256;
/** `local@domain`, at most the 250 octets RFC 5536 allows. An undeclared `&entity;` has no `@`. */
const MESSAGE_ID = /^(?=.{3,250}$)[^\s<>@]+@[^\s<>@]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/g;
const BAD_SEGMENT = 'That NZB has a segment without a usable Message-ID';

const NAMED: Record<string, number> = { amp: 38, lt: 60, gt: 62, quot: 34, apos: 39 };

/** XML's five entities and numeric references, and nothing a DOCTYPE declared. */
function decode(raw: string): string {
	return raw
		.replace(
			/&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g,
			(_full, dec?: string, hex?: string, named?: string) => {
				const point = named ? NAMED[named] : dec ? Number(dec) : parseInt(hex!, 16);
				const valid = point <= 0x10ffff && (point < 0xd800 || point > 0xdfff);
				return valid ? String.fromCodePoint(point) : '';
			}
		)
		.replace(CONTROL, '');
}

/** A tag's attributes, read left to right in one pass; the first of a name wins. */
function attrsOf(raw: string): Map<string, string> {
	const attrs = new Map<string, string>();
	let i = 0;
	while (i < raw.length) {
		const eq = raw.indexOf('=', i);
		if (eq === -1) break;
		let nameEnd = eq;
		while (nameEnd > i && /\s/.test(raw[nameEnd - 1])) nameEnd--;
		let nameStart = nameEnd;
		while (nameStart > i && /[\w:.-]/.test(raw[nameStart - 1])) nameStart--;
		let open = eq + 1;
		while (open < raw.length && /\s/.test(raw[open])) open++;
		const quote = raw[open];
		if (quote !== '"' && quote !== "'") {
			i = eq + 1;
			continue;
		}
		const close = raw.indexOf(quote, open + 1);
		if (close === -1) break;
		const name = raw.slice(nameStart, nameEnd).toLowerCase();
		if (name && !attrs.has(name)) attrs.set(name, decode(raw.slice(open + 1, close)));
		i = close + 1;
	}
	return attrs;
}

/** Past the `>` ending the `<!…>` at `start`, internal subset included; -1 when it never ends. */
function declarationEnd(xml: string, start: number): number {
	let depth = 0;
	let quote: string | null = null;
	for (let i = start; i < xml.length; i++) {
		const char = xml[i];
		if (quote) {
			if (char === quote) quote = null;
		} else if (char === '"' || char === "'") quote = char;
		else if (char === '[') depth++;
		else if (char === ']') depth--;
		else if (char === '>' && depth <= 0) return i + 1;
	}
	return -1;
}

interface Segment {
	number: string;
	bytes: string;
	messageId: string;
}

/** The upload as plain XML holding only what is kept. One pass; never looks back. */
function rebuild(xml: string): string {
	const lines: string[] = ['<nzb>'];
	let password: string | undefined;
	let subject = '';
	let segments: Segment[] | null = null; // non-null inside a <file>
	let capturing: 'segment' | 'password' | null = null;
	let text = '';
	let segment = { number: '', bytes: '' };
	let subjectCost = 0;

	const closeFile = () => {
		if (segments?.length) {
			lines.push(`<file subject="${escapeAttr(subject)}">`, '<segments>');
			for (const s of segments) {
				const bytes = s.bytes ? ` bytes="${s.bytes}"` : '';
				const number = s.number ? ` number="${s.number}"` : '';
				lines.push(`<segment${bytes}${number}>${escapeText(s.messageId)}</segment>`);
			}
			lines.push('</segments>', '</file>');
		}
		segments = null;
	};

	let i = 0;
	while (i < xml.length) {
		const lt = xml.indexOf('<', i);
		if (lt === -1) break;
		// Text is kept only inside a segment or the password, and no more than either can use.
		if (capturing && text.length <= 1024) text += xml.slice(i, Math.min(lt, i + 1025));
		if (xml.startsWith('<!--', lt)) {
			const end = xml.indexOf('-->', lt + 4);
			if (end === -1) break;
			i = end + 3;
			continue;
		}
		if (xml.startsWith('<?', lt)) {
			const end = xml.indexOf('?>', lt + 2);
			if (end === -1) break;
			i = end + 2;
			continue;
		}
		if (xml.startsWith('<![CDATA[', lt)) {
			throw new NzbSanitizeError('That NZB uses CDATA, which is not accepted here');
		}
		if (xml[lt + 1] === '!') {
			const end = declarationEnd(xml, lt);
			if (end === -1) break;
			i = end;
			continue;
		}
		const end = findTagEnd(xml, lt);
		if (end === -1) break;
		const raw = xml.slice(lt + 1, end);
		i = end + 1;
		const closing = raw.startsWith('/');
		const name = /^\/?\s*([A-Za-z][\w.-]*)/.exec(raw)?.[1].toLowerCase();

		if (name === 'file') {
			closeFile();
			capturing = null;
			if (!closing && !raw.endsWith('/')) {
				subject = (attrsOf(raw).get('subject') ?? '').trim().slice(0, MAX_SUBJECT);
				subjectCost += subject.length ** 2;
				if (subjectCost > MAX_SUBJECT_COST) {
					throw new NzbSanitizeError('That NZB has too many long subjects');
				}
				segments = [];
			}
		} else if (name === 'segment' && segments) {
			if (closing && capturing === 'segment') {
				const messageId = decode(text).trim().replace(/^<+/, '').replace(/>+$/, '');
				// Refused, not skipped: the file would be stored with a hole and handed on as confirmed.
				if (!MESSAGE_ID.test(messageId)) throw new NzbSanitizeError(BAD_SEGMENT);
				segments.push({ ...segment, messageId });
				capturing = null;
			} else if (!closing) {
				if (raw.endsWith('/')) throw new NzbSanitizeError(BAD_SEGMENT);
				const attrs = attrsOf(raw);
				const digits = (value = '') => (/^\d{1,9}$/.test(value) ? value : '');
				segment = {
					number: digits(attrs.get('number')),
					bytes: digits(attrs.get('bytes')),
				};
				capturing = 'segment';
				text = '';
			}
		} else if (name === 'meta' && !segments) {
			if (closing && capturing === 'password') {
				const value = decode(text).trim();
				if (value && value.length <= MAX_PASSWORD) password ??= value;
				capturing = null;
			} else if (!closing && !raw.endsWith('/')) {
				capturing = attrsOf(raw).get('type') === 'password' ? 'password' : null;
				text = '';
			}
		}
	}
	closeFile();

	if (password !== undefined) {
		lines.splice(1, 0, `<head><meta type="password">${escapeText(password)}</meta></head>`);
	}
	lines.push('</nzb>');
	return lines.join('\n');
}

/**
 * The uploaded NZB as DMM stores it. Throws `NzbSanitizeError` when no file with a
 * usable segment is left, which covers a body that is not an NZB at all.
 */
export async function cleanUploadedNzb(xml: string): Promise<string> {
	// ponytail: the scan runs in one go, some tens of ms at the 8 MB cap; slice it like sanitizeNzbAsync if uploads ever grow
	return (await sanitizeNzbAsync(rebuild(xml))).xml;
}
