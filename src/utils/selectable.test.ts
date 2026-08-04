import { describe, expect, it } from 'vitest';
import { checkArithmeticSequenceInFilenames, isVideo } from './selectable';

describe('selectable utils', () => {
	it('detects video files by extension and filters common non-video patterns', () => {
		expect(isVideo({ path: 'movie.mkv' })).toBe(true);
		expect(isVideo({ path: 'clip.MP4' })).toBe(true);
		expect(isVideo({ path: '/RARBG/readme.txt' })).toBe(false);
		expect(isVideo({ path: 'sample-trailer.mkv' })).toBe(false);
		expect(isVideo({ path: 'trailer.mov' })).toBe(false);
	});

	it('finds increasing numeric sequences in aligned video filenames', () => {
		const files = ['S01E01.mkv', 'S01E02.mkv', 'S01E03.mkv'];
		expect(checkArithmeticSequenceInFilenames(files)).toBe(true);
	});

	it('does not mistake a movie pack for episodes', () => {
		// release years line up at the same offset just like episode numbers do -
		// sorting a de-duplicated set made the old "increasing" check always pass
		expect(
			checkArithmeticSequenceInFilenames([
				'Movie.2019.1080p.mkv',
				'Movie.2020.1080p.mkv',
				'Movie.2021.1080p.mkv',
			])
		).toBe(false);
		// non-sequential numbers must not count either
		expect(
			checkArithmeticSequenceInFilenames(['Film.1997.mkv', 'Film.2015.mkv', 'Film.2003.mkv'])
		).toBe(false);
		// three unrelated films that only differ by resolution
		expect(
			checkArithmeticSequenceInFilenames([
				'AAA.720p.x264.mkv',
				'BBB.108p.x264.mkv',
				'CCC.480p.x264.mkv',
			])
		).toBe(false);
	});

	it('still detects a real episode run', () => {
		expect(
			checkArithmeticSequenceInFilenames(['Show.E08.mkv', 'Show.E09.mkv', 'Show.E10.mkv'])
		).toBe(true);
	});

	it('returns false when files are fewer than three or not aligned', () => {
		expect(checkArithmeticSequenceInFilenames(['a.mkv', 'b.mkv'])).toBe(false);
		// Numbers present but not aligned at same index across names
		const files = ['ep1_file.mkv', 'file_ep2.mkv', 'another3.mkv'];
		expect(checkArithmeticSequenceInFilenames(files)).toBe(false);
	});
});
