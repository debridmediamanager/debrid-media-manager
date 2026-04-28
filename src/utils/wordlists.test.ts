import { describe, expect, it } from 'vitest';
import {
	BANNED_COMPOUND_WORDS,
	BANNED_WORDS,
	BANNED_WORDS_SET,
	STOPWORDS,
	STOPWORDS_SET,
} from './wordlists';

describe('STOPWORDS', () => {
	it('is a non-empty array of strings', () => {
		expect(Array.isArray(STOPWORDS)).toBe(true);
		expect(STOPWORDS.length).toBeGreaterThan(50);
		for (const word of STOPWORDS) {
			expect(typeof word).toBe('string');
		}
	});

	it('contains common English stopwords', () => {
		expect(STOPWORDS).toContain('the');
		expect(STOPWORDS).toContain('a');
		expect(STOPWORDS).toContain('is');
		expect(STOPWORDS).toContain('and');
		expect(STOPWORDS).toContain('or');
		expect(STOPWORDS).toContain('not');
	});

	it('entries are all lowercase', () => {
		for (const word of STOPWORDS) {
			expect(word).toBe(word.toLowerCase());
		}
	});
});

describe('STOPWORDS_SET', () => {
	it('is a Set with same size as STOPWORDS array', () => {
		expect(STOPWORDS_SET).toBeInstanceOf(Set);
		expect(STOPWORDS_SET.size).toBe(STOPWORDS.length);
	});

	it('contains all STOPWORDS entries', () => {
		for (const word of STOPWORDS) {
			expect(STOPWORDS_SET.has(word)).toBe(true);
		}
	});
});

describe('BANNED_WORDS', () => {
	it('is a non-empty array of strings', () => {
		expect(Array.isArray(BANNED_WORDS)).toBe(true);
		expect(BANNED_WORDS.length).toBeGreaterThan(100);
		for (const word of BANNED_WORDS) {
			expect(typeof word).toBe('string');
		}
	});
});

describe('BANNED_WORDS_SET', () => {
	it('is a Set with same size as BANNED_WORDS array', () => {
		expect(BANNED_WORDS_SET).toBeInstanceOf(Set);
		expect(BANNED_WORDS_SET.size).toBe(BANNED_WORDS.length);
	});
});

describe('BANNED_COMPOUND_WORDS', () => {
	it('is a non-empty array of strings', () => {
		expect(Array.isArray(BANNED_COMPOUND_WORDS)).toBe(true);
		expect(BANNED_COMPOUND_WORDS.length).toBeGreaterThan(50);
		for (const phrase of BANNED_COMPOUND_WORDS) {
			expect(typeof phrase).toBe('string');
			expect(phrase.length).toBeGreaterThan(0);
		}
	});

	it('mostly contains multi-word phrases', () => {
		const multiWord = BANNED_COMPOUND_WORDS.filter((p) => p.includes(' '));
		expect(multiWord.length).toBeGreaterThan(BANNED_COMPOUND_WORDS.length * 0.5);
	});
});
