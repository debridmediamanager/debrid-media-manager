import { describe, expect, it } from 'vitest';
import {
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

	it('names no language for und, unknown codes or non-codes', () => {
		for (const tag of ['und', 'unk', '', 'zz', 'english', '12']) {
			expect(normalizeLanguage(tag)).toBeNull();
		}
	});
});

describe('subtitleLanguagesOfRelease', () => {
	const file = (streams: unknown[]) => ({ path: '/f.mkv', bytes: 1, MediaInfo: { streams } });

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
