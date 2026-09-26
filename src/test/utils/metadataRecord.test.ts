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
