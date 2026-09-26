import bakeOffCinemeta from '@/test/fixtures/metadata/cinemeta-tt1877368-great-british-bake-off.json';
import bakeOffMdblist from '@/test/fixtures/metadata/mdblist-tt1877368-great-british-bake-off.json';
import bakeOffOmdb from '@/test/fixtures/metadata/omdb-tt1877368-great-british-bake-off.json';
import bakeOffTmdb from '@/test/fixtures/metadata/tmdb-tv-34549-great-british-bake-off.json';
import bakeOffTraktLast from '@/test/fixtures/metadata/trakt-last_episode-tt1877368-great-british-bake-off.json';
import bakeOffTraktSeasons from '@/test/fixtures/metadata/trakt-seasons-tt1877368-great-british-bake-off.json';
import bakeOffTvmaze from '@/test/fixtures/metadata/tvmaze-2950-great-british-bake-off.json';
import dailyShowTvmaze from '@/test/fixtures/metadata/tvmaze-3928-the-daily-show.json';
import {
	mergeShowViews,
	normalizeShowStatus,
	viewFromCinemeta,
	viewFromMdblist,
	viewFromOmdb,
	viewFromTmdb,
	viewFromTrakt,
	viewFromTvmaze,
	type ShowView,
} from '@/utils/showMetadataMerge';
import { describe, expect, it } from 'vitest';

const highestSeason = (view: ShowView | null) =>
	Math.max(...(view ? [...view.seasons.keys()] : []));

describe('provider views of Bake Off (tt1877368), captured 2026-09-26', () => {
	it('reads each provider the way it numbers the show', () => {
		expect(highestSeason(viewFromTmdb(bakeOffTmdb))).toBe(7);
		expect(highestSeason(viewFromTrakt(bakeOffTraktSeasons, null, bakeOffTraktLast))).toBe(7);
		expect(highestSeason(viewFromMdblist(bakeOffMdblist))).toBe(7);
		expect(highestSeason(viewFromTvmaze(bakeOffTvmaze))).toBe(17);
		expect(highestSeason(viewFromCinemeta(bakeOffCinemeta))).toBe(17);
		expect(highestSeason(viewFromOmdb(bakeOffOmdb))).toBe(17);
	});

	it('merges to the show as it is now', () => {
		const merged = mergeShowViews([
			viewFromTmdb(bakeOffTmdb),
			viewFromTvmaze(bakeOffTvmaze),
			viewFromTrakt(bakeOffTraktSeasons, null, bakeOffTraktLast),
			viewFromMdblist(bakeOffMdblist),
			viewFromCinemeta(bakeOffCinemeta),
			viewFromOmdb(bakeOffOmdb),
		]);

		expect(merged.season_count).toBe(17);
		expect(merged.status).toBe('Returning Series');
		expect(merged.has_specials).toBe(true);
		expect(merged.next_episode_to_air).toEqual(
			expect.objectContaining({ season_number: 17, episode_number: 2 })
		);
		// Trakt's "last episode" is the BBC run's 2016 finale and must not win.
		expect(merged.last_episode_to_air).toEqual(
			expect.objectContaining({ season_number: 17, episode_number: 1 })
		);
		expect(merged.reach).toEqual({
			tmdb: 7,
			tvmaze: 17,
			trakt: 7,
			mdblist: 7,
			cinemeta: 17,
			omdb: 17,
		});
	});
});

describe('year-numbered seasons', () => {
	it('drops a view whose seasons are years, status and episodes included', () => {
		const tvmaze = viewFromTvmaze(dailyShowTvmaze);
		expect(highestSeason(tvmaze)).toBe(2022);

		const omdb = viewFromOmdb({ totalSeasons: '31' });
		const merged = mergeShowViews([tvmaze, omdb]);

		expect(merged.season_count).toBe(31);
		expect(merged.season_episode_counts[2015]).toBeUndefined();
		expect(merged.status).toBeUndefined();
		expect(merged.last_episode_to_air).toBeUndefined();
		expect(merged.reach.tvmaze).toBe(-1);
	});
});

describe('mergeShowViews', () => {
	const view = (
		source: ShowView['source'],
		seasons: Array<[number, number | null]>,
		extra = {}
	) => ({ source, seasons: new Map(seasons), ...extra }) as ShowView;

	it('takes the larger episode count for each season', () => {
		const merged = mergeShowViews([
			view('tmdb', [
				[1, 8],
				[2, null],
			]),
			view('cinemeta', [
				[1, 6],
				[2, 10],
			]),
		]);
		expect(merged.season_episode_counts).toEqual({ 1: 8, 2: 10 });
	});

	it('gives no status rather than one from a view that stops short', () => {
		const merged = mergeShowViews([
			view('tmdb', [[7, 10]], { status: 'Canceled' }),
			view('omdb', [[17, null]]),
		]);
		expect(merged.season_count).toBe(17);
		expect(merged.status).toBeUndefined();
	});

	it('breaks a tie in reach by source priority', () => {
		const merged = mergeShowViews([
			view('mdblist', [[3, 8]], { status: 'Ended' }),
			view('tmdb', [[3, 8]], { status: 'Returning Series' }),
		]);
		expect(merged.status).toBe('Returning Series');
	});

	it('prefers a timestamp over a bare date for the same episode', () => {
		const episode = { season_number: 2, episode_number: 3, name: 'x' };
		const merged = mergeShowViews([
			view('tmdb', [[2, 8]], { next: { ...episode, first_aired: '2026-10-01' } }),
			view('trakt', [[2, 8]], {
				next: { ...episode, first_aired: '2026-10-01T20:00:00.000Z' },
			}),
		]);
		expect(merged.next_episode_to_air?.first_aired).toBe('2026-10-01T20:00:00.000Z');
	});

	it('answers one season when nobody knows any', () => {
		expect(mergeShowViews([null, undefined]).season_count).toBe(1);
	});
});

describe('normalizeShowStatus', () => {
	it.each([
		['Running', 'Returning Series'],
		['Continuing', 'Returning Series'],
		['Returning Series', 'Returning Series'],
		['Ended', 'Ended'],
		['Cancelled', 'Canceled'],
		['In Development', 'In Production'],
		['To Be Determined', undefined],
		[undefined, undefined],
	])('%s → %s', (input, expected) => {
		expect(normalizeShowStatus(input)).toBe(expected);
	});

	it('ignores OMDb’s "N/A" season total', () => {
		expect(viewFromOmdb({ totalSeasons: 'N/A' })).toBeNull();
	});
});
