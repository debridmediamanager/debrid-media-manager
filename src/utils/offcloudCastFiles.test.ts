import { describe, expect, it } from 'vitest';
import { matchOffcloudFile, offcloudFilePath, offcloudVideoFiles } from './offcloudCastFiles';

describe('offcloudFilePath', () => {
	it('joins the folder cache/info reports to the filename', () => {
		expect(offcloudFilePath('Show.S01E01.mkv', 'Show.S01')).toBe('Show.S01/Show.S01E01.mkv');
	});

	it('falls back to the bare name when explore gave no folder', () => {
		expect(offcloudFilePath('Movie.mkv')).toBe('Movie.mkv');
		expect(offcloudFilePath('Movie.mkv', '')).toBe('Movie.mkv');
		expect(offcloudFilePath('Movie.mkv', '.')).toBe('Movie.mkv');
	});

	it('does not double up a folder that is already the full path', () => {
		expect(offcloudFilePath('Show.S01E01.mkv', 'Show.S01/Show.S01E01.mkv')).toBe(
			'Show.S01/Show.S01E01.mkv'
		);
	});

	it('normalises stray slashes', () => {
		expect(offcloudFilePath('/Movie.mkv', '/Release/')).toBe('Release/Movie.mkv');
	});
});

describe('offcloudVideoFiles', () => {
	// cloud/explore returns Offcloud's own order, so a first-file pick hands the
	// user whatever sorts first - a poster in the reference release.
	it('sorts video files largest first and drops non-video', () => {
		const files = offcloudVideoFiles([
			{ filename: 'poster.jpg', size: 310_380, link: 'https://cdn/p' },
			{ filename: 'Movie.mkv', size: 276_134_947, link: 'https://cdn/m' },
			{ filename: 'Movie.Featurette.mkv', size: 40_000, link: 'https://cdn/s' },
			{ filename: 'subs.srt', size: 140, link: 'https://cdn/sub' },
		]);

		expect(files.map((file) => file.filename)).toEqual(['Movie.mkv', 'Movie.Featurette.mkv']);
	});

	// A cache/info listing has names and sizes but no links; an explore listing
	// has links but may have no sizes. Both go through the same shape.
	it('accepts a listing with no links and one with no sizes', () => {
		expect(offcloudVideoFiles([{ filename: 'A.mkv', folder: 'R', size: 5 }])).toEqual([
			{ path: 'R/A.mkv', filename: 'A.mkv', size: 5, link: null },
		]);
		expect(
			offcloudVideoFiles([{ filename: 'A.mkv', link: 'https://cdn/a', size: null }])
		).toEqual([{ path: 'A.mkv', filename: 'A.mkv', size: 0, link: 'https://cdn/a' }]);
	});

	it('reports the basename even when the folder is part of the name', () => {
		const [file] = offcloudVideoFiles([{ filename: 'Season 1/Ep1.mkv', size: 1 }]);
		expect(file.filename).toBe('Ep1.mkv');
		expect(file.path).toBe('Season 1/Ep1.mkv');
	});
});

describe('matchOffcloudFile', () => {
	const files = offcloudVideoFiles([
		{ filename: 'Show.S01E01.mkv', folder: 'Show.S01', size: 500, link: 'https://cdn/e1' },
		{ filename: 'Show.S01E02.mkv', folder: 'Show.S01', size: 100, link: 'https://cdn/e2' },
	]);

	it('matches the stored path exactly', () => {
		expect(matchOffcloudFile(files, 'Show.S01/Show.S01E02.mkv')?.link).toBe('https://cdn/e2');
	});

	// A re-resolve through cloud/explore alone carries no folder, so the stored
	// path will not match and only the basename can.
	it('falls back to the basename when the folder is gone', () => {
		const flat = offcloudVideoFiles([
			{ filename: 'Show.S01E02.mkv', size: 100, link: 'https://cdn/flat' },
		]);
		expect(matchOffcloudFile(flat, 'Show.S01/Show.S01E02.mkv')?.link).toBe('https://cdn/flat');
	});

	it('returns the biggest file when nothing was asked for', () => {
		expect(matchOffcloudFile(files, null)?.link).toBe('https://cdn/e1');
	});

	it('returns nothing rather than a neighbour when the file is not there', () => {
		expect(matchOffcloudFile(files, 'Show.S09E99.mkv')).toBeUndefined();
	});
});
