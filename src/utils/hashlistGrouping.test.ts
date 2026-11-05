import fixture from '@/test/fixtures/hashlist/altogether-titles-2026-11-05.json';
import type { LibraryIdentification } from '@/utils/libraryIdentify';
import { getMediaId } from '@/utils/mediaId';
import { getTypeByName } from '@/utils/mediaType';
import { filenameParse } from '@ctrl/video-filename-parser';
import { describe, expect, it } from 'vitest';
import { groupHashlist } from './hashlistGrouping';

// parsed the way the hashlist page parses each row
const rows = fixture.rows.map(({ hash, filename }) => {
	const mediaType = getTypeByName(filename);
	const info = mediaType === 'movie' ? filenameParse(filename) : filenameParse(filename, true);
	return {
		hash,
		filename,
		mediaType,
		info,
		title: getMediaId(info, mediaType, false) || filename,
	};
});
const identified = Object.fromEntries(
	fixture.rows.flatMap((r) => (r.identified ? [[r.hash, r.identified]] : []))
) as Record<string, LibraryIdentification>;
const row = (name: string) => rows.find((r) => r.filename.includes(name))!;

// a real shared list, "altogether", with the answers DMM had stored for it
describe('groupHashlist', () => {
	const grouping = groupHashlist(rows, identified);
	const keyOf = (name: string) => grouping.keyOf.get(row(name).hash);

	it('joins spellings of one show the parser keeps apart', () => {
		const russian = row('Isekai Nonbiri Nouka 2');
		const english = row('Farming Life in Another World S02');
		expect(russian.title).not.toBe(english.title);
		expect(keyOf('Isekai Nonbiri Nouka 2')).toBe('tt19223420');
		expect(keyOf('Farming Life in Another World S02')).toBe('tt19223420');
	});

	it('gives an unnamed episode the id its named siblings agree on', () => {
		expect(identified[row('Seikatsu - 84').hash]).toBeUndefined();
		expect(keyOf('Seikatsu - 84')).toBe('tt5607616');
		expect(keyOf('Seikatsu - 85')).toBe('tt5607616');
		expect(grouping.counts.get('tt5607616')).toBe(2);
	});

	it('leaves an unnamed episode alone when its siblings disagree', () => {
		// IMDb lists Bleach (2004) and Thousand-Year Blood War apart; the list holds both
		expect(keyOf('S17E45')).not.toBe(keyOf('S17E39'));
		expect(keyOf('[AnoZu] Bleach S17E48')).toBe('Bleach');
	});

	it('counts titles, not files', () => {
		expect(grouping.tvCount).toBe(5);
		expect(grouping.movieCount).toBe(0);
	});
});
