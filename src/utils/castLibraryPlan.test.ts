import outerLimits from '@/test/fixtures/internetArchive/outer-limits-s2-archive-torrent.json';
import { isVideo } from '@/utils/selectable';
import { describe, expect, it } from 'vitest';
import { oneFilePerEpisode, planLibraryCast } from './castLibraryPlan';

type F = { name: string; size: number };
const describeFile = (f: F) => ({ filename: f.name, size: f.size });
const plan = (files: F[]) => planLibraryCast('tt123', files, describeFile);

describe('planLibraryCast', () => {
	it('gives every episode its own Stremio key', () => {
		expect(
			plan([
				{ name: 'Show.S01E01.mkv', size: 10 },
				{ name: 'Show.S01E02.mkv', size: 10 },
			]).map((p) => p.stremioKey)
		).toEqual(['tt123:1:1', 'tt123:1:2']);
	});

	// Regression: the cast tables are unique on (imdbId, userId, hash), so every
	// file without a :season:episode suffix landed on the bare imdb id and the
	// loop overwrote its own previous write. A 102-stream BDMV left one row.
	it('writes one row for a movie that ships with extras, and it is the feature', () => {
		const result = plan([
			{ name: 'Trailer.mkv', size: 200 },
			{ name: 'Movie.2019.2160p.mkv', size: 90_000 },
			{ name: 'Behind.The.Scenes.mkv', size: 800 },
		]);

		expect(result).toHaveLength(1);
		expect(result[0].stremioKey).toBe('tt123');
		expect(result[0].file.name).toBe('Movie.2019.2160p.mkv');
	});

	it('does not let a stray extra overwrite an episode', () => {
		const result = plan([
			{ name: 'Show.S01E01.mkv', size: 10 },
			{ name: 'readme-sample.mkv', size: 1 },
		]);

		expect(result.map((p) => p.stremioKey).sort()).toEqual(['tt123', 'tt123:1:1']);
	});

	// `info.season && info.episode` reads 0 as absent, which drops specials onto
	// the movie key alongside everything else.
	it('keeps specials numbered from zero on their own key', () => {
		expect(plan([{ name: 'Show.S00E01.mkv', size: 10 }])[0].stremioKey).toBe('tt123:0:1');
	});

	it('returns nothing for an empty file list', () => {
		expect(plan([])).toEqual([]);
	});

	it('matches on the basename, not the directory', () => {
		expect(plan([{ name: 'Show.S02.1080p/Show.S02E07.mkv', size: 10 }])[0].stremioKey).toBe(
			'tt123:2:7'
		);
	});

	// Regression: an Internet Archive torrent carries every uploaded episode next
	// to the compressed .mp4 the Archive derives from it, under the same name. Both
	// parse to the same episode, so both were written to the same key and the
	// second write - the derivative, which sorts after the .mkv - replaced the
	// source. The release is the real torrent of an Archive season upload.
	it('casts the source episode, not the compressed copy the Archive derives from it', () => {
		const videos = outerLimits.files.filter((f) => isVideo({ path: f.path }));
		const result = planLibraryCast(outerLimits.imdbId, videos, (f) => ({
			filename: f.path,
			size: f.bytes,
		}));

		expect(result).toHaveLength(17);
		expect(new Set(result.map((p) => p.stremioKey)).size).toBe(17);
		for (const { file } of result) {
			expect(file.iaSource).toBe('original');
			expect(file.path).toMatch(/\.mkv$/);
		}
		expect(result.find((p) => p.stremioKey === 'tt0056777:2:1')?.file.id).toBe(9);
	});
});

describe('oneFilePerEpisode', () => {
	const describeFile = (f: F) => ({ filename: f.name, size: f.size });

	it('keeps the biggest file of each episode, wherever it sits in the list', () => {
		const kept = oneFilePerEpisode(
			[
				{ name: 'Show.S01E01.mp4', size: 300 },
				{ name: 'Show.S01E01.mkv', size: 400 },
				{ name: 'Show.S01E02.mkv', size: 410 },
				{ name: 'Show.S01E02.mp4', size: 290 },
			],
			describeFile
		);

		expect(kept.map((f) => f.name)).toEqual(['Show.S01E01.mkv', 'Show.S01E02.mkv']);
	});

	it('passes files with no episode through for the caller to decide', () => {
		const kept = oneFilePerEpisode(
			[
				{ name: 'Show.S01E01.mkv', size: 400 },
				{ name: 'Trailer.mkv', size: 10 },
				{ name: 'Featurette.mkv', size: 20 },
			],
			describeFile
		);

		expect(kept.map((f) => f.name)).toEqual([
			'Show.S01E01.mkv',
			'Trailer.mkv',
			'Featurette.mkv',
		]);
	});
});
