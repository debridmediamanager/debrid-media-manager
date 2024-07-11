import { describe, expect, it } from 'vitest';
import { flexEq } from './checks';

describe('flexEq', () => {
	it('should return true for basic equality check without spaces', () => {
		const test = 'exampleMovieTitle';
		const target = 'example Movie Title';
		const targetYears = ['2023'];
		expect(flexEq(test, target, targetYears)).toBe(true);
	});

	it('should return true for check with repeated characters', () => {
		const test = 'exampleeMovieeTitlee';
		const target = 'example Movie Title';
		const targetYears = ['2023'];
		expect(flexEq(test, target, targetYears)).toBe(true);
	});

	it('should return true for check with diacritics', () => {
		const test = 'exampléMovieTitle';
		const target = 'example Movie Title';
		const targetYears = ['2023'];
		expect(flexEq(test, target, targetYears)).toBe(true);
	});

	it('should return true for filename with year', () => {
		const test = 'exampleMovieTitle2023';
		const target = 'example Movie Title';
		const targetYears = ['2023'];
		expect(flexEq(test, target, targetYears)).toBe(true);
	});

	it('should return false for different titles', () => {
		const test = 'anotherMovieTitle';
		const target = 'example Movie Title';
		const targetYears = ['2023'];
		expect(flexEq(test, target, targetYears)).toBe(false);
	});

	it('should return true for target containing non-English characters', () => {
		const test = 'exampleMovieTitle';
		const target = 'exámplé Mòvîè Tîtle';
		const targetYears = ['2023'];
		expect(flexEq(test, target, targetYears)).toBe(true);
	});

	it('should return false for short target string that dont match', () => {
		const test = 'exMoTi';
		const target = 'ex Mo Ti';
		const targetYears = ['2023'];
		expect(flexEq(test, target, targetYears)).toBe(false);
	});

	it('should return true for year in filename but not in target', () => {
		const test = 'movieTitle2023';
		const target = 'movie Title';
		const targetYears = ['2023'];
		expect(flexEq(test, target, targetYears)).toBe(true);
	});
});
