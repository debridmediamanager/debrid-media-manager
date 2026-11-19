import { languageEmojis } from '@/components/showInfo/languages';
import { describe, expect, it } from 'vitest';
import {
	TWO_LETTER_TO_BIBLIOGRAPHIC,
	hasSubsToken,
	normalizeLanguage,
	subtitleLanguagesOfRelease,
	withoutSubsTokens,
} from './subtitleLanguages';

describe('normalizeLanguage', () => {
	it('folds ISO 639-1, 639-2/T and 639-2/B into the bibliographic code', () => {
		for (const tag of ['el', 'ell', 'gre', 'GRE', 'el-GR']) {
			expect(normalizeLanguage(tag)).toBe('gre');
		}
		expect(normalizeLanguage('fra')).toBe('fre');
		expect(normalizeLanguage('deu')).toBe('ger');
		expect(normalizeLanguage('pt-BR')).toBe('por');
		expect(normalizeLanguage('eng')).toBe('eng');
	});

	it('maps ht and hat alike, and the withdrawn iw/in/ji codes', () => {
		expect(normalizeLanguage('ht')).toBe('hat');
		expect(normalizeLanguage('hat')).toBe('hat');
		expect(normalizeLanguage('iw')).toBe('heb');
		expect(normalizeLanguage('in')).toBe('ind');
		expect(normalizeLanguage('ji')).toBe('yid');
	});

	it('reaches every language languageEmojis has a flag for that has a two-letter code', () => {
		const flagged = new Set(Object.keys(languageEmojis));
		// No ISO 639-1 code: Bhojpuri, Cebuano, Dogri, Hmong, Ilocano, Konkani, Maithili, Mizo, Northern Sotho.
		const threeLetterOnly = ['bho', 'ceb', 'doi', 'hmn', 'ilo', 'kok', 'mai', 'lus', 'nso'];
		const reached = new Set(Object.values(TWO_LETTER_TO_BIBLIOGRAPHIC));
		const missing = [...flagged].filter(
			(code) => !reached.has(code) && !threeLetterOnly.includes(code)
		);
		expect(missing).toEqual([]);
	});

	it('names no language for und, unknown codes or non-codes', () => {
		for (const tag of ['und', 'unk', '', 'zz', 'english', '12']) {
			expect(normalizeLanguage(tag)).toBeNull();
		}
	});
});

describe('subtitleLanguagesOfRelease', () => {
	const video = { codec_type: 'video', codec_name: 'hevc' };
	const file = (streams: unknown[], path = '/f.mkv') => ({
		path,
		bytes: 1,
		MediaInfo: { streams: [video, ...streams] },
	});

	it('unions the tagged subtitle tracks of every probed file', () => {
		const release = {
			files: {
				1: file([
					{ codec_type: 'audio', tags: { language: 'jpn' } },
					{ codec_type: 'subtitle', tags: { language: 'ell' } },
					{ codec_type: 'subtitle', tags: { language: 'en' } },
				]),
				2: file([
					{ codec_type: 'subtitle', tags: { language: 'gre' } },
					{ codec_type: 'subtitle', tags: null },
					{ codec_type: 'subtitle', tags: { language: 'und' } },
				]),
			},
		};
		expect(subtitleLanguagesOfRelease(release)).toEqual(['eng', 'gre']);
	});

	it('leaves out a probed file with no video track, such as a sidecar a sponsor sent', () => {
		const sidecar = {
			path: '/captions.srt',
			bytes: 2,
			MediaInfo: { streams: [{ codec_type: 'subtitle', tags: { language: 'gre' } }] },
		};
		const nameless = { ...sidecar, path: '' };
		const release = {
			files: { 1: file([]), 'contributed:2': sidecar, 'contributed:3': nameless },
		};
		expect(subtitleLanguagesOfRelease(release)).toEqual([]);
	});

	it('gives [] for a release with no tagged subtitles and survives bad shapes', () => {
		expect(subtitleLanguagesOfRelease({ files: { 1: file([]) } })).toEqual([]);
		expect(subtitleLanguagesOfRelease(null)).toEqual([]);
		expect(subtitleLanguagesOfRelease({ files: { 1: { MediaInfo: 'x' } } })).toEqual([]);
	});
});

describe('subs: tokens', () => {
	it('finds and strips subs: and -subs: terms', () => {
		expect(hasSubsToken('2160p subs:el')).toBe(true);
		expect(hasSubsToken('-subs:en')).toBe(true);
		expect(hasSubsToken('subtitles')).toBe(false);
		expect(withoutSubsTokens('2160p  subs:el -subs:en remux')).toBe('2160p remux');
	});
});
