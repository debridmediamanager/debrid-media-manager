import { describe, expect, it } from 'vitest';
import { episodeRanges, progressLabel } from './wantedProgress';

describe('progressLabel', () => {
	it('names up to two missing episodes and counts more', () => {
		expect(progressLabel(undefined)).toBe('');
		expect(progressLabel([])).toBe('');
		expect(progressLabel([{ season: 1, have: 10, missing: [] }])).toBe('10/10');
		expect(progressLabel([{ season: 1, have: 9, missing: [7] }])).toBe('9/10 · S01E07 missing');
		expect(
			progressLabel([
				{ season: 1, have: 9, missing: [7] },
				{ season: 12, have: 0, missing: [1] },
			])
		).toBe('9/11 · S01E07, S12E01 missing');
		expect(
			progressLabel([
				{ season: 1, have: 3, missing: Array.from({ length: 1200 }, (_, i) => i) },
			])
		).toBe('3/1203 · 1,200 missing');
	});
});

describe('episodeRanges', () => {
	it('folds runs of episodes', () => {
		expect(episodeRanges([3, 1, 2, 7, 9, 10])).toBe('1-3, 7, 9-10');
		expect(episodeRanges([])).toBe('');
	});
});
