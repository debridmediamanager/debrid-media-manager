import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMdblistClient, MDBListClient } from './mdblistClient';

vi.mock('axios');

const cacheStub = vi.hoisted(() => ({
	get: vi.fn(),
	getWithMetadata: vi.fn(),
	set: vi.fn(),
	cacheMovie: vi.fn(),
	cacheShow: vi.fn(),
	cacheSearch: vi.fn(),
	cacheList: vi.fn(),
	getCachedMovie: vi.fn(),
	getCachedShow: vi.fn(),
	getCachedSearch: vi.fn(),
	getCachedList: vi.fn(),
}));

vi.mock('./database/mdblistCache', () => ({
	getMdblistCacheService: () => cacheStub,
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

describe('MDBListClient', () => {
	let client: MDBListClient;
	const apiKey = 'test-api-key';

	beforeEach(() => {
		vi.clearAllMocks();
		Object.values(cacheStub).forEach((fn) => fn.mockReset());
		client = new MDBListClient(apiKey);
	});

	describe('search', () => {
		it('constructs correct URL with keyword only', async () => {
			const mockResponse = { search: [], total: 0, response: true };
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			await client.search('Inception');

			const call = vi.mocked(axios.get).mock.calls[0][0];
			expect(call).toContain('apikey=test-api-key');
			expect(call).toContain('s=Inception');
		});

		it('includes year parameter when provided', async () => {
			const mockResponse = { search: [], total: 0, response: true };
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			await client.search('Inception', 2010);

			const call = vi.mocked(axios.get).mock.calls[0][0];
			expect(call).toContain('y=2010');
		});

		it('includes media type parameter when provided', async () => {
			const mockResponse = { search: [], total: 0, response: true };
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			await client.search('Inception', undefined, 'movie');

			const call = vi.mocked(axios.get).mock.calls[0][0];
			expect(call).toContain('m=movie');
		});

		it('returns search response', async () => {
			const mockResponse = { search: [{ title: 'Inception' }], total: 1, response: true };
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			const result = await client.search('Inception');

			expect(result).toEqual(mockResponse);
		});
	});

	describe('getInfoByImdbId', () => {
		it('constructs correct URL with IMDB ID', async () => {
			const mockResponse = { imdbid: 'tt1375666', type: 'movie', title: 'Inception' };
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			await client.getInfoByImdbId('tt1375666');

			const call = vi.mocked(axios.get).mock.calls[0][0];
			expect(call).toContain('apikey=test-api-key');
			expect(call).toContain('i=tt1375666');
		});

		it('returns movie/show info', async () => {
			const mockResponse = { imdbid: 'tt1375666', type: 'movie', title: 'Inception' };
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			const result = await client.getInfoByImdbId('tt1375666');

			expect(result).toEqual(mockResponse);
		});

		// A movie row is written the first time anyone opens the page, which for an
		// anticipated title is months before release — so the cached copy holds a
		// placeholder synopsis and a teaser poster. Without an expiry that snapshot
		// was served forever, e.g. tt32093575 stuck on "Plot TBA." for seven months.
		it('refetches a movie cached more than 30 days ago', async () => {
			cacheStub.getWithMetadata.mockResolvedValue({
				data: { imdbid: 'tt32093575', type: 'movie', description: 'Plot TBA.' },
				updatedAt: daysAgo(31),
			});
			vi.mocked(axios.get).mockResolvedValue({
				data: { imdbid: 'tt32093575', type: 'movie', description: 'The real synopsis.' },
			});

			const result = await client.getInfoByImdbId('tt32093575');

			expect(axios.get).toHaveBeenCalled();
			expect((result as any).description).toBe('The real synopsis.');
			expect(cacheStub.set).toHaveBeenCalledWith(
				'tt32093575',
				'movie',
				expect.objectContaining({ description: 'The real synopsis.' })
			);
		});

		it('serves a movie from cache while the row is under 30 days old', async () => {
			cacheStub.getWithMetadata.mockResolvedValue({
				data: { imdbid: 'tt1375666', type: 'movie', title: 'Inception' },
				updatedAt: daysAgo(29),
			});

			const result = await client.getInfoByImdbId('tt1375666');

			expect(axios.get).not.toHaveBeenCalled();
			expect((result as any).title).toBe('Inception');
		});

		it('keeps the shorter 7 day expiry for shows', async () => {
			cacheStub.getWithMetadata.mockResolvedValue({
				data: { imdbid: 'tt0903747', type: 'show', title: 'Breaking Bad' },
				updatedAt: daysAgo(8),
			});
			vi.mocked(axios.get).mockResolvedValue({
				data: { imdbid: 'tt0903747', type: 'show', title: 'Breaking Bad', seasons: [] },
			});

			await client.getInfoByImdbId('tt0903747');

			expect(axios.get).toHaveBeenCalled();
		});

		// Expiry must degrade to stale data, not to no data: movie.ts renders a
		// failed lookup as "Unknown", which is a worse page than an old synopsis.
		it('falls back to the expired row when the refetch fails', async () => {
			const stale = { imdbid: 'tt32093575', type: 'movie', title: 'Scary Movie' };
			cacheStub.getWithMetadata.mockResolvedValue({ data: stale, updatedAt: daysAgo(200) });
			vi.mocked(axios.get).mockRejectedValue(new Error('mdblist rate limited'));

			const result = await client.getInfoByImdbId('tt32093575');

			expect(result).toEqual(stale);
			expect(cacheStub.set).not.toHaveBeenCalled();
		});

		it('rethrows when the fetch fails and nothing is cached', async () => {
			cacheStub.getWithMetadata.mockResolvedValue(null);
			vi.mocked(axios.get).mockRejectedValue(new Error('mdblist rate limited'));

			await expect(client.getInfoByImdbId('tt32093575')).rejects.toThrow(
				'mdblist rate limited'
			);
		});

		it('serves a show from cache while the row is under 7 days old', async () => {
			cacheStub.getWithMetadata.mockResolvedValue({
				data: { imdbid: 'tt0903747', type: 'show', title: 'Breaking Bad' },
				updatedAt: daysAgo(6),
			});

			await client.getInfoByImdbId('tt0903747');

			expect(axios.get).not.toHaveBeenCalled();
		});
	});

	describe('getInfoByTmdbId', () => {
		it('constructs correct URL with TMDB ID', async () => {
			const mockResponse = { tmdbid: 27205, type: 'movie', title: 'Inception' };
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			await client.getInfoByTmdbId(27205);

			const call = vi.mocked(axios.get).mock.calls[0][0];
			expect(call).toContain('apikey=test-api-key');
			expect(call).toContain('tm=27205');
		});

		it('accepts string TMDB ID', async () => {
			const mockResponse = { tmdbid: 27205, type: 'movie', title: 'Inception' };
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			await client.getInfoByTmdbId('27205');

			const call = vi.mocked(axios.get).mock.calls[0][0];
			expect(call).toContain('tm=27205');
		});

		it('returns movie/show info', async () => {
			const mockResponse = {
				tmdbid: 27205,
				type: 'movie',
				title: 'Inception',
				imdbid: 'tt1375666',
			};
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			const result = await client.getInfoByTmdbId(27205);

			expect(result).toEqual(mockResponse);
		});

		// This path had no freshness check at all, not even the show one.
		it('refetches a TMDB-keyed row past its expiry', async () => {
			const stale = { tmdbid: 27205, type: 'movie', title: 'Old Title' };
			cacheStub.get.mockResolvedValue(stale);
			cacheStub.getWithMetadata.mockResolvedValue({ data: stale, updatedAt: daysAgo(31) });
			vi.mocked(axios.get).mockResolvedValue({
				data: { tmdbid: 27205, type: 'movie', title: 'Corrected Title' },
			});

			const result = await client.getInfoByTmdbId(27205);

			expect(axios.get).toHaveBeenCalled();
			expect((result as any).title).toBe('Corrected Title');
		});
	});

	describe('searchLists', () => {
		it('constructs correct URL for list search', async () => {
			const mockResponse = [{ id: 1, name: 'Top Movies', slug: 'top-movies' }];
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			await client.searchLists('action');

			const call = vi.mocked(axios.get).mock.calls[0][0];
			expect(call).toContain('/lists/search');
			expect(call).toContain('apikey=test-api-key');
			expect(call).toContain('s=action');
		});

		it('returns list search results', async () => {
			const mockResponse = [{ id: 1, name: 'Top Movies' }];
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			const result = await client.searchLists('action');

			expect(result).toEqual(mockResponse);
		});

		it('refetches list search results older than 24 hours', async () => {
			const stale = [{ id: 1, name: 'Top Movies' }];
			cacheStub.getCachedList.mockResolvedValue(stale);
			cacheStub.getWithMetadata.mockResolvedValue({ data: stale, updatedAt: daysAgo(2) });
			const fresh = [{ id: 2, name: 'Newer List' }];
			vi.mocked(axios.get).mockResolvedValue({ data: fresh });

			const result = await client.searchLists('action');

			expect(axios.get).toHaveBeenCalled();
			expect(result).toEqual(fresh);
		});
	});

	describe('getListItems', () => {
		it('constructs correct URL for list items', async () => {
			const mockResponse = [{ id: 1, title: 'Movie 1', imdb_id: 'tt123' }];
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			await client.getListItems('123');

			const call = vi.mocked(axios.get).mock.calls[0][0];
			expect(call).toContain('/lists/123/items');
			expect(call).toContain('apikey=test-api-key');
		});

		it('returns list items', async () => {
			const mockResponse = [{ id: 1, title: 'Movie 1' }];
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			const result = await client.getListItems('123');

			expect(result).toEqual(mockResponse);
		});

		// Curated lists gain items over time, and the scrapers read them to decide
		// what to scrape — a frozen list means new titles are never picked up.
		it('refetches list items older than 24 hours', async () => {
			const stale = [{ id: 1, title: 'Movie 1' }];
			cacheStub.getCachedList.mockResolvedValue(stale);
			cacheStub.getWithMetadata.mockResolvedValue({
				data: stale,
				updatedAt: daysAgo(2),
			});
			const fresh = [
				{ id: 1, title: 'Movie 1' },
				{ id: 2, title: 'Movie 2' },
			];
			vi.mocked(axios.get).mockResolvedValue({ data: fresh });

			const result = await client.getListItems('123');

			expect(axios.get).toHaveBeenCalled();
			expect(result).toEqual(fresh);
		});

		it('serves list items from cache within 24 hours', async () => {
			const cachedItems = [{ id: 1, title: 'Movie 1' }];
			cacheStub.getWithMetadata.mockResolvedValue({
				data: cachedItems,
				updatedAt: new Date(Date.now() - 60 * 60 * 1000),
			});

			const result = await client.getListItems('123');

			expect(axios.get).not.toHaveBeenCalled();
			expect(result).toEqual(cachedItems);
		});
	});

	describe('getTopLists', () => {
		it('constructs correct URL for top lists', async () => {
			const mockResponse = [{ id: 1, name: 'Top Movies', items: 100 }];
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			await client.getTopLists();

			const call = vi.mocked(axios.get).mock.calls[0][0];
			expect(call).toContain('/lists/top');
			expect(call).toContain('apikey=test-api-key');
		});

		it('returns top lists', async () => {
			const mockResponse = [{ id: 1, name: 'Top Movies', items: 100 }];
			vi.mocked(axios.get).mockResolvedValue({ data: mockResponse });

			const result = await client.getTopLists();

			expect(result).toEqual(mockResponse);
		});
	});

	describe('deprecated URL methods', () => {
		it('getSearchUrl returns correct URL', () => {
			const url = client.getSearchUrl('Inception', 2010, 'movie');

			expect(url).toContain('apikey=test-api-key');
			expect(url).toContain('s=Inception');
			expect(url).toContain('y=2010');
			expect(url).toContain('m=movie');
		});

		it('getImdbInfoUrl returns correct URL', () => {
			const url = client.getImdbInfoUrl('tt1375666');

			expect(url).toContain('apikey=test-api-key');
			expect(url).toContain('i=tt1375666');
		});

		it('getTmdbInfoUrl returns correct URL', () => {
			const url = client.getTmdbInfoUrl(27205);

			expect(url).toContain('apikey=test-api-key');
			expect(url).toContain('tm=27205');
		});

		it('getSearchListsUrl returns correct URL', () => {
			const url = client.getSearchListsUrl('action');

			expect(url).toContain('/lists/search');
			expect(url).toContain('apikey=test-api-key');
			expect(url).toContain('s=action');
		});

		it('getListItemsUrl returns correct URL', () => {
			const url = client.getListItemsUrl('123');

			expect(url).toContain('/lists/123/items');
			expect(url).toContain('apikey=test-api-key');
		});

		it('getTopListsUrl returns correct URL', () => {
			const url = client.getTopListsUrl();

			expect(url).toContain('/lists/top');
			expect(url).toContain('apikey=test-api-key');
		});
	});
});

describe('getMdblistClient', () => {
	it('throws error when MDBLIST_KEY is not set', () => {
		const originalKey = process.env.MDBLIST_KEY;
		delete process.env.MDBLIST_KEY;

		expect(() => getMdblistClient()).toThrow('MDBLIST_KEY environment variable is not defined');

		if (originalKey) {
			process.env.MDBLIST_KEY = originalKey;
		}
	});

	it('creates and returns singleton instance', () => {
		const originalKey = process.env.MDBLIST_KEY;
		process.env.MDBLIST_KEY = 'test-key';

		const client1 = getMdblistClient();
		const client2 = getMdblistClient();

		expect(client1).toBe(client2);

		if (originalKey) {
			process.env.MDBLIST_KEY = originalKey;
		} else {
			delete process.env.MDBLIST_KEY;
		}
	});
});
