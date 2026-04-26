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
		});
		consoleSpy.mockRestore();
	});
});
