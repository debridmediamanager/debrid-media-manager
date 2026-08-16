import { describe, expect, it } from 'vitest';
import {
	flattenAndRemoveDuplicates,
	hasSubstantialTitle,
	ScrapeSearchResult,
	sortByFileSize,
} from './mediasearch';

describe('mediasearch service', () => {
	describe('flattenAndRemoveDuplicates', () => {
		it('flattens nested arrays into a single array', () => {
			const input: ScrapeSearchResult[][] = [
				[
					{ title: 'Movie 1', fileSize: 1000, hash: 'a'.repeat(40) },
					{ title: 'Movie 2', fileSize: 2000, hash: 'b'.repeat(40) },
				],
				[{ title: 'Movie 3', fileSize: 3000, hash: 'c'.repeat(40) }],
			];

			const result = flattenAndRemoveDuplicates(input);

			expect(result).toHaveLength(3);
			expect(result[0].title).toBe('Movie 1');
			expect(result[1].title).toBe('Movie 2');
			expect(result[2].title).toBe('Movie 3');
		});

		it('drops degenerate hashes that are still well-formed hex', () => {
			// sha1 of the empty string. Scrapers emit it for rows that carry no
			// magnet at all, and it was stored as a torrent hash on 2110 pages.
			const emptySha1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
			const input: ScrapeSearchResult[][] = [
				[
					{ title: 'Real Movie', fileSize: 1000, hash: 'a'.repeat(40) },
					{ title: 'No magnet at all', fileSize: 2000, hash: emptySha1 },
					{ title: 'All zeroes', fileSize: 3000, hash: '0'.repeat(40) },
				],
			];

			const result = flattenAndRemoveDuplicates(input);

			expect(result.map((r) => r.hash)).toEqual(['a'.repeat(40)]);
		});

		it('removes duplicate hashes keeping first occurrence', () => {
			const duplicateHash = 'a'.repeat(40);
			const input: ScrapeSearchResult[][] = [
				[
					{ title: 'Movie 1', fileSize: 1000, hash: duplicateHash },
					{ title: 'Movie 2', fileSize: 2000, hash: 'b'.repeat(40) },
				],
				[{ title: 'Movie 1 Duplicate', fileSize: 3000, hash: duplicateHash }],
			];

			const result = flattenAndRemoveDuplicates(input);

			expect(result).toHaveLength(2);
			expect(result.find((r) => r.hash === duplicateHash)?.title).toBe('Movie 1');
		});

		it('filters out invalid hashes (not 40 hex characters)', () => {
			const input: ScrapeSearchResult[][] = [
				[
					{ title: 'Valid', fileSize: 1000, hash: 'a'.repeat(40) },
					{ title: 'Invalid - Too short', fileSize: 2000, hash: 'abc123' },
					{ title: 'Invalid - Not hex', fileSize: 3000, hash: 'z'.repeat(40) },
					{ title: 'Invalid - Uppercase', fileSize: 4000, hash: 'A'.repeat(40) },
				],
			];

			const result = flattenAndRemoveDuplicates(input);

			expect(result).toHaveLength(1);
			expect(result[0].title).toBe('Valid');
		});

		it('handles empty arrays', () => {
			const result = flattenAndRemoveDuplicates([]);
			expect(result).toEqual([]);
		});

		it('handles arrays with empty sub-arrays', () => {
			const input: ScrapeSearchResult[][] = [[], [], []];
			const result = flattenAndRemoveDuplicates(input);
			expect(result).toEqual([]);
		});

		it('preserves all unique valid hashes', () => {
			const input: ScrapeSearchResult[][] = [
				[
					{ title: 'Movie 1', fileSize: 1000, hash: '1'.repeat(40) },
					{ title: 'Movie 2', fileSize: 2000, hash: '2'.repeat(40) },
				],
				[
					{ title: 'Movie 3', fileSize: 3000, hash: 'a'.repeat(40) },
					{ title: 'Movie 4', fileSize: 4000, hash: 'b'.repeat(40) },
				],
			];

			const result = flattenAndRemoveDuplicates(input);

			expect(result).toHaveLength(4);
		});
	});

	describe('sortByFileSize', () => {
		it('sorts results by file size in descending order', () => {
			const input: ScrapeSearchResult[] = [
				{ title: 'Small', fileSize: 1000, hash: 'a'.repeat(40) },
				{ title: 'Large', fileSize: 5000, hash: 'b'.repeat(40) },
				{ title: 'Medium', fileSize: 3000, hash: 'c'.repeat(40) },
			];

			const result = sortByFileSize(input);

			expect(result[0].title).toBe('Large');
			expect(result[0].fileSize).toBe(5000);
			expect(result[1].title).toBe('Medium');
			expect(result[1].fileSize).toBe(3000);
			expect(result[2].title).toBe('Small');
			expect(result[2].fileSize).toBe(1000);
		});

		it('handles already sorted arrays', () => {
			const input: ScrapeSearchResult[] = [
				{ title: 'Large', fileSize: 5000, hash: 'a'.repeat(40) },
				{ title: 'Medium', fileSize: 3000, hash: 'b'.repeat(40) },
				{ title: 'Small', fileSize: 1000, hash: 'c'.repeat(40) },
			];

			const result = sortByFileSize(input);

			expect(result[0].fileSize).toBe(5000);
			expect(result[1].fileSize).toBe(3000);
			expect(result[2].fileSize).toBe(1000);
		});

		it('handles arrays with equal file sizes', () => {
			const input: ScrapeSearchResult[] = [
				{ title: 'A', fileSize: 2000, hash: 'a'.repeat(40) },
				{ title: 'B', fileSize: 2000, hash: 'b'.repeat(40) },
				{ title: 'C', fileSize: 2000, hash: 'c'.repeat(40) },
			];

			const result = sortByFileSize(input);

			expect(result).toHaveLength(3);
			result.forEach((r) => expect(r.fileSize).toBe(2000));
		});

		it('handles empty arrays', () => {
			const result = sortByFileSize([]);
			expect(result).toEqual([]);
		});

		it('handles single item arrays', () => {
			const input: ScrapeSearchResult[] = [
				{ title: 'Only', fileSize: 1000, hash: 'a'.repeat(40) },
			];

			const result = sortByFileSize(input);

			expect(result).toHaveLength(1);
			expect(result[0].title).toBe('Only');
		});

		it('mutates the original array', () => {
			const input: ScrapeSearchResult[] = [
				{ title: 'Small', fileSize: 1000, hash: 'a'.repeat(40) },
				{ title: 'Large', fileSize: 5000, hash: 'b'.repeat(40) },
			];

			const result = sortByFileSize(input);

			expect(result).toBe(input); // Same reference
			expect(input[0].title).toBe('Large');
		});
	});

	describe('hasSubstantialTitle', () => {
		it('rejects empty/blank titles', () => {
			expect(hasSubstantialTitle('')).toBe(false);
			expect(hasSubstantialTitle('  ')).toBe(false);
			expect(hasSubstantialTitle(undefined as any)).toBe(false);
		});

		it('rejects titles that are only resolution tags', () => {
			expect(hasSubstantialTitle('1080p')).toBe(false);
			expect(hasSubstantialTitle('720p')).toBe(false);
			expect(hasSubstantialTitle('2160p')).toBe(false);
			expect(hasSubstantialTitle('4k')).toBe(false);
			expect(hasSubstantialTitle('4K')).toBe(false);
		});

		it('rejects titles that are only codec/quality tags', () => {
			expect(hasSubstantialTitle('x265')).toBe(false);
			expect(hasSubstantialTitle('H.265')).toBe(false);
			expect(hasSubstantialTitle('HEVC')).toBe(false);
			expect(hasSubstantialTitle('WEB-DL')).toBe(false);
			expect(hasSubstantialTitle('BluRay')).toBe(false);
		});

		it('rejects titles that are combinations of only technical tags', () => {
			expect(hasSubstantialTitle('1080p.WEB-DL')).toBe(false);
			expect(hasSubstantialTitle('720p x265 AAC')).toBe(false);
			expect(hasSubstantialTitle('2160p.HDR10.HEVC')).toBe(false);
			expect(hasSubstantialTitle('4K REMUX')).toBe(false);
		});

		it('accepts normal torrent titles', () => {
			expect(hasSubstantialTitle('Galaxy.Quest.1999.1080p.BluRay.x264-Group')).toBe(true);
			expect(hasSubstantialTitle('Breaking Bad S01E01 720p WEB-DL')).toBe(true);
			expect(hasSubstantialTitle('The Office S05E03')).toBe(true);
			expect(hasSubstantialTitle('Inception 2010')).toBe(true);
			expect(hasSubstantialTitle('S01E01 My Episode Title')).toBe(true);
		});

		it('accepts titles with numeric show names + season/episode codes', () => {
			expect(hasSubstantialTitle('24 S01E01')).toBe(true);
			expect(hasSubstantialTitle('1883 S01E01')).toBe(true);
			expect(hasSubstantialTitle('S01E01')).toBe(true);
			expect(hasSubstantialTitle('24.S01E01.720p.WEB-DL')).toBe(true);
		});
	});
});
