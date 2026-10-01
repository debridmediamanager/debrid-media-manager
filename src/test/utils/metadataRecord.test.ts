import spiritedCinemeta from '@/test/fixtures/metadata/cinemeta-tt0245429-spirited-away.json';
import duneCinemeta from '@/test/fixtures/metadata/cinemeta-tt1160419-dune.json';
import anatomyCinemeta from '@/test/fixtures/metadata/cinemeta-tt17009710-anatomy-of-a-fall.json';
import bakeOffCinemeta from '@/test/fixtures/metadata/cinemeta-tt1877368-great-british-bake-off.json';
import spiritedMdblist from '@/test/fixtures/metadata/mdblist-tt0245429-spirited-away.json';
import duneMdblist from '@/test/fixtures/metadata/mdblist-tt1160419-dune.json';
import anatomyMdblist from '@/test/fixtures/metadata/mdblist-tt17009710-anatomy-of-a-fall.json';
import bakeOffMdblist from '@/test/fixtures/metadata/mdblist-tt1877368-great-british-bake-off.json';
import spiritedOmdb from '@/test/fixtures/metadata/omdb-tt0245429-spirited-away.json';
import duneOmdb from '@/test/fixtures/metadata/omdb-tt1160419-dune.json';
import anatomyOmdb from '@/test/fixtures/metadata/omdb-tt17009710-anatomy-of-a-fall.json';
import bakeOffOmdb from '@/test/fixtures/metadata/omdb-tt1877368-great-british-bake-off.json';
import episodeOmdb from '@/test/fixtures/metadata/omdb-tt21958588-bake-off-episode.json';
import spiritedTmdb from '@/test/fixtures/metadata/tmdb-movie-129-spirited-away.json';
import duneTmdb from '@/test/fixtures/metadata/tmdb-movie-438631-dune.json';
import anatomyTmdb from '@/test/fixtures/metadata/tmdb-movie-915935-anatomy-of-a-fall.json';
import bakeOffTmdb from '@/test/fixtures/metadata/tmdb-tv-34549-great-british-bake-off.json';
import bakeOffTraktLast from '@/test/fixtures/metadata/trakt-last_episode-tt1877368-great-british-bake-off.json';
import spiritedTrakt from '@/test/fixtures/metadata/trakt-movie-tt0245429-spirited-away.json';
import duneTrakt from '@/test/fixtures/metadata/trakt-movie-tt1160419-dune.json';
import anatomyTrakt from '@/test/fixtures/metadata/trakt-movie-tt17009710-anatomy-of-a-fall.json';
import bakeOffTraktSeasons from '@/test/fixtures/metadata/trakt-seasons-tt1877368-great-british-bake-off.json';
import bakeOffTvmaze from '@/test/fixtures/metadata/tvmaze-2950-great-british-bake-off.json';
import {
	episodeRecordFromOmdb,
	mergeMovieRecord,
	mergeShowRecord,
	voteYear,
	yearOf,
} from '@/utils/metadataRecord';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('mergeMovieRecord, on providers captured 2026-09-26', () => {
	// OMDb and Cinemeta answer 2003, the US release; TMDB, Trakt and mdblist
	// answer 2001, the year the release names and Plex use.
	it('gives Spirited Away its original year, not the US release', () => {
		expect(spiritedOmdb.Year).toBe('2003');
		const record = mergeMovieRecord('tt0245429', {
			tmdb: spiritedTmdb,
			trakt: spiritedTrakt,
			mdblist: spiritedMdblist,
			cinemeta: spiritedCinemeta,
			omdb: spiritedOmdb,
		});

		expect(record.year).toBe(2001);
		expect(record.released).toBe('2001-07-20');
		expect(record.title).toBe('Spirited Away');
		expect(record.originalTitle).toBe('千と千尋の神隠し');
		expect(record.aliases).toContain('Sen to Chihiro no Kamikakushi');
		expect(record.ids).toEqual({ imdb: 'tt0245429', tmdb: 129, trakt: 97 });
		expect(record.ratings).toEqual(
			expect.objectContaining({
				imdb: 8.6,
				rottenTomatoes: 96,
				metacritic: 96,
				letterboxd: 4.4,
			})
		);
		expect(record.sources).toEqual(['tmdb', 'trakt', 'mdblist', 'cinemeta', 'omdb']);
	});

	it('gives Anatomy of a Fall 2023, not 2024', () => {
		const record = mergeMovieRecord('tt17009710', {
			tmdb: anatomyTmdb,
			trakt: anatomyTrakt,
			mdblist: anatomyMdblist,
			cinemeta: anatomyCinemeta,
			omdb: anatomyOmdb,
		});
		expect(record.year).toBe(2023);
	});

	// IMDb retitled it; its release names, TMDB and Plex still say "Dune".
	it('keeps Dune’s title and files IMDb’s retitle as an alias', () => {
		const record = mergeMovieRecord('tt1160419', {
			tmdb: duneTmdb,
			trakt: duneTrakt,
			mdblist: duneMdblist,
			cinemeta: duneCinemeta,
			omdb: duneOmdb,
		});
		expect(record.title).toBe('Dune');
		expect(record.aliases).toContain('Dune: Part One');
		expect(record.year).toBe(2021);
	});

	it('falls back to the US-release year only when no original-release source answers', () => {
		const record = mergeMovieRecord('tt0245429', {
			cinemeta: spiritedCinemeta,
			omdb: spiritedOmdb,
		});
		expect(record.year).toBe(2003);
		expect(record.sources).toEqual(['cinemeta', 'omdb']);
	});
});

describe('mergeShowRecord', () => {
	it('merges Bake Off into one airing show with 17 seasons', () => {
		const record = mergeShowRecord('tt1877368', {
			tmdb: bakeOffTmdb,
			mdblist: bakeOffMdblist,
			cinemeta: bakeOffCinemeta,
			omdb: bakeOffOmdb,
			traktSeasons: bakeOffTraktSeasons,
			traktLast: bakeOffTraktLast,
			tvmaze: bakeOffTvmaze,
		});

		expect(record.type).toBe('show');
		expect(record.title).toBe('The Great British Bake Off');
		expect(record.aliases).toContain('The Great British Baking Show');
		expect(record.year).toBe(2010);
		expect(record.seasonCount).toBe(17);
		expect(record.seasons.at(-1)).toEqual({ number: 17, episodes: 10 });
		expect(record.status).toBe('Returning Series');
		expect(record.nextEpisode).toEqual(
			expect.objectContaining({ season_number: 17, episode_number: 2 })
		);
		expect(record.ids).toEqual(
			expect.objectContaining({ imdb: 'tt1877368', tmdb: 34549, tvdb: 184871, tvmaze: 2950 })
		);
	});
});

describe('episodeRecordFromOmdb', () => {
	it('names the series of an episode id', () => {
		expect(episodeRecordFromOmdb('tt21958588', episodeOmdb)).toEqual({
			imdbId: 'tt21958588',
			type: 'episode',
			title: 'Cake Week',
			seriesImdbId: 'tt1877368',
			season: 13,
			episode: 1,
			sources: ['omdb'],
		});
		expect(episodeRecordFromOmdb('tt1877368', bakeOffOmdb)).toBeNull();
	});
});

describe('year helpers', () => {
	it('reads years out of dates, numbers and open ranges', () => {
		expect(yearOf('2001-07-20')).toBe(2001);
		expect(yearOf('2010–')).toBe(2010);
		expect(yearOf(2019)).toBe(2019);
		expect(yearOf('N/A')).toBeUndefined();
		expect(yearOf(12)).toBeUndefined();
	});

	it('votes by majority, ties to the first, and falls back only when needed', () => {
		expect(voteYear([2001, 2002, 2002], [2003])).toBe(2002);
		expect(voteYear([2001, 2002, undefined], [2003])).toBe(2001);
		expect(voteYear([undefined], [undefined, 2003])).toBe(2003);
		expect(voteYear([], [])).toBeNull();
	});
});

describe('anime season structure, on providers captured 2026-09-26', () => {
	const load = (name: string) =>
		JSON.parse(readFileSync(`src/test/fixtures/metadata/${name}.json`, 'utf8'));
	const record = (imdbId: string, slug: string, tmdbId: string, tvmazeId: string) =>
		mergeShowRecord(imdbId, {
			tmdb: load(`tmdb-tv-${tmdbId}-${slug}`),
			mdblist: load(`mdblist-${imdbId}-${slug}`),
			cinemeta: load(`cinemeta-${imdbId}-${slug}`),
			omdb: load(`omdb-${imdbId}-${slug}`),
			traktSeasons: load(`trakt-seasons-${imdbId}-${slug}`),
			tvmaze: load(`tvmaze-${tvmazeId}-${slug}`),
		});

	// TMDB and Trakt file all 85 episodes as season 1; Cinemeta and TVmaze
	// split them the way release names do. Production showed a season 1 of 85.
	it('does not let a provider that numbers absolutely inflate season 1 (Re:ZERO)', () => {
		const rezero = record('tt5607616', 're-zero', '65942', '14459');
		expect(rezero.seasons).toEqual([
			{ number: 1, episodes: 25 },
			{ number: 2, episodes: 25 },
			{ number: 3, episodes: 16 },
			{ number: 4, episodes: 19 },
		]);
		expect(rezero.nextEpisode).toEqual(expect.objectContaining({ season_number: 4 }));
	});

	it('keeps Frieren’s first season at 28, not TMDB’s 38', () => {
		const frieren = record('tt22248376', 'frieren', '209867', '69956');
		expect(frieren.seasons.slice(0, 2)).toEqual([
			{ number: 1, episodes: 28 },
			{ number: 2, episodes: 10 },
		]);
	});

	// TVmaze lists an undated second season of 18 no other provider has.
	it('ignores an undated TVmaze placeholder season (Death Note)', () => {
		const deathNote = record('tt0877057', 'death-note', '13916', '40');
		expect(deathNote.seasonCount).toBe(1);
		expect(deathNote.seasons).toEqual([{ number: 1, episodes: 37 }]);
	});
});
