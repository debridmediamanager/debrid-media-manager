import { getMdblistCacheService } from '@/services/database/mdblistCache';
import { MDBListClient } from '@/services/mdblistClient';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('@/services/database/mdblistCache', () => ({
	getMdblistCacheService: vi.fn(),
}));

describe('MDBListClient cache expiration for TV shows', () => {
	const mockCache = {
		getWithMetadata: vi.fn(),
		set: vi.fn(),
		get: vi.fn(),
		cacheMovie: vi.fn(),
		cacheShow: vi.fn(),
		cacheSearch: vi.fn(),
		cacheList: vi.fn(),
		getCachedMovie: vi.fn(),
		getCachedShow: vi.fn(),
		getCachedSearch: vi.fn(),
		getCachedList: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getMdblistCacheService).mockReturnValue(mockCache as any);
	});

	it('refetches show data when cache is older than 7 days', async () => {
		const client = new MDBListClient('test-api-key');
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

		mockCache.getWithMetadata.mockResolvedValue({
			data: {
				type: 'show',
				title: 'Old Show Data',
				seasons: [{ season_number: 1, name: 'Season 1' }],
			},
			updatedAt: eightDaysAgo,
		});

		const freshData = {
			type: 'show',
			title: 'Fresh Show Data',
			seasons: [
				{ season_number: 1, name: 'Season 1' },
				{ season_number: 2, name: 'Season 2' },
			],
		};

		vi.mocked(axios.get).mockResolvedValue({
			data: freshData,
		});

		const result = await client.getInfoByImdbId('tt12345');

		expect(mockCache.getWithMetadata).toHaveBeenCalledWith('tt12345');
		expect(axios.get).toHaveBeenCalled();
		expect(mockCache.set).toHaveBeenCalledWith('tt12345', 'show', freshData);
		expect(result).toEqual(freshData);
	});

	it('uses cached show data when cache is less than 7 days old', async () => {
		const client = new MDBListClient('test-api-key');
		const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

		const cachedData = {
			type: 'show',
			title: 'Recent Show Data',
			seasons: [
				{ season_number: 1, name: 'Season 1' },
				{ season_number: 2, name: 'Season 2' },
			],
		};

		mockCache.getWithMetadata.mockResolvedValue({
			data: cachedData,
			updatedAt: threeDaysAgo,
		});

		const result = await client.getInfoByImdbId('tt12345');

		expect(mockCache.getWithMetadata).toHaveBeenCalledWith('tt12345');
		expect(axios.get).not.toHaveBeenCalled();
		expect(result).toEqual(cachedData);
	});

	it('refetches movie data when cache is older than 30 days', async () => {
		const client = new MDBListClient('test-api-key');
		const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

		mockCache.getWithMetadata.mockResolvedValue({
			data: {
				type: 'movie',
				title: 'Old Movie Data',
			},
			updatedAt: oneYearAgo,
		});

		const freshData = {
			type: 'movie',
			title: 'Fresh Movie Data',
		};

		vi.mocked(axios.get).mockResolvedValue({
			data: freshData,
		});

		const result = await client.getInfoByImdbId('tt99999');

		expect(mockCache.getWithMetadata).toHaveBeenCalledWith('tt99999');
		expect(axios.get).toHaveBeenCalled();
		expect(mockCache.set).toHaveBeenCalledWith('tt99999', 'movie', freshData);
		expect(result).toEqual(freshData);
	});

	it('uses cached movie data when cache is less than 30 days old', async () => {
		const client = new MDBListClient('test-api-key');
		const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

		const cachedData = {
			type: 'movie',
			title: 'Recent Movie Data',
		};

		mockCache.getWithMetadata.mockResolvedValue({
			data: cachedData,
			updatedAt: tenDaysAgo,
		});

		const result = await client.getInfoByImdbId('tt99999');

		expect(axios.get).not.toHaveBeenCalled();
		expect(result).toEqual(cachedData);
	});

	it('fetches fresh data when no cache exists', async () => {
		const client = new MDBListClient('test-api-key');

		mockCache.getWithMetadata.mockResolvedValue(null);

		const freshData = {
			type: 'show',
			title: 'New Show',
			seasons: [{ season_number: 1, name: 'Season 1' }],
		};

		vi.mocked(axios.get).mockResolvedValue({
			data: freshData,
		});

		const result = await client.getInfoByImdbId('tt77777');

		expect(mockCache.getWithMetadata).toHaveBeenCalledWith('tt77777');
		expect(axios.get).toHaveBeenCalled();
		expect(mockCache.set).toHaveBeenCalledWith('tt77777', 'show', freshData);
		expect(result).toEqual(freshData);
	});
});

describe('MDBListClient lookup by TVDB id', () => {
	const mockCache = {
		getWithMetadata: vi.fn(),
		set: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getMdblistCacheService).mockReturnValue(mockCache as any);
	});

	it('asks mdblist for a show by TVDB id and caches it under both ids', async () => {
		const client = new MDBListClient('test-api-key');
		mockCache.getWithMetadata.mockResolvedValue(null);

		const show = { type: 'show', title: 'Breaking Bad', imdbid: 'tt0903747' };
		vi.mocked(axios.get).mockResolvedValue({ data: show });

		const result = await client.getInfoByTvdbId(81189);

		const url = new URL(vi.mocked(axios.get).mock.calls[0][0] as string);
		expect(url.searchParams.get('tv')).toBe('81189');
		// A TVDB id always names a series, and mdblist needs the media type to
		// tell its id spaces apart.
		expect(url.searchParams.get('m')).toBe('show');

		expect(mockCache.set).toHaveBeenCalledWith('tvdb_81189', 'show', show);
		// The IMDb id is the point of the lookup, so the next caller asking by
		// that id skips the call entirely.
		expect(mockCache.set).toHaveBeenCalledWith('tt0903747', 'show', show);
		expect(result).toEqual(show);
	});

	it('serves a stale row rather than failing when mdblist is unreachable', async () => {
		const client = new MDBListClient('test-api-key');
		const cached = { type: 'show', title: 'Breaking Bad', imdbid: 'tt0903747' };
		mockCache.getWithMetadata.mockResolvedValue({
			data: cached,
			updatedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
		});
		vi.mocked(axios.get).mockRejectedValue(new Error('unreachable'));

		expect(await client.getInfoByTvdbId(81189)).toEqual(cached);
	});
});
