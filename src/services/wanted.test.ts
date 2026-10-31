import frozenIII from '@/test/fixtures/metadata/tmdb-movie-1024604-frozen-iii-release-dates.json';
import mallari from '@/test/fixtures/metadata/tmdb-movie-1118824-mallari-release-dates.json';
import mala from '@/test/fixtures/metadata/tmdb-movie-1686301-mala-release-dates.json';
import anAffair from '@/test/fixtures/metadata/tmdb-movie-253822-an-affair-titles.json';
import lesMiserables from '@/test/fixtures/metadata/tmdb-movie-82695-les-miserables-titles.json';
import thirdRock from '@/test/fixtures/metadata/tmdb-tv-155-3rd-rock-from-the-sun.json';
import dailyShow from '@/test/fixtures/metadata/tmdb-tv-2224-the-daily-show.json';
import bakeOffAppended from '@/test/fixtures/metadata/tmdb-tv-34549-great-british-bake-off-appended.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	airedSeasons,
	filmTitles,
	homeRelease,
	resolveWanted,
	resolveWantedReused,
	seasonsTmdbLacks,
} from './wanted';

const cache = vi.hoisted(() => ({
	searchTmdbByImdb: vi.fn(),
	getTmdbTvInfo: vi.fn(),
	getTmdbMovieInfo: vi.fn(),
}));
vi.mock('@/services/metadataCache', () => ({ getMetadataCache: () => cache }));

const row = (over: Partial<Parameters<typeof resolveWanted>[0]> = {}) => ({
	id: '0b7c2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b',
	imdbId: 'tt0115082',
	kind: 'show' as const,
	title: '3rd Rock from the Sun',
	seasons: null,
	createdAt: new Date(),
	fulfilledAt: null,
	fulfilled: null,
	lastPolledAt: null,
	...over,
});

describe('airedSeasons', () => {
	it('lists every episode of an ended show, without specials', () => {
		const seasons = airedSeasons(thirdRock, null);
		expect(seasons.map((s) => [s.season, s.episodes.length])).toEqual([
			[1, 20],
			[2, 26],
			[3, 27],
			[4, 24],
			[5, 22],
			[6, 20],
		]);
		expect(seasons[0].episodes.slice(0, 3)).toEqual([1, 2, 3]);
	});

	// TMDB counts the airing season's announced episodes too: The Daily Show's
	// season 31 has 122 listed and episode 107 next to air.
	it('stops an airing season before the next episode to air', () => {
		const [current] = airedSeasons(dailyShow, [31]);
		expect(current.season).toBe(31);
		expect(current.episodes.at(-1)).toBe(106);
		expect(current.airing).toBe(true);
		expect(airedSeasons(dailyShow, [30])[0].airing).toBeUndefined();
	});

	// zurg searches every few minutes in the hours after this day.
	it("dates a season by the show's newest aired episode, when it is the season's last listed", () => {
		expect(airedSeasons(dailyShow, [31])[0].aired).toBe('2026-09-24');
		expect(airedSeasons(dailyShow, [30])[0].aired).toBeUndefined();
		expect(airedSeasons(thirdRock, [6])[0].aired).toBe('2001-05-22');
		expect(airedSeasons(thirdRock, [5])[0].aired).toBeUndefined();
	});

	it('keeps only the seasons asked for', () => {
		expect(airedSeasons(thirdRock, [2, 5]).map((s) => s.season)).toEqual([2, 5]);
	});

	it('answers nothing for a show TMDB lists no seasons of', () => {
		expect(airedSeasons({}, null)).toEqual([]);
	});
});

describe('resolveWanted', () => {
	beforeEach(() => {
		cache.searchTmdbByImdb.mockReset();
		cache.getTmdbTvInfo.mockReset();
		cache.getTmdbMovieInfo.mockReset();
		cache.getTmdbMovieInfo.mockResolvedValue({ title: 'x' });
	});

	it("gives a show TMDB's and TVDB's ids beside the aired seasons", async () => {
		cache.searchTmdbByImdb.mockResolvedValue({ tv_results: [{ id: bakeOffAppended.id }] });
		cache.getTmdbTvInfo.mockResolvedValue(bakeOffAppended);

		const item = await resolveWanted(row({ imdbId: 'tt1877368', title: 'Bake Off' }));

		expect(item.tmdb).toBe(bakeOffAppended.id);
		expect(item.year).toBe(Number(bakeOffAppended.first_air_date.slice(0, 4)));
		expect(item.tvdb).toBe(bakeOffAppended.external_ids.tvdb_id);
		expect(item.seasons?.length).toBeGreaterThan(0);
	});

	it('gives a film its TMDB id and no seasons', async () => {
		cache.searchTmdbByImdb.mockResolvedValue({
			movie_results: [{ id: 603, release_date: '1999-03-30' }],
		});

		const item = await resolveWanted(
			row({ kind: 'movie', imdbId: 'tt0133093', title: 'The Matrix' })
		);

		expect(item).toMatchObject({ kind: 'movie', imdb: 'tt0133093', tmdb: 603, year: 1999 });
		expect(item.seasons).toBeUndefined();
		expect(cache.getTmdbTvInfo).not.toHaveBeenCalled();
	});

	// Absent seasons mean "not known this time", which zurg must not read as
	// "nothing aired" and settle the show on.
	it('leaves seasons out, not empty, when TMDB cannot be asked', async () => {
		cache.searchTmdbByImdb.mockRejectedValue(new Error('TMDB down'));

		const item = await resolveWanted(row());

		expect(item).toEqual({
			id: row().id,
			kind: 'show',
			title: '3rd Rock from the Sun',
			imdb: 'tt0115082',
		});
	});
});

// zurg reads the whole list every minute; an imported Radarr list of 1,273
// titles took 28 to 53 s a poll on 2026-10-25, against zurg's 60 s timeout.
describe('resolveWantedReused', () => {
	beforeEach(() => {
		cache.searchTmdbByImdb.mockReset();
		cache.getTmdbTvInfo.mockReset();
		cache.getTmdbMovieInfo.mockReset();
		cache.getTmdbMovieInfo.mockResolvedValue({ title: 'x' });
	});

	it('asks the metadata cache once for every poll inside half an hour', async () => {
		cache.searchTmdbByImdb.mockResolvedValue({
			movie_results: [{ id: 603, release_date: '1999-03-31' }],
		});
		const film = row({ imdbId: 'tt0133093', kind: 'movie', title: 'The Matrix' });
		const first = await resolveWantedReused(film, 0);
		const again = await resolveWantedReused({ ...film, id: 'another-sponsor' }, 29 * 60_000);
		expect(cache.searchTmdbByImdb).toHaveBeenCalledTimes(1);
		expect(again).toEqual({ ...first, id: 'another-sponsor' });
		await resolveWantedReused(film, 31 * 60_000);
		expect(cache.searchTmdbByImdb).toHaveBeenCalledTimes(2);
	});

	it('does not keep an answer TMDB could not give', async () => {
		cache.searchTmdbByImdb.mockRejectedValueOnce(new Error('down'));
		cache.searchTmdbByImdb.mockResolvedValue({ movie_results: [{ id: 680 }] });
		const film = row({ imdbId: 'tt0110912', kind: 'movie', title: 'Pulp Fiction' });
		expect((await resolveWantedReused(film, 0)).tmdb).toBeUndefined();
		expect((await resolveWantedReused(film, 1)).tmdb).toBe(680);
	});
});

describe('seasonsTmdbLacks', () => {
	beforeEach(() => {
		cache.searchTmdbByImdb.mockReset();
		cache.getTmdbTvInfo.mockReset();
		cache.getTmdbMovieInfo.mockReset();
		cache.getTmdbMovieInfo.mockResolvedValue({ title: 'x' });
	});

	it('names the Sonarr seasons TMDB has nothing aired in', async () => {
		cache.searchTmdbByImdb.mockResolvedValue({ tv_results: [{ id: thirdRock.id }] });
		cache.getTmdbTvInfo.mockResolvedValue(thirdRock);
		await expect(
			seasonsTmdbLacks([
				{ imdbId: 'tt0115082', title: '3rd Rock from the Sun', seasons: [6, 7, 8] },
			])
		).resolves.toEqual([{ title: '3rd Rock from the Sun', seasons: [7, 8] }]);
	});

	it('leaves out a show TMDB could not be asked about', async () => {
		cache.searchTmdbByImdb.mockRejectedValue(new Error('down'));
		await expect(
			seasonsTmdbLacks([{ imdbId: 'tt9999999', title: 'Unknown', seasons: [1] }])
		).resolves.toEqual([]);
	});
});

// DrunkenSlug files Przesluchanie (1982) under An Affair (1982, tt0186488), and
// zurg fetched it on 2026-10-25: the year agrees, only the titles tell them apart.
describe('film titles', () => {
	beforeEach(() => {
		cache.searchTmdbByImdb.mockReset();
		cache.getTmdbMovieInfo.mockReset();
	});

	it('sends every title TMDB knows a film by', async () => {
		cache.searchTmdbByImdb.mockResolvedValue({
			movie_results: [{ id: anAffair.id, release_date: anAffair.release_date }],
		});
		cache.getTmdbMovieInfo.mockResolvedValue(anAffair);
		const item = await resolveWanted(
			row({ imdbId: 'tt0186488', kind: 'movie', title: 'An Affair' })
		);
		expect(item.titles).toContain('Relasyon');
		expect(item.titles?.[0]).toBe('An Affair');
		expect(cache.getTmdbMovieInfo).toHaveBeenCalledWith(
			253822,
			'alternative_titles,translations,release_dates'
		);
	});

	it('sends the day a film first came out at home, never its cinema date', async () => {
		cache.searchTmdbByImdb.mockResolvedValue({
			movie_results: [{ id: mallari.id, release_date: mallari.release_date }],
		});
		cache.getTmdbMovieInfo.mockResolvedValue(mallari);
		const item = await resolveWanted(
			row({ imdbId: 'tt29544868', kind: 'movie', title: 'Mallari' })
		);
		// In Philippine cinemas 2023-12-25, on Netflix US and in the UK 2024-06-20.
		expect(item.released).toBe('2024-06-20');
		expect(item.year).toBe(2023);
		// TMDB knows only cinema dates for these, so nothing is sent.
		expect(homeRelease(mala)).toBeUndefined();
		expect(homeRelease(frozenIII)).toBeUndefined();
		expect(homeRelease({})).toBeUndefined();
	});

	it('lists alternatives and translations once each', () => {
		const titles = filmTitles(lesMiserables);
		expect(titles).toContain('Les Misérables');
		expect(titles).toContain('Le Mis');
		expect(titles).toContain('Os Miseráveis');
		expect(new Set(titles).size).toBe(titles.length);
	});

	it('leaves titles out, and does not keep the answer, when TMDB fails', async () => {
		cache.searchTmdbByImdb.mockResolvedValue({ movie_results: [{ id: anAffair.id }] });
		cache.getTmdbMovieInfo.mockRejectedValueOnce(new Error('down'));
		cache.getTmdbMovieInfo.mockResolvedValue(anAffair);
		const film = row({ imdbId: 'tt0186488', kind: 'movie', title: 'An Affair' });
		expect((await resolveWantedReused(film, 0)).titles).toBeUndefined();
		expect((await resolveWantedReused(film, 1)).titles).toContain('Relasyon');
	});
});
