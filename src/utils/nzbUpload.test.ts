import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { FALLBACK_GROUP, NzbSanitizeError, sanitizeNzb } from './nzbSanitize';
import { cleanUploadedNzb } from './nzbUpload';

const fixture = (name: string) =>
	readFileSync(path.resolve(__dirname, '../test/fixtures/wantedNzb', name), 'utf8');

// Hand-written: zurg's uploader did not exist when this was built, so there was no real
// upload to record. `hostile.nzb` is `plain.nzb`'s posting dressed in everything an
// indexer or an attacker could add.
const PLAIN = fixture('plain.nzb');
const HOSTILE = fixture('hostile.nzb');

const withSegment = (segment: string) =>
	`<nzb><file subject="a"><segments><segment bytes="1" number="1">ok@host</segment>${segment}</segments></file></nzb>`;

describe('cleanUploadedNzb', () => {
	it('keeps the files, segments and password, and nothing else', async () => {
		const xml = await cleanUploadedNzb(HOSTILE);

		expect(xml).toContain('<meta type="password">s3cret&amp;pw</meta>');
		expect(xml).toContain(
			'<file subject="[1/2] - &quot;Show.S01E07.1080p.WEB.h264-GRP.mkv&quot; yEnc (1/2)">'
		);
		expect(xml).toContain(
			'<segment bytes="716800" number="1">part1of2.abc123@news.example.invalid</segment>'
		);
		// A comment inside a Message-ID is cut out of it, not kept as part of it.
		expect(xml).toContain(
			'<segment bytes="512000" number="2">part2of2.abc123@news.example.invalid</segment>'
		);
		expect(xml.match(/<file\b/g)).toHaveLength(2);
		expect(xml.match(/<segment\b/g)).toHaveLength(3);
		expect(xml.match(/<meta\b/g)).toHaveLength(1);
		expect(xml).toContain(`<group>${FALLBACK_GROUP}</group>`);

		for (const gone of [
			'424242',
			'indexer.example',
			'planted',
			'commented',
			'entity',
			'DOCTYPE',
			'ENTITY',
			'lol',
			'passwd',
			'<!--',
			'<?xml-stylesheet',
			'idx:',
			'onload',
			'poster',
			'date=',
			'x-dmm-id',
			'x-indexer-id',
			'Tracked.By',
			'category',
			'alt.binaries.user',
			'second-password',
			'empty.bin',
		]) {
			expect(xml, gone).not.toContain(gone);
		}
	});

	it('cleans two differently decorated copies of a posting to the same bytes', async () => {
		expect(await cleanUploadedNzb(HOSTILE)).toBe(await cleanUploadedNzb(PLAIN));
	});

	it('stores a copy the Newznab grab cleaning leaves unchanged', async () => {
		const xml = await cleanUploadedNzb(HOSTILE);
		expect(sanitizeNzb(xml).xml).toBe(xml);
	});

	it('expands no declared entity and no reference outside Unicode', async () => {
		const xml = await cleanUploadedNzb(
			'<!DOCTYPE nzb [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>' +
				'<nzb><file subject="&b;&#1114112;&#xD800;x"><segments>' +
				'<segment bytes="10" number="1">id&b;@host</segment>' +
				'</segments></file></nzb>'
		);
		expect(xml).toContain('<file subject="&amp;b;x">');
		expect(xml).toContain('>id&amp;b;@host</segment>');
		expect(xml).not.toContain('aaaa');
	});

	it.each([
		['not XML at all', 'hello'],
		['an NZB with no file', '<nzb><head><meta type="password">x</meta></head></nzb>'],
		['files only inside a comment', `<nzb><!-- ${PLAIN} --></nzb>`],
		[
			'files only inside an entity',
			'<!DOCTYPE nzb [<!ENTITY f "' +
				"<file subject='a'><segments><segment bytes='1' number='1'>a@b</segment></segments></file>" +
				'">]><nzb>&f;</nzb>',
		],
		['an unterminated tag', '<nzb><file subject="a'],
		// One bad segment refuses the upload: skipping it would store a download with a hole.
		[
			'a segment that is an undeclared entity',
			withSegment('<segment bytes="1" number="2">&xxe;</segment>'),
		],
		[
			'a segment with a space in its Message-ID',
			withSegment('<segment bytes="1" number="2">a b@host</segment>'),
		],
		['an empty segment', withSegment('<segment bytes="1" number="2"/>')],
		[
			'CDATA',
			'<nzb><file subject="a"><segments><segment><![CDATA[a@b]]></segment></segments></file></nzb>',
		],
	])('refuses %s', async (_what, body) => {
		await expect(cleanUploadedNzb(body)).rejects.toBeInstanceOf(NzbSanitizeError);
	});

	it('refuses an upload whose subjects would make every later cleaning slow', async () => {
		const file = `<file subject="${'a'.repeat(512)}"><segments><segment bytes="1" number="1">a@b</segment></segments></file>`;
		await expect(cleanUploadedNzb(`<nzb>${file.repeat(2000)}</nzb>`)).rejects.toThrow(
			'too many long subjects'
		);
		await expect(cleanUploadedNzb(`<nzb>${file.repeat(100)}</nzb>`)).resolves.toContain('a@b');
	});

	it('stays quick on input built to make a pattern backtrack', async () => {
		const open = '<file subject="a" '.repeat(100_000);
		const metas = '<meta type="x">'.repeat(100_000);
		const run = 'a'.repeat(1_000_000);
		const started = performance.now();
		for (const body of [open, metas, `<file ${run}>`, `<nzb><file subject="${run}">`]) {
			await expect(cleanUploadedNzb(body)).rejects.toBeInstanceOf(NzbSanitizeError);
		}
		expect(performance.now() - started).toBeLessThan(2000);
	});
});
