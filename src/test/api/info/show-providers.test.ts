import handler from '@/pages/api/info/show';
import bakeOffCinemeta from '@/test/fixtures/metadata/cinemeta-tt1877368-great-british-bake-off.json';
import dailyShowMdblist from '@/test/fixtures/metadata/mdblist-tt0115147-the-daily-show.json';
import bakeOffMdblist from '@/test/fixtures/metadata/mdblist-tt1877368-great-british-bake-off.json';
import episodeMdblist from '@/test/fixtures/metadata/mdblist-tt21958588-bake-off-episode.json';
import dailyShowOmdb from '@/test/fixtures/metadata/omdb-tt0115147-the-daily-show.json';
import bakeOffOmdb from '@/test/fixtures/metadata/omdb-tt1877368-great-british-bake-off.json';
import episodeOmdb from '@/test/fixtures/metadata/omdb-tt21958588-bake-off-episode.json';
import dailyShowTmdb from '@/test/fixtures/metadata/tmdb-tv-2224-the-daily-show.json';
import bakeOffTmdb from '@/test/fixtures/metadata/tmdb-tv-34549-great-british-bake-off.json';
import dailyShowTraktLast from '@/test/fixtures/metadata/trakt-last_episode-tt0115147-the-daily-show.json';
import bakeOffTraktLast from '@/test/fixtures/metadata/trakt-last_episode-tt1877368-great-british-bake-off.json';
import dailyShowTraktNext from '@/test/fixtures/metadata/trakt-next_episode-tt0115147-the-daily-show.json';
import dailyShowTraktSeasons from '@/test/fixtures/metadata/trakt-seasons-tt0115147-the-daily-show.json';
import bakeOffTraktSeasons from '@/test/fixtures/metadata/trakt-seasons-tt1877368-great-british-bake-off.json';
import episodeTraktSeasons from '@/test/fixtures/metadata/trakt-seasons-tt21958588-bake-off-episode.json';
import bakeOffTvmaze from '@/test/fixtures/metadata/tvmaze-2950-great-british-bake-off.json';
import dailyShowTvmaze from '@/test/fixtures/metadata/tvmaze-3928-the-daily-show.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/mdblistClient', () => ({ getMdblistClient: vi.fn() }));
vi.mock('@/services/metadataCache', () => ({ getMetadataCache: vi.fn() }));
vi.mock('user-agents', () => ({
	default: vi.fn().mockImplementation(() => ({ toString: () => 'test-agent' })),
}));

import { getMdblistClient } from '@/services/mdblistClient';
import { getMetadataCache } from '@/services/metadataCache';

/**
 * Every provider's real answer for one show, captured 2026-09-26. TMDB is
 * served both through the cache and, for any code that still calls it
 * directly, through axios, so the route is judged on the data and not on which
 * client it happens to fetch with.
 */
type Captured = {
	mdblist: any;
	cinemeta: any;
	omdb: any;
	tmdb: any;
	traktSeasons: any;
	traktNext: any;
	traktLast: any;
	tvmaze: any;
};

const bakeOff: Captured = {
	mdblist: bakeOffMdblist,
	cinemeta: bakeOffCinemeta,
	omdb: bakeOffOmdb,
	tmdb: bakeOffTmdb,
	traktSeasons: bakeOffTraktSeasons,
	traktNext: null, // Trakt answered 204: its tt1877368 is the BBC run, which has ended.
	traktLast: bakeOffTraktLast,
	tvmaze: bakeOffTvmaze,
};

// Cinemeta's answer for The Daily Show is 2.8 MB of nightly episodes, so it is
// left out; the other five providers carry the case.
const dailyShow: Captured = {
	mdblist: dailyShowMdblist,
	cinemeta: null,
	omdb: dailyShowOmdb,
	tmdb: dailyShowTmdb,
	traktSeasons: dailyShowTraktSeasons,
	traktNext: dailyShowTraktNext,
	traktLast: dailyShowTraktLast,
	tvmaze: dailyShowTvmaze,
};

function serve(captured: Captured) {
	vi.mocked(getMdblistClient).mockReturnValue({
		getInfoByImdbId: vi.fn().mockResolvedValue(captured.mdblist),
	} as any);
	vi.mocked(getMetadataCache).mockReturnValue({
		getCinemetaSeries: vi.fn().mockResolvedValue(captured.cinemeta ?? {}),
		getOmdbInfo: vi.fn().mockResolvedValue(captured.omdb),
		getTmdbTvInfo: vi.fn().mockResolvedValue(captured.tmdb),
		searchTmdbByImdb: vi.fn().mockResolvedValue(null),
		getTraktShowSeasons: vi.fn().mockResolvedValue(captured.traktSeasons),
		getTraktShowEpisode: vi.fn((_id: string, which: string) =>
			Promise.resolve(which === 'next_episode' ? captured.traktNext : captured.traktLast)
		),
		getTvmazeShow: vi.fn().mockResolvedValue(captured.tvmaze),
	} as any);
	vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
		if (url.includes('api.themoviedb.org')) return { data: captured.tmdb };
		throw new Error(`unexpected request: ${url}`);
	});
}

async function showInfo(imdbid: string) {
	const req = createMockRequest({ method: 'GET', query: { imdbid } });
	const res = createMockResponse();
	await handler(req, res);
	expect(res.status).toHaveBeenCalledWith(200);
	return vi.mocked(res.json).mock.calls[0][0];
}

describe('/api/info/show across all six providers', () => {
	const tmdbKey = process.env.TMDB_KEY;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.TMDB_KEY = 'test-tmdb-key';
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (tmdbKey === undefined) delete process.env.TMDB_KEY;
		else process.env.TMDB_KEY = tmdbKey;
	});

	// TMDB, Trakt and mdblist file Bake Off's Channel 4 years under a second
	// entry, so on tt1877368 they describe a show that was canceled in 2016.
	// TVmaze, OMDb and Cinemeta know it is on series 17 and airing.
	it('describes Bake Off as the airing show TVmaze, OMDb and Cinemeta know', async () => {
		serve(bakeOff);
		const info = await showInfo('tt1877368');

		expect(info.season_count).toBe(17);
		expect(info.season_names).toHaveLength(17);
		expect(info.season_episode_counts[17]).toBe(10);
		expect(info.status).toBe('Returning Series');
		expect(info.next_episode_to_air).toEqual({
			first_aired: '2026-09-29T19:00:00+00:00',
			season_number: 17,
			episode_number: 2,
			name: 'Biscuit Week',
		});
		expect(info.last_episode_to_air).toEqual(
			expect.objectContaining({ season_number: 17, episode_number: 1, name: 'Cake Week' })
		);
	});

	// TVmaze resolves tt0115147 to the Trevor Noah run, numbered 2015-2022 and
	// ended. None of that may reach a show that is on season 31 and airing.
	it('ignores a provider that numbers seasons by year', async () => {
		serve(dailyShow);
		const info = await showInfo('tt0115147');

		expect(info.season_count).toBe(31);
		expect(
			Object.keys(info.season_episode_counts)
				.map(Number)
				.every((s) => s < 1900)
		).toBe(true);
		expect(info.status).toBe('Returning Series');
		expect(info.next_episode_to_air).toEqual(expect.objectContaining({ season_number: 31 }));
	});

	it('asks every provider for the show', async () => {
		serve(bakeOff);
		await showInfo('tt1877368');
		const cache = vi.mocked(getMetadataCache)() as any;

		expect(cache.getTvmazeShow).toHaveBeenCalledWith('tt1877368');
		expect(cache.getTraktShowSeasons).toHaveBeenCalledWith('tt1877368');
		expect(cache.getOmdbInfo).toHaveBeenCalledWith('tt1877368');
		expect(cache.getCinemetaSeries).toHaveBeenCalled();
		expect(cache.getTmdbTvInfo).toHaveBeenCalledWith(
			34549,
			'videos,external_ids,alternative_titles'
		);
	});

	// Trakt and Cinemeta list Bake Off's Channel 4 years under tt21958588, which
	// on IMDb is series 13 episode 1. Opened on that id, the page saw Trakt's ten
	// seasons and nothing else.
	it('names the series an episode id belongs to', async () => {
		serve({
			mdblist: episodeMdblist,
			cinemeta: null,
			omdb: episodeOmdb,
			tmdb: null,
			traktSeasons: episodeTraktSeasons,
			traktNext: null,
			traktLast: null,
			tvmaze: null,
		});
		const info = await showInfo('tt21958588');

		expect(info.series_imdbid).toBe('tt1877368');
	});

	it('names no parent for a series id', async () => {
		serve(bakeOff);
		const info = await showInfo('tt1877368');

		expect(info.series_imdbid).toBeUndefined();
	});
});
