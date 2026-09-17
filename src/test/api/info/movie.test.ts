import handler from '@/pages/api/info/movie';
import practicalMagicCinemeta from '@/test/fixtures/metadata/cinemeta-tt32588798-practical-magic-2.json';
import thundermansCinemeta from '@/test/fixtures/metadata/cinemeta-tt37752275-clash-of-the-thundermans.json';
import practicalMagicMdblist from '@/test/fixtures/metadata/mdblist-tt32588798-practical-magic-2.json';
import thundermansMdblist from '@/test/fixtures/metadata/mdblist-tt37752275-clash-of-the-thundermans.json';
import practicalMagicOmdb from '@/test/fixtures/metadata/omdb-tt32588798-practical-magic-2.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import axios from 'axios';
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
	};

	const tmdbEnv = { key: process.env.TMDB_KEY, token: process.env.TMDB_READ_TOKEN };

	beforeEach(() => {
		vi.clearAllMocks();
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
			mockMdbClient.getInfoByImdbId.mockResolvedValue({ title: 'Arty', tmdbid: 27205 });
			mockMetadataCache.getCinemetaMovie.mockResolvedValue({});
			vi.spyOn(axios, 'get').mockResolvedValue({
				data: {
					poster_path: '/tmdb-poster.jpg',
					backdrop_path: '/tmdb-backdrop.jpg',
					release_date: '2010-07-16',
				},
			} as any);

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
				tmdbid: 27205,
				poster: 'mdb-poster',
			});
			mockMetadataCache.getCinemetaMovie.mockResolvedValue({
				meta: { background: 'cine-bg' },
			});
			vi.spyOn(axios, 'get').mockResolvedValue({
				data: { poster_path: '/tmdb-poster.jpg', backdrop_path: '/tmdb-backdrop.jpg' },
			} as any);

			const req = createMockRequest({ method: 'GET', query: { imdbid: 'tt1375666' } });
			const res = createMockResponse();

			await handler(req, res);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ poster: 'mdb-poster', backdrop: 'cine-bg' })
			);
		});
	});

	it('falls back to default payload on failure', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockMdbClient.getInfoByImdbId.mockRejectedValue(new Error('network down'));

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
			backdrop: 'https://picsum.photos/seed/movie/1800/300',
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
