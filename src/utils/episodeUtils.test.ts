import { describe, expect, it } from 'vitest';
import {
	getColorScale,
	getEpisodeCountClass,
	getEpisodeCountLabel,
	getExpectedEpisodeCount,
	getQueryForEpisodeCount,
} from './episodeUtils';

describe('episodeUtils', () => {
	describe('getColorScale', () => {
		it('returns correct color scale for given episode count', () => {
			const scale = getColorScale(10);
			expect(scale).toEqual([
				{ threshold: 1, color: 'gray-800', label: 'Single' },
				{ threshold: 9, color: 'purple-800', label: 'Incomplete' },
				{ threshold: 10, color: 'green-900', label: 'Complete' },
				{ threshold: Infinity, color: 'blue-900', label: 'With extras' },
			]);
		});

		it('handles single episode shows', () => {
			const scale = getColorScale(1);
			expect(scale[1].threshold).toBe(0);
		});
	});

	describe('getQueryForEpisodeCount', () => {
		it('returns single episode query when video count is 1', () => {
			expect(getQueryForEpisodeCount(1, 10)).toBe('videos:1');
		});

		it('returns complete query when video count equals expected', () => {
			expect(getQueryForEpisodeCount(10, 10)).toBe('videos:10');
		});

		it('returns incomplete query when video count is less than expected', () => {
			expect(getQueryForEpisodeCount(5, 10)).toBe('videos:>1 videos:<10');
		});

		it('returns with extras query when video count exceeds expected', () => {
			expect(getQueryForEpisodeCount(15, 10)).toBe('videos:>10');
		});

		it('handles edge case with 2 videos', () => {
			expect(getQueryForEpisodeCount(2, 10)).toBe('videos:>1 videos:<10');
		});
	});

	describe('getEpisodeCountClass', () => {
		it('returns empty string when torrent is not instantly available', () => {
			expect(getEpisodeCountClass(10, 10, false)).toBe('');
		});

		it('returns gray class for single episode when available', () => {
			expect(getEpisodeCountClass(1, 10, true)).toBe('bg-gray-800/30');
		});

		it('returns purple class for incomplete pack when available', () => {
			expect(getEpisodeCountClass(5, 10, true)).toBe('bg-purple-800/30');
		});

		it('returns green class for complete pack when available', () => {
			expect(getEpisodeCountClass(10, 10, true)).toBe('bg-green-900/30');
		});

		it('returns blue class for pack with extras when available', () => {
			expect(getEpisodeCountClass(15, 10, true)).toBe('bg-blue-900/30');
		});

		it('returns purple class for edge case at expected - 1', () => {
			expect(getEpisodeCountClass(9, 10, true)).toBe('bg-purple-800/30');
		});
	});

	describe('getEpisodeCountLabel', () => {
		it('returns Single label for single episode', () => {
			expect(getEpisodeCountLabel(1, 10)).toBe('Single');
		});

		it('returns Incomplete label for less than expected episodes', () => {
			expect(getEpisodeCountLabel(5, 10)).toBe('Incomplete (5/10)');
		});

		it('returns Complete label when count matches expected', () => {
			expect(getEpisodeCountLabel(10, 10)).toBe('Complete (10/10)');
		});

		it('returns With extras label when count exceeds expected', () => {
			expect(getEpisodeCountLabel(15, 10)).toBe('With extras (15/10)');
		});

		it('handles edge case with 2 videos', () => {
			expect(getEpisodeCountLabel(2, 10)).toBe('Incomplete (2/10)');
		});
	});

	describe('getExpectedEpisodeCount', () => {
		it('returns count from map when season number is provided', () => {
			const counts = { 1: 24, 2: 13, 3: 22 };
			expect(getExpectedEpisodeCount('1', counts)).toBe(24);
			expect(getExpectedEpisodeCount('2', counts)).toBe(13);
			expect(getExpectedEpisodeCount('3', counts)).toBe(22);
		});

		it('returns default 13 when season number is not in map', () => {
			const counts = { 1: 24 };
			expect(getExpectedEpisodeCount('5', counts)).toBe(13);
		});

		it('returns default 13 when seasonNum is undefined', () => {
			const counts = { 1: 24 };
			expect(getExpectedEpisodeCount(undefined, counts)).toBe(13);
		});

		it('handles string season numbers correctly', () => {
			const counts = { 1: 10, 2: 20 };
			expect(getExpectedEpisodeCount('1', counts)).toBe(10);
		});

		it('handles zero in counts map', () => {
			const counts = { 0: 5, 1: 10 };
			expect(getExpectedEpisodeCount('0', counts)).toBe(5);
		});
	});
});
