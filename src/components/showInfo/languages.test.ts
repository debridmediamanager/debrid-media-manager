import { describe, expect, it } from 'vitest';
import { languageEmojis } from './languages';

describe('languageEmojis', () => {
	it('is a non-empty object', () => {
		expect(Object.keys(languageEmojis).length).toBeGreaterThan(0);
	});

	it('maps 3-letter ISO 639-2 codes to emoji strings', () => {
		for (const [key, value] of Object.entries(languageEmojis)) {
			expect(key).toMatch(/^[a-z]{3}$/);
			expect(typeof value).toBe('string');
			expect(value.length).toBeGreaterThan(0);
		}
	});

	it('contains expected common languages', () => {
		expect(languageEmojis.eng).toBeDefined();
		expect(languageEmojis.spa).toBeDefined();
		expect(languageEmojis.fre).toBeDefined();
		expect(languageEmojis.ger).toBeDefined();
		expect(languageEmojis.jpn).toBeDefined();
		expect(languageEmojis.kor).toBeDefined();
		expect(languageEmojis.chi).toBeDefined();
		expect(languageEmojis.por).toBeDefined();
		expect(languageEmojis.rus).toBeDefined();
		expect(languageEmojis.ara).toBeDefined();
	});

	it('has no duplicate keys', () => {
		const keys = Object.keys(languageEmojis);
		const uniqueKeys = new Set(keys);
		expect(uniqueKeys.size).toBe(keys.length);
	});
});
