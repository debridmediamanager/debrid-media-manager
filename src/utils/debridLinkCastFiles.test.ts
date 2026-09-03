import { describe, expect, it } from 'vitest';
import { debridLinkVideoFiles, matchDebridLinkFile } from './debridLinkCastFiles';

describe('debridLinkVideoFiles', () => {
	it('sorts video files largest first and drops non-video', () => {
		const files = debridLinkVideoFiles([
			{
				name: 'poster.jpg',
				size: 310_380,
				downloadUrl: 'https://seed1.debrid.link/dl/a-0/p',
			},
			{
				name: 'Movie.mkv',
				size: 276_134_947,
				downloadUrl: 'https://seed1.debrid.link/dl/a-1/m',
			},
			{
				name: 'Movie.Featurette.mkv',
				size: 40_000,
				downloadUrl: 'https://seed1.debrid.link/dl/a-2/s',
			},
			{ name: 'subs.srt', size: 140, downloadUrl: 'https://seed1.debrid.link/dl/a-3/sub' },
		]);

		expect(files.map((file) => file.filename)).toEqual(['Movie.mkv', 'Movie.Featurette.mkv']);
	});

	// An unfinished torrent lists its files with no `downloadUrl` at all, which
	// has to survive the mapping rather than throw somewhere downstream.
	it('accepts a file with no link and one with no size', () => {
		expect(
			debridLinkVideoFiles([{ name: 'Release/A.mkv', size: 5, downloadPercent: 100 }])
		).toEqual([
			{ path: 'Release/A.mkv', filename: 'A.mkv', size: 5, link: null, percent: 100 },
		]);
		expect(
			debridLinkVideoFiles([
				{
					name: 'A.mkv',
					size: null,
					downloadUrl: 'https://seed1.debrid.link/dl/a-0/A.mkv',
				},
			])
		).toEqual([
			{
				path: 'A.mkv',
				filename: 'A.mkv',
				size: 0,
				link: 'https://seed1.debrid.link/dl/a-0/A.mkv',
				percent: 0,
			},
		]);
	});

	it('reports the basename while keeping the release-relative path', () => {
		const [file] = debridLinkVideoFiles([{ name: 'Season 1/Ep1.mkv', size: 1 }]);
		expect(file.filename).toBe('Ep1.mkv');
		expect(file.path).toBe('Season 1/Ep1.mkv');
	});

	it('normalises stray slashes in a name', () => {
		expect(debridLinkVideoFiles([{ name: '/Release/A.mkv', size: 1 }])[0].path).toBe(
			'Release/A.mkv'
		);
	});

	it('ignores an entry with no name at all', () => {
		expect(debridLinkVideoFiles([{ name: null, size: 5 }, {}])).toEqual([]);
	});
});

describe('matchDebridLinkFile', () => {
	const files = debridLinkVideoFiles([
		{
			name: 'Show.S01/Show.S01E01.mkv',
			size: 500,
			downloadUrl: 'https://seed1.debrid.link/dl/a-0/e1',
		},
		{
			name: 'Show.S01/Show.S01E02.mkv',
			size: 100,
			downloadUrl: 'https://seed1.debrid.link/dl/a-1/e2',
		},
	]);

	it('matches the stored path exactly', () => {
		expect(matchDebridLinkFile(files, 'Show.S01/Show.S01E02.mkv')?.link).toBe(
			'https://seed1.debrid.link/dl/a-1/e2'
		);
	});

	// A release that listed as one ZIP and expanded later can come back with a
	// different path shape than the one that was cast.
	it('falls back to the basename when the folder is gone', () => {
		const flat = debridLinkVideoFiles([
			{
				name: 'Show.S01E02.mkv',
				size: 100,
				downloadUrl: 'https://seed1.debrid.link/dl/b-0/f',
			},
		]);
		expect(matchDebridLinkFile(flat, 'Show.S01/Show.S01E02.mkv')?.link).toBe(
			'https://seed1.debrid.link/dl/b-0/f'
		);
	});

	it('returns the biggest file when nothing was asked for', () => {
		expect(matchDebridLinkFile(files, null)?.link).toBe('https://seed1.debrid.link/dl/a-0/e1');
	});

	it('returns nothing rather than a neighbour when the file is not there', () => {
		expect(matchDebridLinkFile(files, 'Show.S09E99.mkv')).toBeUndefined();
	});
});
