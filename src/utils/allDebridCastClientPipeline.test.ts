import { describe, expect, it } from 'vitest';
import {
	findVideoByName,
	pickBiggestVideo,
	selectSortedVideos,
} from './allDebridCastClientPipeline';

describe('allDebridCastClientPipeline', () => {
	describe('selectSortedVideos', () => {
		it('filters to video extensions and sorts by basename, matching /play/ resolver', () => {
			// Mixed content: scene release with a sample/extras folder and mixed-case/order names.
			const magnetFiles = [
				{ n: 'RARBG.txt', s: 100 },
				{
					n: 'Sample',
					e: [{ n: 'sample-show.S01E01.mkv', s: 10, l: 'https://ad/sample' }],
				},
				{ n: 'show.S01E03.mkv', s: 1000, l: 'https://ad/e03' },
				{ n: 'show.S01E01.mkv', s: 1200, l: 'https://ad/e01' },
				{ n: 'show.S01E02.mkv', s: 1100, l: 'https://ad/e02' },
				{ n: 'cover.jpg', s: 50 },
			];
			const sorted = selectSortedVideos(magnetFiles as any);
			expect(sorted.map((f) => f.path)).toEqual([
				'Sample/sample-show.S01E01.mkv',
				'show.S01E01.mkv',
				'show.S01E02.mkv',
				'show.S01E03.mkv',
			]);
		});

		it('handles empty input', () => {
			expect(selectSortedVideos([])).toEqual([]);
		});
	});

	describe('pickBiggestVideo', () => {
		it('picks the largest file and returns its sorted-index', () => {
			const sorted = [
				{ path: 'a.mkv', size: 500, link: 'l1' },
				{ path: 'b.mkv', size: 2000, link: 'l2' }, // biggest
				{ path: 'c.mkv', size: 800, link: 'l3' },
			];
			const picked = pickBiggestVideo(sorted);
			expect(picked.fileIndex).toBe(1);
			expect(picked.link).toBe('l2');
			expect(picked.filename).toBe('b.mkv');
			expect(picked.fileSize).toBe(Math.round(2000 / 1024 / 1024));
		});
	});

	describe('findVideoByName', () => {
		const sorted = [
			{ path: 'Show/Show.S01E01.mkv', size: 10, link: 'l1' },
			{ path: 'Show/Show.S01E02.mkv', size: 11, link: 'l2' },
			{ path: 'Show/Show.S01E03.mkv', size: 12, link: 'l3' },
		];

		it('matches basename case-insensitively and returns correct index + parsed episode', () => {
			const f = findVideoByName(sorted, 'Show.S01E02.mkv');
			expect(f?.fileIndex).toBe(1);
			expect(f?.link).toBe('l2');
			expect(f?.filename).toBe('Show.S01E02.mkv');
			expect(f?.season).toBe(1);
			expect(f?.episode).toBe(2);
		});

		it('handles full path input by matching on basename', () => {
			const f = findVideoByName(sorted, 'Other/Show.S01E03.mkv');
			expect(f?.fileIndex).toBe(2);
		});

		it('returns null when no match', () => {
			expect(findVideoByName(sorted, 'missing.mkv')).toBeNull();
		});
	});
});
