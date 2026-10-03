import handler from '@/pages/api/info/show';
import darkKnightCinemeta from '@/test/fixtures/metadata/cinemeta-tt0468569-the-dark-knight.json';
import filthCinemeta from '@/test/fixtures/metadata/cinemeta-tt1046922-filth-the-mary-whitehouse-story.json';
import wednesdayCinemeta from '@/test/fixtures/metadata/cinemeta-tt13443470-wednesday.json';
import accursedCinemeta from '@/test/fixtures/metadata/cinemeta-tt4182368-the-accursed.json';
import darkKnightMdblist from '@/test/fixtures/metadata/mdblist-tt0468569-the-dark-knight.json';
import filthMdblist from '@/test/fixtures/metadata/mdblist-tt1046922-filth-the-mary-whitehouse-story.json';
import wednesdayMdblist from '@/test/fixtures/metadata/mdblist-tt13443470-wednesday.json';
import accursedMdblist from '@/test/fixtures/metadata/mdblist-tt4182368-the-accursed.json';
import darkKnightOmdb from '@/test/fixtures/metadata/omdb-tt0468569-the-dark-knight.json';
import filthOmdb from '@/test/fixtures/metadata/omdb-tt1046922-filth-the-mary-whitehouse-story.json';
import accursedOmdb from '@/test/fixtures/metadata/omdb-tt4182368-the-accursed.json';
import darkKnightTmdbFind from '@/test/fixtures/metadata/tmdb-find-tt0468569-the-dark-knight.json';
import filthTmdbFind from '@/test/fixtures/metadata/tmdb-find-tt1046922-filth-the-mary-whitehouse-story.json';
import accursedTmdbFind from '@/test/fixtures/metadata/tmdb-find-tt4182368-the-accursed.json';
import atlanticTmdbTv from '@/test/fixtures/metadata/tmdb-tv-111102-atlantic-a-year-in-the-wild.json';
import thirdRockTmdbTv from '@/test/fixtures/metadata/tmdb-tv-155-3rd-rock-from-the-sun.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/mdblistClient', () => ({
	getMdblistClient: vi.fn(),
}));

vi.mock('@/services/metadataCache', () => ({
	getMetadataCache: vi.fn(),
}));

vi.mock('user-agents', () => ({
	default: vi.fn().mockImplementation(() => ({
		toString: () => 'test-agent',
	})),
}));

import { getMdblistClient } from '@/services/mdblistClient';
import { getMetadataCache } from '@/services/metadataCache';

describe('/api/info/show', () => {
	const mockMdbClient = {
		getInfoByImdbId: vi.fn(),
	};
	const mockMetadataCache = {
		getCinemetaSeries: vi.fn(),
		getTraktShowEpisode: vi.fn().mockResolvedValue(null),
		getTraktShowSeasons: vi.fn().mockResolvedValue(null),
		getTvmazeShow: vi.fn().mockResolvedValue(null),
		getTmdbTvInfo: vi.fn().mockResolvedValue(null),
		searchTmdbByImdb: vi.fn().mockResolvedValue(null),
		getOmdbInfo: vi.fn().mockResolvedValue(null),
	};

	const tmdbEnv = { key: process.env.TMDB_KEY, token: process.env.TMDB_READ_TOKEN };

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getMdblistClient).mockReturnValue(mockMdbClient as any);
		vi.mocked(getMetadataCache).mockReturnValue(mockMetadataCache as any);
		mockMetadataCache.getTraktShowEpisode.mockResolvedValue(null);
		mockMetadataCache.getTraktShowSeasons.mockResolvedValue(null);
		mockMetadataCache.getTvmazeShow.mockResolvedValue(null);
		mockMetadataCache.getTmdbTvInfo.mockResolvedValue(null);
		mockMetadataCache.searchTmdbByImdb.mockResolvedValue(null);
		mockMetadataCache.getOmdbInfo.mockResolvedValue(null);
		// Fixtures carry a real tmdbid; without a credential the route skips the
		// TMDB status/trailer call rather than reaching the network.
		delete process.env.TMDB_KEY;
		delete process.env.TMDB_READ_TOKEN;
	});

	afterEach(() => {
		if (tmdbEnv.key === undefined) delete process.env.TMDB_KEY;
		else process.env.TMDB_KEY = tmdbEnv.key;
		if (tmdbEnv.token === undefined) delete process.env.TMDB_READ_TOKEN;
		else process.env.TMDB_READ_TOKEN = tmdbEnv.token;
	});

	it('requires an IMDb id', async () => {
		const req = createMockRequest();
		const res = createMockResponse();
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'IMDB ID is required' });
	});

	it('merges season metadata from both sources', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({
			title: 'MDB Show',
			description: 'MDB Desc',
			poster: 'mdb-poster',
			backdrop: 'mdb-backdrop',
			ratings: [{ source: 'imdb', score: 8.5 }],
			seasons: [
				{ season_number: 1, name: 'Season 1', episode_count: 8 },
				{ season_number: 2, name: 'Season 2', episode_count: 10 },
			],
		});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({
			meta: {
				name: 'Cine Show',
				description: 'Cine Desc',
				poster: 'cine-poster',
				background: 'cine-bg',
				imdbRating: 9.1,
				videos: [{ season: 1 }, { season: 1 }, { season: 3 }, { season: 3 }, { season: 3 }],
			},
			meta_videos: [],
		});

		const req = createMockRequest({
			query: { imdbid: 'ttshow123' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockMdbClient.getInfoByImdbId).toHaveBeenCalledWith('ttshow123');
		expect(mockMetadataCache.getCinemetaSeries).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			title: 'MDB Show',
			description: 'MDB Desc',
			poster: 'mdb-poster',
			backdrop: 'mdb-backdrop',
			season_count: 3,
			season_names: ['Season 1', 'Season 2', 'Season 3'],
			has_specials: false,
			imdb_score: 9.1,
			season_episode_counts: {
				1: 8,
				2: 10,
				3: 3,
			},
			trailer: '',
			status: undefined,
			next_episode_to_air: undefined,
			last_episode_to_air: undefined,
		});
	});

	it('returns 500 when every provider fails', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockMdbClient.getInfoByImdbId.mockRejectedValue(new Error('fail'));
		mockMetadataCache.getCinemetaSeries.mockRejectedValue(new Error('fail'));
		const req = createMockRequest({
			query: { imdbid: 'ttbroken' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch show information' });
		consoleSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('still answers from the other providers when mdblist fails', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockMdbClient.getInfoByImdbId.mockRejectedValue(new Error('fail'));
		mockMetadataCache.getCinemetaSeries.mockResolvedValue(wednesdayCinemeta);
		const req = createMockRequest({ query: { imdbid: 'tt13443470' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: 'Wednesday' }));
		warnSpy.mockRestore();
	});

	it('uses higher season count from cinemeta when mdb has fewer seasons', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({
			title: 'New Show',
			description: 'A new show',
			poster: 'poster.jpg',
			backdrop: 'backdrop.jpg',
			ratings: [{ source: 'imdb', score: 7.5 }],
			seasons: [{ season_number: 1, name: 'Season 1', episode_count: 10 }],
		});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({
			meta: {
				name: 'New Show',
				description: 'A new show',
				poster: 'poster.jpg',
				background: 'background.jpg',
				imdbRating: 7.5,
				videos: [
					{ season: 1, episode: 1 },
					{ season: 1, episode: 2 },
					{ season: 2, episode: 1 },
					{ season: 2, episode: 2 },
				],
			},
		});

		const req = createMockRequest({
			query: { imdbid: 'tt31187479' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				season_count: 2,
				season_names: ['Season 1', 'Season 2'],
				season_episode_counts: {
					1: 10,
					2: 2,
				},
			})
		);
	});

	it('uses higher season count from mdb when cinemeta has fewer seasons', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({
			title: 'Established Show',
			description: 'An established show',
			poster: 'poster.jpg',
			backdrop: 'backdrop.jpg',
			ratings: [{ source: 'imdb', score: 8.0 }],
			seasons: [
				{ season_number: 1, name: 'Season 1', episode_count: 12 },
				{ season_number: 2, name: 'Season 2', episode_count: 12 },
				{ season_number: 3, name: 'Season 3', episode_count: 10 },
			],
		});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({
			meta: {
				name: 'Established Show',
				description: 'An established show',
				poster: 'poster.jpg',
				background: 'background.jpg',
				imdbRating: 8.0,
				videos: [
					{ season: 1, episode: 1 },
					{ season: 1, episode: 2 },
					{ season: 2, episode: 1 },
				],
			},
		});

		const req = createMockRequest({
			query: { imdbid: 'tt12345678' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				season_count: 3,
				season_names: ['Season 1', 'Season 2', 'Season 3'],
				season_episode_counts: {
					1: 12,
					2: 12,
					3: 10,
				},
			})
		);
	});

	it('falls back to OMDb when mdblist and cinemeta have nothing', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'True',
			Title: 'Breaking Bad',
			Plot: 'A chemistry teacher turns to manufacturing methamphetamine.',
			Poster: 'https://m.media-amazon.com/images/M/breakingbad.jpg',
			imdbRating: '9.5',
		});

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt0903747' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Breaking Bad',
				description: 'A chemistry teacher turns to manufacturing methamphetamine.',
				poster: 'https://m.media-amazon.com/images/M/breakingbad.jpg',
				// This route reports the rating on its native 0-10 scale, unlike
				// /api/info/movie which multiplies by 10.
				imdb_score: 9.5,
			})
		);
	});

	it('counts the seasons OMDb knows that mdblist and Cinemeta do not', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue(wednesdayMdblist);
		mockMetadataCache.getCinemetaSeries.mockResolvedValue(wednesdayCinemeta);
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'True',
			Type: 'series',
			totalSeasons: '4',
		});

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt13443470' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockMetadataCache.getOmdbInfo).toHaveBeenCalledWith('tt13443470');
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Wednesday', season_count: 4 })
		);
	});

	it('never renders OMDb’s "N/A" filler as real metadata', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({});
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'True',
			Title: 'Some Obscure Show',
			Plot: 'N/A',
			Poster: 'N/A',
			imdbRating: 'N/A',
		});

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt0000002' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Some Obscure Show',
				description: 'n/a',
				poster: '',
				imdb_score: 0,
			})
		);
	});

	// https://github.com/debridmediamanager/debrid-media-manager/issues/235 and
	// Fizzy #37. The fallback was source.unsplash.com/random, which answers 503,
	// and then a picsum.photos stock photo seeded by the title: for The Accursed,
	// a desk with an iPod magazine on it. 14 of 400 shows production served on
	// 2026-10-03 ended there. No provider has art for this one, so the route says
	// so and the page draws its own.
	it('answers no backdrop, not a stock photo, when no provider has one', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue(accursedMdblist);
		mockMetadataCache.getCinemetaSeries.mockResolvedValue(accursedCinemeta);
		mockMetadataCache.getOmdbInfo.mockResolvedValue(accursedOmdb);
		mockMetadataCache.searchTmdbByImdb.mockResolvedValue(accursedTmdbFind);
		process.env.TMDB_KEY = 'test-key';

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt4182368' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const body = vi.mocked(res.json).mock.calls[0][0];
		expect(body.title).toBe('The Accursed');
		expect(body.poster).toBe(accursedOmdb.Poster);
		expect(body.backdrop).toBe('');
		expect(mockMetadataCache.getTmdbTvInfo).not.toHaveBeenCalled();
	});

	// meta.videos was dereferenced without a guard eight lines after the same
	// expression was written with one, so a meta object carrying no videos array
	// threw and the route answered 500 — losing the poster entirely.
	it('survives a cinemeta meta object with no videos array', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({ title: 'Videoless' });
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({
			meta: { name: 'Videoless', poster: 'cine-poster' },
		});

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt0000003' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Videoless', poster: 'cine-poster' })
		);
	});

	describe('poster and backdrop sources', () => {
		const originalTmdbKey = process.env.TMDB_KEY;
		const originalTmdbReadToken = process.env.TMDB_READ_TOKEN;

		const restore = (name: string, value: string | undefined) => {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		};

		beforeEach(() => {
			process.env.TMDB_KEY = 'test-tmdb-key';
			// The v4 token takes precedence over the key, so it has to be absent
			// for these cases to exercise the key path.
			delete process.env.TMDB_READ_TOKEN;
		});

		afterEach(() => {
			vi.restoreAllMocks();
			restore('TMDB_KEY', originalTmdbKey);
			restore('TMDB_READ_TOKEN', originalTmdbReadToken);
		});

		// The TMDB detail object is already fetched for status and the trailer, so
		// its art was a source the route paid for and then discarded.
		it('uses the art from the TMDB response it already fetched', async () => {
			mockMdbClient.getInfoByImdbId.mockResolvedValue({
				title: 'Arty',
				type: 'show',
				tmdbid: 1396,
			});
			mockMetadataCache.getCinemetaSeries.mockResolvedValue({});
			mockMetadataCache.getTmdbTvInfo.mockResolvedValue({
				status: 'Ended',
				poster_path: '/tmdb-poster.jpg',
				backdrop_path: '/tmdb-backdrop.jpg',
			});

			const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt0903747' } });
			const res = createMockResponse();

			await handler(req, res);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					poster: 'https://image.tmdb.org/t/p/w500/tmdb-poster.jpg',
					backdrop: 'https://image.tmdb.org/t/p/w1280/tmdb-backdrop.jpg',
				})
			);
		});

		it('still prefers mdblist and cinemeta art over TMDB', async () => {
			mockMdbClient.getInfoByImdbId.mockResolvedValue({
				title: 'Arty',
				type: 'show',
				tmdbid: 1396,
				poster: 'mdb-poster',
			});
			mockMetadataCache.getCinemetaSeries.mockResolvedValue({
				meta: { background: 'cine-bg' },
			});
			mockMetadataCache.getTmdbTvInfo.mockResolvedValue({
				poster_path: '/tmdb-poster.jpg',
				backdrop_path: '/tmdb-backdrop.jpg',
			});

			const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt0903747' } });
			const res = createMockResponse();

			await handler(req, res);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ poster: 'mdb-poster', backdrop: 'cine-bg' })
			);
		});

		// Fizzy #200. mdblist's `tmdbid` is a movie's id or a show's, as its `type`
		// says, and TMDB numbers movies and shows separately. Of the 3,013 ids
		// production served on this route in early October 2026, 48 are filed by
		// TMDB only as movies, and for 13 of them the route asked TMDB for the TV
		// show that happens to share the movie's number.
		describe("a movie's TMDB id", () => {
			const tmdbTvById: Record<number, unknown> = {
				111102: atlanticTmdbTv,
				155: thirdRockTmdbTv,
			};

			beforeEach(() => {
				mockMetadataCache.getTmdbTvInfo.mockImplementation(
					async (id: number) => tmdbTvById[id] ?? null
				);
			});

			const answer = async (imdbid: string) => {
				const res = createMockResponse();
				await handler(createMockRequest({ method: 'GET', query: { imdbid } }), res);
				expect(res.status).toHaveBeenCalledWith(200);
				return vi.mocked(res.json).mock.calls[0][0];
			};

			// TV show 111102 is Atlantic: A Year in the Wild, and production served its
			// backdrop as this film's on 2026-10-04. No provider has a backdrop for the
			// film itself; mdblist, its only art, has a poster.
			it("draws no other title's backdrop for a TV film mdblist types as a movie", async () => {
				mockMdbClient.getInfoByImdbId.mockResolvedValue(filthMdblist);
				mockMetadataCache.getCinemetaSeries.mockResolvedValue(filthCinemeta);
				mockMetadataCache.getOmdbInfo.mockResolvedValue(filthOmdb);
				mockMetadataCache.searchTmdbByImdb.mockResolvedValue(filthTmdbFind);

				const body = await answer('tt1046922');

				expect(body.title).toBe('Filth: The Mary Whitehouse Story');
				expect(body.backdrop).not.toContain(atlanticTmdbTv.backdrop_path);
				expect(body.backdrop).toBe('');
				expect(body.poster).toBe(filthMdblist.poster);
				expect(mockMetadataCache.getTmdbTvInfo).not.toHaveBeenCalled();
			});

			// TV show 155 is 3rd Rock from the Sun, so production offered The Dark
			// Knight its six seasons and its "Ended".
			it("takes no seasons from the show that shares a movie's TMDB number", async () => {
				mockMdbClient.getInfoByImdbId.mockResolvedValue(darkKnightMdblist);
				mockMetadataCache.getCinemetaSeries.mockResolvedValue(darkKnightCinemeta);
				mockMetadataCache.getOmdbInfo.mockResolvedValue(darkKnightOmdb);
				mockMetadataCache.searchTmdbByImdb.mockResolvedValue(darkKnightTmdbFind);

				const body = await answer('tt0468569');

				expect(body.title).toBe('The Dark Knight');
				expect(thirdRockTmdbTv.number_of_seasons).toBe(6);
				expect(body.season_count).toBe(1);
				expect(body.status).toBeUndefined();
				expect(mockMetadataCache.getTmdbTvInfo).not.toHaveBeenCalled();
			});
		});

		// Trakt keys on the IMDb id alone. Waiting for mdblist — and now for the
		// deferred OMDb lookup too — put whole round trips on the critical path.
		it('starts the Trakt lookups without waiting for mdblist', async () => {
			let releaseMdb: (value: any) => void = () => {};
			mockMdbClient.getInfoByImdbId.mockReturnValue(
				new Promise((resolve) => {
					releaseMdb = resolve;
				})
			);
			mockMetadataCache.getCinemetaSeries.mockResolvedValue({});

			const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt0903747' } });
			const res = createMockResponse();
			const pending = handler(req, res);

			await new Promise((resolve) => setImmediate(resolve));

			// mdblist has not answered yet, so on the old ordering Trakt had not
			// been asked either.
			expect(mockMetadataCache.getTraktShowEpisode).toHaveBeenCalledWith(
				'tt0903747',
				'next_episode'
			);
			expect(mockMetadataCache.getTraktShowEpisode).toHaveBeenCalledWith(
				'tt0903747',
				'last_episode'
			);

			releaseMdb({ title: 'Arty' });
			await pending;
		});
	});

	it('still answers when OMDb itself fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockMdbClient.getInfoByImdbId.mockResolvedValue({ title: 'MDB Show' });
		mockMetadataCache.getCinemetaSeries.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockRejectedValue(new Error('Invalid API key!'));

		const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt1234567' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: 'MDB Show' }));
		warn.mockRestore();
	});
});
