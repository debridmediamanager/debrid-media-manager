import { SearchResult } from '@/services/mediasearch';
import { describe, expect, it } from 'vitest';
import {
	borderColor,
	btnColor,
	btnIcon,
	btnLabel,
	fileSize,
	sortByBiggest,
	sortByMean,
	torrentPrefix,
	totalFileSize,
} from './results';

describe('results utils', () => {
	describe('borderColor', () => {
		it('returns green border for downloaded torrents', () => {
			expect(borderColor(true, false)).toBe('border-green-400 border-4');
		});

		it('returns red border for downloading torrents', () => {
			expect(borderColor(false, true)).toBe('border-red-400 border-4');
		});

		it('returns black border for normal torrents', () => {
			expect(borderColor(false, false)).toBe('border-black border-2');
		});

		it('prioritizes downloaded over downloading', () => {
			expect(borderColor(true, true)).toBe('border-green-400 border-4');
		});
	});

	describe('fileSize', () => {
		it('converts bytes to MB and formats to 2 decimals', () => {
			expect(fileSize(1024)).toBe('1.00');
			expect(fileSize(2048)).toBe('2.00');
			expect(fileSize(1536)).toBe('1.50');
		});

		it('handles zero size', () => {
			expect(fileSize(0)).toBe('0.00');
		});

		it('handles large file sizes', () => {
			expect(fileSize(10240000)).toBe('10000.00');
		});
	});

	describe('totalFileSize', () => {
		const result = (over: Partial<SearchResult> = {}) =>
			({
				fileSize: 0,
				files: [],
				biggestFileSize: 0,
				...over,
			}) as SearchResult;

		it('uses the reported size when there is one', () => {
			expect(totalFileSize(result({ fileSize: 4096, biggestFileSize: 3000 }))).toBe(4096);
		});

		it('falls back to the summed debrid file bytes when the size is missing', () => {
			expect(
				totalFileSize(
					result({
						files: [
							{ fileId: 0, filename: 'a.mkv', filesize: 1024 * 1024 * 100 },
							{ fileId: 1, filename: 'b.mkv', filesize: 1024 * 1024 * 50 },
						],
					})
				)
			).toBe(150);
		});

		it('falls back to biggestFileSize when there are no files either', () => {
			expect(totalFileSize(result({ biggestFileSize: 2048 }))).toBe(2048);
		});

		it('returns 0 when nothing is known', () => {
			expect(totalFileSize(result())).toBe(0);
		});

		it('tolerates a missing files array', () => {
			expect(totalFileSize(result({ files: undefined, biggestFileSize: 512 }))).toBe(512);
		});
	});

	describe('btnColor', () => {
		it('returns green for available torrents', () => {
			expect(btnColor(true, false)).toBe('green');
		});

		it('returns gray for torrents with no videos', () => {
			expect(btnColor(false, true)).toBe('gray');
		});

		it('returns blue for normal torrents', () => {
			expect(btnColor(false, false)).toBe('blue');
		});

		it('prioritizes available status', () => {
			expect(btnColor(true, true)).toBe('green');
		});
	});

	describe('torrentPrefix', () => {
		it('returns RD badge for RealDebrid torrents', () => {
			const result = torrentPrefix('rd:12345');
			expect(result.props.className).toContain('bg-[#b5d496]');
			expect(result.props.children).toBe('RD');
		});

		it('returns TB badge for TorBox torrents', () => {
			const result = torrentPrefix('tb:12345');
			expect(result.props.className).toContain('bg-[#4f46e5]');
			expect(result.props.children).toBe('TB');
		});

		it('returns AD badge for AllDebrid torrents', () => {
			const result = torrentPrefix('ad:12345');
			expect(result.props.className).toContain('bg-[#fbc730]');
			expect(result.props.children).toBe('AD');
		});

		it('defaults to AD badge for unknown prefix', () => {
			const result = torrentPrefix('unknown:12345');
			expect(result.props.className).toContain('bg-[#fbc730]');
		});
	});

	describe('btnIcon', () => {
		it('returns Zap icon for available torrents', () => {
			const result = btnIcon(true);
			expect(result.type.displayName).toBe('Zap');
		});

		it('returns Download icon for unavailable torrents', () => {
			const result = btnIcon(false);
			expect(result.type.displayName).toBe('Download');
		});
	});

	describe('btnLabel', () => {
		it('returns instant label for available torrents', () => {
			const result = btnLabel(true, 'RD');
			expect(result).not.toBe('string');
			if (typeof result !== 'string') {
				expect(result.props.children).toEqual(['Instant ', 'RD']);
			}
		});

		it('returns download label for unavailable torrents', () => {
			const result = btnLabel(false, 'RD');
			expect(result).toBe('DL with RD');
		});

		it('handles different service names', () => {
			const result = btnLabel(true, 'TorBox');
			expect(result).not.toBe('string');
			if (typeof result !== 'string') {
				expect(result.props.children).toEqual(['Instant ', 'TorBox']);
			}
		});
	});

	// Sorting spec: cached rows first, then uncached, always biggest to smallest.
	// Cached rows rank on the biggest video file (movies) or the mean video file
	// (shows); uncached rows rank on the total torrent size in both.
	const searchResult = (overrides: Partial<SearchResult>): SearchResult =>
		({
			hash: 'hash',
			title: 'Title',
			fileSize: 0,
			rdAvailable: false,
			adAvailable: false,
			tbAvailable: false,
			files: [],
			noVideos: false,
			medianFileSize: 0,
			biggestFileSize: 0,
			videoCount: 0,
			...overrides,
		}) as SearchResult;

	describe('sortByMean', () => {
		it('sorts available torrents before unavailable ones, however big', () => {
			const results = [
				searchResult({ hash: 'uncached', fileSize: 100_000, videoCount: 10 }),
				searchResult({ hash: 'cached', rdAvailable: true, fileSize: 500, videoCount: 10 }),
			];

			expect(sortByMean(results).map((r) => r.hash)).toEqual(['cached', 'uncached']);
		});

		it('ranks available torrents by mean video size, not by total', () => {
			const results = [
				// bigger pack, but 20 episodes - the smaller mean
				searchResult({
					hash: 'big-pack',
					rdAvailable: true,
					fileSize: 40_000,
					videoCount: 20,
					meanFileSize: 2_000,
				}),
				searchResult({
					hash: 'small-pack',
					tbAvailable: true,
					fileSize: 30_000,
					videoCount: 10,
					meanFileSize: 3_000,
				}),
			];

			expect(sortByMean(results).map((r) => r.hash)).toEqual(['small-pack', 'big-pack']);
		});

		it('falls back to total over video count when no check has run yet', () => {
			const results = [
				searchResult({ hash: 'ten', adAvailable: true, fileSize: 10_000, videoCount: 10 }),
				searchResult({ hash: 'two', adAvailable: true, fileSize: 4_000, videoCount: 2 }),
			];

			expect(sortByMean(results).map((r) => r.hash)).toEqual(['two', 'ten']);
		});

		it('ranks unavailable torrents by total size, ignoring per-file stats', () => {
			const results = [
				searchResult({
					hash: 'small-total',
					fileSize: 5_000,
					videoCount: 1,
					meanFileSize: 5_000,
				}),
				searchResult({
					hash: 'big-total',
					fileSize: 50_000,
					videoCount: 20,
					meanFileSize: 2_500,
				}),
			];

			expect(sortByMean(results).map((r) => r.hash)).toEqual(['big-total', 'small-total']);
		});

		it('sorts by video count when sizes are equal', () => {
			const results = [
				searchResult({ hash: 'ten', rdAvailable: true, fileSize: 1_000, videoCount: 10 }),
				searchResult({
					hash: 'twenty',
					rdAvailable: true,
					fileSize: 2_000,
					videoCount: 20,
				}),
			];

			expect(sortByMean(results)[0].videoCount).toBe(20);
		});

		it('sorts alphabetically when all other factors are equal', () => {
			const results = [
				searchResult({
					title: 'Zebra',
					rdAvailable: true,
					fileSize: 1_000,
					videoCount: 10,
				}),
				searchResult({
					title: 'Apple',
					rdAvailable: true,
					fileSize: 1_000,
					videoCount: 10,
				}),
			];

			expect(sortByMean(results)[0].title).toBe('Apple');
		});

		it('handles empty titles', () => {
			const results = [
				searchResult({ title: '', rdAvailable: true, fileSize: 1_000, videoCount: 10 }),
				searchResult({ title: 'Test', rdAvailable: true, fileSize: 1_000, videoCount: 10 }),
			];

			// Empty title is sorted first
			expect(sortByMean(results)[0].title).toBe('');
		});

		it('orders a mixed list biggest to smallest within each group', () => {
			const results = [
				searchResult({ hash: 'uncached-small', fileSize: 1_000 }),
				searchResult({
					hash: 'cached-small',
					rdAvailable: true,
					fileSize: 2_000,
					videoCount: 2,
					meanFileSize: 1_000,
				}),
				searchResult({ hash: 'uncached-big', fileSize: 90_000 }),
				searchResult({
					hash: 'cached-big',
					tbAvailable: true,
					fileSize: 8_000,
					videoCount: 2,
					meanFileSize: 4_000,
				}),
			];

			expect(sortByMean(results).map((r) => r.hash)).toEqual([
				'cached-big',
				'cached-small',
				'uncached-big',
				'uncached-small',
			]);
		});
	});

	describe('sortByBiggest', () => {
		it('sorts available torrents before unavailable ones, however big', () => {
			const results = [
				searchResult({ hash: 'uncached', fileSize: 100_000, biggestFileSize: 100_000 }),
				searchResult({ hash: 'cached', rdAvailable: true, biggestFileSize: 500 }),
			];

			expect(sortByBiggest(results).map((r) => r.hash)).toEqual(['cached', 'uncached']);
		});

		it('ranks available torrents by biggest video file, not by total', () => {
			const results = [
				// bigger torrent overall, but its biggest single file is smaller
				searchResult({
					hash: 'many-files',
					rdAvailable: true,
					fileSize: 40_000,
					videoCount: 8,
					biggestFileSize: 6_000,
				}),
				searchResult({
					hash: 'one-file',
					adAvailable: true,
					fileSize: 20_000,
					videoCount: 1,
					biggestFileSize: 20_000,
				}),
			];

			expect(sortByBiggest(results).map((r) => r.hash)).toEqual(['one-file', 'many-files']);
		});

		it('compares single-file and multi-file torrents in the same unit', () => {
			const results = [
				searchResult({
					hash: 'multi',
					rdAvailable: true,
					fileSize: 9_000,
					videoCount: 5,
					biggestFileSize: 2_000,
				}),
				searchResult({
					hash: 'single',
					rdAvailable: true,
					fileSize: 5_000,
					videoCount: 1,
					biggestFileSize: 5_000,
				}),
			];

			expect(sortByBiggest(results).map((r) => r.hash)).toEqual(['single', 'multi']);
		});

		it('falls back to the total when no check has run yet', () => {
			const results = [
				searchResult({ hash: 'small', rdAvailable: true, fileSize: 1_000 }),
				searchResult({ hash: 'big', rdAvailable: true, fileSize: 2_000 }),
			];

			expect(sortByBiggest(results).map((r) => r.hash)).toEqual(['big', 'small']);
		});

		it('ranks unavailable torrents by total size, ignoring per-file stats', () => {
			const results = [
				searchResult({ hash: 'small-total', fileSize: 9_000, biggestFileSize: 9_000 }),
				searchResult({
					hash: 'big-total',
					fileSize: 60_000,
					videoCount: 10,
					biggestFileSize: 6_500,
				}),
			];

			expect(sortByBiggest(results).map((r) => r.hash)).toEqual(['big-total', 'small-total']);
		});

		it('sorts by hash alphabetically when sizes are equal', () => {
			const results = [
				searchResult({ hash: 'zebra', rdAvailable: true, biggestFileSize: 100 }),
				searchResult({ hash: 'apple', rdAvailable: true, biggestFileSize: 100 }),
			];

			expect(sortByBiggest(results)[0].hash).toBe('apple');
		});

		it('orders a mixed list biggest to smallest within each group', () => {
			const results = [
				searchResult({ hash: 'uncached-small', fileSize: 1_000 }),
				searchResult({ hash: 'cached-small', rdAvailable: true, biggestFileSize: 2_000 }),
				searchResult({ hash: 'uncached-big', fileSize: 90_000 }),
				searchResult({ hash: 'cached-big', tbAvailable: true, biggestFileSize: 8_000 }),
			];

			expect(sortByBiggest(results).map((r) => r.hash)).toEqual([
				'cached-big',
				'cached-small',
				'uncached-big',
				'uncached-small',
			]);
		});
	});
});
