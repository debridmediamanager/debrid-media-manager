import handler from '@/pages/api/info/movie';
import caskCinemeta from '@/test/fixtures/metadata/cinemeta-tt2249097-the-cask-of-amontillado.json';
import practicalMagicCinemeta from '@/test/fixtures/metadata/cinemeta-tt32588798-practical-magic-2.json';
import thundermansCinemeta from '@/test/fixtures/metadata/cinemeta-tt37752275-clash-of-the-thundermans.json';
import descendantsCinemeta from '@/test/fixtures/metadata/cinemeta-tt4925000-descendants-of-the-sun.json';
import caskMdblist from '@/test/fixtures/metadata/mdblist-tt2249097-the-cask-of-amontillado.json';
import practicalMagicMdblist from '@/test/fixtures/metadata/mdblist-tt32588798-practical-magic-2.json';
import thundermansMdblist from '@/test/fixtures/metadata/mdblist-tt37752275-clash-of-the-thundermans.json';
import descendantsMdblist from '@/test/fixtures/metadata/mdblist-tt4925000-descendants-of-the-sun.json';
import caskOmdb from '@/test/fixtures/metadata/omdb-tt2249097-the-cask-of-amontillado.json';
import practicalMagicOmdb from '@/test/fixtures/metadata/omdb-tt32588798-practical-magic-2.json';
import descendantsOmdb from '@/test/fixtures/metadata/omdb-tt4925000-descendants-of-the-sun.json';
import caskTmdbFind from '@/test/fixtures/metadata/tmdb-find-tt2249097-the-cask-of-amontillado.json';
import descendantsTmdbFind from '@/test/fixtures/metadata/tmdb-find-tt4925000-descendants-of-the-sun.json';
import zombieKingTmdbMovie from '@/test/fixtures/metadata/tmdb-movie-65143-enter-zombie-king.json';
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

describe('/api/info/movie', () => {
	const mockMdbClient = {
		getInfoByImdbId: vi.fn(),
	};
	const mockMetadataCache = {
		getCinemetaMovie: vi.fn(),
		getOmdbInfo: vi.fn().mockResolvedValue(null),
		getTmdbMovieInfo: vi.fn().mockResolvedValue(null),
		getTraktSummary: vi.fn().mockResolvedValue(null),
		searchTmdbByImdb: vi.fn().mockResolvedValue(null),
	};

	const tmdbEnv = { key: process.env.TMDB_KEY, token: process.env.TMDB_READ_TOKEN };

	beforeEach(() => {
		vi.clearAllMocks();
		mockMetadataCache.getTmdbMovieInfo.mockResolvedValue(null);
		mockMetadataCache.getTraktSummary.mockResolvedValue(null);
		mockMetadataCache.searchTmdbByImdb.mockResolvedValue(null);
		vi.mocked(getMdblistClient).mockReturnValue(mockMdbClient as any);
		vi.mocked(getMetadataCache).mockReturnValue(mockMetadataCache as any);
		// Fixtures carry a real tmdbid; without a credential the route skips the
		// TMDB trailer/release-date call rather than reaching the network.
		delete process.env.TMDB_KEY;
		delete process.env.TMDB_READ_TOKEN;
	});

	afterEach(() => {
		if (tmdbEnv.key === undefined) delete process.env.TMDB_KEY;
		else process.env.TMDB_KEY = tmdbEnv.key;
		if (tmdbEnv.token === undefined) delete process.env.TMDB_READ_TOKEN;
		else process.env.TMDB_READ_TOKEN = tmdbEnv.token;
	});

	it('rejects non-GET methods', async () => {
		const req = createMockRequest({ method: 'POST' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
	});

	it('requires an IMDb id', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'IMDB ID is required' });
	});

	it('merges mdblist and cinemeta metadata', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({
			title: 'MDB Title',
			description: 'MDB Desc',
			poster: 'mdb-poster',
			backdrop: 'mdb-backdrop',
			year: 2020,
			// mdblist scores IMDb out of 100: 83 is a rating of 8.3.
			ratings: [{ source: 'imdb', score: 83 }],
		});
		mockMetadataCache.getCinemetaMovie.mockResolvedValue({
			meta: {
				name: 'Cine Title',
				description: 'Cine Desc',
				poster: 'cine-poster',
				background: 'cine-bg',
				releaseInfo: '2021',
				imdbRating: '7.5',
			},
		});

		const req = createMockRequest({
			method: 'GET',
			query: { imdbid: 'tt1234567' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockMdbClient.getInfoByImdbId).toHaveBeenCalledWith('tt1234567');
		expect(mockMetadataCache.getCinemetaMovie).toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			title: 'MDB Title',
			description: 'MDB Desc',
			poster: 'mdb-poster',
			backdrop: 'mdb-backdrop',
			year: 2020,
			// mdblist wins over Cinemeta's 7.5: it is the source this route asks
			// first, and the one that is not already rounded.
			imdb_score: 83,
			trailer: '',
			digitalReleaseDate: '',
			expectedDigitalReleaseDate: '',
			expectedDigitalReleaseSource: null,
			digitalReleaseAvailable: false,
		});
	});

	it('falls back to OMDb when mdblist and cinemeta have nothing', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({});
		mockMetadataCache.getCinemetaMovie.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'True',
			Title: 'Guardians of the Galaxy: Vol. 2',
			Year: '2017',
			Plot: 'The Guardians struggle to keep together as a team.',
			Poster: 'https://m.media-amazon.com/images/M/guardians.jpg',
			imdbRating: '7.6',
		});

		const req = createMockRequest({
			method: 'GET',
			query: { imdbid: 'tt3896198' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Guardians of the Galaxy: Vol. 2',
				description: 'The Guardians struggle to keep together as a team.',
				poster: 'https://m.media-amazon.com/images/M/guardians.jpg',
				year: '2017',
				imdb_score: 76,
			})
		);
	});

	it('reports the rating mdblist has when it is the only source that has one', async () => {
		// Captured 2026-09-11, two days after this film opened: mdblist had rated
		// it 6.2, Cinemeta's imdbRating was an empty string and OMDb's was "N/A".
		// Production answered 0 for it, and the page hid the IMDb score entirely.
		mockMdbClient.getInfoByImdbId.mockResolvedValue(practicalMagicMdblist);
		mockMetadataCache.getCinemetaMovie.mockResolvedValue(practicalMagicCinemeta);
		mockMetadataCache.getOmdbInfo.mockResolvedValue(practicalMagicOmdb);

		const req = createMockRequest({
			method: 'GET',
			query: { imdbid: 'tt32588798' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Practical Magic 2',
				imdb_score: 62,
			})
		);
	});

	it('does not ask OMDb when mdblist and Cinemeta have already answered', async () => {
		// OMDb is the most rate-limited source DMM uses. On a title the other two
		// know, every field it could fill is already filled.
		mockMdbClient.getInfoByImdbId.mockResolvedValue(thundermansMdblist);
		mockMetadataCache.getCinemetaMovie.mockResolvedValue(thundermansCinemeta);

		const req = createMockRequest({
			method: 'GET',
			query: { imdbid: 'tt37752275' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockMetadataCache.getOmdbInfo).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Clash of the Thundermans',
				imdb_score: 46,
			})
		);
	});

	it('never renders OMDb’s "N/A" filler as real metadata', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({});
		mockMetadataCache.getCinemetaMovie.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'True',
			Title: 'Carmencita',
			Year: '1894',
			Plot: 'N/A',
			Poster: 'N/A',
			imdbRating: 'N/A',
		});

		const req = createMockRequest({
			method: 'GET',
			query: { imdbid: 'tt0000001' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Carmencita',
				description: 'n/a',
				poster: '',
				imdb_score: 0,
			})
		);
	});

	it('ignores OMDb when it has no answer for the id', async () => {
		mockMdbClient.getInfoByImdbId.mockResolvedValue({});
		mockMetadataCache.getCinemetaMovie.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockResolvedValue({
			Response: 'False',
			Error: 'Incorrect IMDb ID.',
		});

		const req = createMockRequest({
			method: 'GET',
			query: { imdbid: 'tt99999999' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Unknown', poster: '', year: '????' })
		);
	});

	it('still answers when OMDb itself fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockMdbClient.getInfoByImdbId.mockResolvedValue({ title: 'MDB Title' });
		mockMetadataCache.getCinemetaMovie.mockResolvedValue({});
		mockMetadataCache.getOmdbInfo.mockRejectedValue(new Error('Invalid API key!'));

		const req = createMockRequest({
			method: 'GET',
			query: { imdbid: 'tt1234567' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: 'MDB Title' }));
		warn.mockRestore();
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

		// The same TMDB response already supplies the release dates and trailer,
		// so its art cost nothing extra and was being thrown away.
		it('uses the art from the TMDB response it already fetched', async () => {
			mockMdbClient.getInfoByImdbId.mockResolvedValue({
				title: 'Arty',
				type: 'movie',
				tmdbid: 27205,
			});
			mockMetadataCache.getCinemetaMovie.mockResolvedValue({});
			mockMetadataCache.getTmdbMovieInfo.mockResolvedValue({
				poster_path: '/tmdb-poster.jpg',
				backdrop_path: '/tmdb-backdrop.jpg',
				release_date: '2010-07-16',
			});

			const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt1375666' } });
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
				type: 'movie',
				tmdbid: 27205,
				poster: 'mdb-poster',
			});
			mockMetadataCache.getCinemetaMovie.mockResolvedValue({
				meta: { background: 'cine-bg' },
			});
			mockMetadataCache.getTmdbMovieInfo.mockResolvedValue({
				poster_path: '/tmdb-poster.jpg',
				backdrop_path: '/tmdb-backdrop.jpg',
			});

			const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt1375666' } });
			const res = createMockResponse();

			await handler(req, res);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ poster: 'mdb-poster', backdrop: 'cine-bg' })
			);
		});

		// Fizzy #37. With no art anywhere the route used to answer a picsum.photos
		// stock photo seeded by the title, a picture of something else. 20 of 400
		// movies production served on 2026-10-03 ended there. The route now says
		// there is no backdrop, as it does for the poster, and the page draws its own.
		it('answers no backdrop, not a stock photo, when no provider has one', async () => {
			mockMdbClient.getInfoByImdbId.mockResolvedValue(caskMdblist);
			mockMetadataCache.getCinemetaMovie.mockResolvedValue(caskCinemeta);
			mockMetadataCache.getOmdbInfo.mockResolvedValue(caskOmdb);
			mockMetadataCache.searchTmdbByImdb.mockResolvedValue(caskTmdbFind);

			const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt2249097' } });
			const res = createMockResponse();

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(200);
			const body = vi.mocked(res.json).mock.calls[0][0];
			expect(body.title).toBe('The Cask of Amontillado');
			expect(body.poster).toBe(caskOmdb.Poster);
			expect(body.backdrop).toBe('');
			expect(mockMetadataCache.getTmdbMovieInfo).not.toHaveBeenCalled();
		});

		// Fizzy #200. mdblist's `tmdbid` is a show's id when its `type` is `show`,
		// and TMDB numbers movies and shows separately. Descendants of the Sun
		// (tt4925000) is a series, TV 65143 to mdblist; this route asked TMDB for
		// movie 65143, Enter... Zombie King!, and production titled the page after
		// it on 2026-10-04. TMDB's title leads the merged record, so a wrong TMDB
		// answer renames the page, not just its art. 5 of the 13 series production
		// served on this route that week were renamed this way.
		it("does not read a show's TMDB id as a movie's", async () => {
			mockMdbClient.getInfoByImdbId.mockResolvedValue(descendantsMdblist);
			mockMetadataCache.getCinemetaMovie.mockResolvedValue(descendantsCinemeta);
			mockMetadataCache.getOmdbInfo.mockResolvedValue(descendantsOmdb);
			mockMetadataCache.searchTmdbByImdb.mockResolvedValue(descendantsTmdbFind);
			mockMetadataCache.getTmdbMovieInfo.mockImplementation(async (id: number) =>
				id === 65143 ? zombieKingTmdbMovie : null
			);

			const res = createMockResponse();
			await handler(
				createMockRequest({ method: 'GET', query: { imdbid: 'tt4925000' } }),
				res
			);

			expect(res.status).toHaveBeenCalledWith(200);
			const body = vi.mocked(res.json).mock.calls[0][0];
			expect(zombieKingTmdbMovie.title).toBe('Enter... Zombie King!');
			expect(body.title).toBe('Descendants of the Sun');
			expect(body.year).toBe(2016);
			expect(mockMetadataCache.getTmdbMovieInfo).not.toHaveBeenCalled();
		});
	});

	it('still answers from Cinemeta when mdblist fails', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockMdbClient.getInfoByImdbId.mockRejectedValue(new Error('network down'));
		mockMetadataCache.getCinemetaMovie.mockResolvedValue({
			meta: { name: 'Cine Only', releaseInfo: '1999', description: 'desc' },
		});

		const res = createMockResponse();
		await handler(createMockRequest({ method: 'GET', query: { imdbid: 'tt7654321' } }), res);

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Cine Only', year: 1999 })
		);
	});

	it('falls back to default payload when every provider fails', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockMdbClient.getInfoByImdbId.mockRejectedValue(new Error('network down'));
		mockMetadataCache.getCinemetaMovie.mockRejectedValue(new Error('network down'));

		const req = createMockRequest({
			method: 'GET',
			query: { imdbid: 'tt7654321' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			title: 'Unknown',
			description: 'n/a',
			poster: '',
			backdrop: '',
			year: '????',
			imdb_score: 0,
			trailer: '',
			digitalReleaseDate: '',
			expectedDigitalReleaseDate: '',
			expectedDigitalReleaseSource: null,
			digitalReleaseAvailable: false,
		});
		consoleSpy.mockRestore();
	});
});
