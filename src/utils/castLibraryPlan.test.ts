import { describe, expect, it } from 'vitest';
import { planLibraryCast } from './castLibraryPlan';

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
});
