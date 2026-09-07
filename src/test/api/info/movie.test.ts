import handler from '@/pages/api/info/movie';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getMdblistClient).mockReturnValue(mockMdbClient as any);
		vi.mocked(getMetadataCache).mockReturnValue(mockMetadataCache as any);
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
			ratings: [{ source: 'imdb', score: 8.3 }],
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
			imdb_score: 75,
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
