import axios from 'axios';
import { getMdblistCacheService } from './database/mdblistCache';
import { MList, MMovie, MSearchResponse, MShow } from './mdblist';

const ONE_HOUR = 3600000;
const ONE_DAY = 86400000;

// Shows already expired after 7 days; movies were served from the first fetch
// forever, which froze pre-release placeholder synopses and teaser posters in
// place indefinitely. Lists are curated collections that gain items over time.
// A failed lookup is not data: an id mdblist does not know today it may well
// know tomorrow, so a miss expires in an hour rather than in a show's 7 days.
const CACHE_TTL = {
	MOVIE: 30 * ONE_DAY,
	SHOW: 7 * ONE_DAY,
	LIST: ONE_DAY,
	ERROR: ONE_HOUR,
};

// mdblist reports a miss, a bad key and a rate limit as HTTP 200 with a body of
// {"response": false, "error": "..."} — the legacy host spells the flag as the
// string "False" — so axios resolves and the error reaches the cache looking
// like a title. A real title carries no `response` field at all.
export function isMdblistError(data: any): boolean {
	if (!data || typeof data !== 'object') return true;
	return data.response === false || data.response === 'False';
}

export class MDBListClient {
	private apiKey: string;
	private baseUrl = 'https://mdblist.com/api';
	private cache = getMdblistCacheService();

	private isFresh(updatedAt: Date, maxAge: number): boolean {
		return Date.now() - updatedAt.getTime() < maxAge;
	}

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	/**
	 * Search for movies and shows by keyword
	 */
	async search(keyword: string, year?: number, mediaType?: string): Promise<MSearchResponse> {
		// Create cache key from search parameters
		const cacheKey = `search_${keyword}_${year || ''}_${mediaType || ''}`;

		// Check cache first (with 1 hour expiration for search results)
		const cached = await this.cache.getWithMetadata(cacheKey);
		if (cached && this.isFresh(cached.updatedAt, ONE_HOUR)) {
			console.log(`[MDBList] Using cached search results for: ${cacheKey}`);
			return cached.data;
		}

		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('s', keyword);

		if (year) {
			url.searchParams.append('y', year.toString());
		}

		if (mediaType) {
			url.searchParams.append('m', mediaType);
		}

		const response = (await axios.get(url.toString())).data;

		// Cache the response
		await this.cache.cacheSearch(cacheKey, response);
		console.log(`[MDBList] Cached search results for: ${cacheKey}`);

		return response;
	}

	/**
	 * Get info for a movie or show by IMDB ID
	 */
	async getInfoByImdbId(imdbId: string): Promise<MMovie | MShow> {
		const cached = await this.cache.getWithMetadata(imdbId);
		const cachedIsError = cached ? isMdblistError(cached.data) : false;
		if (cached) {
			const isShow = cached.data.type === 'show';
			const kind = cachedIsError ? 'error' : isShow ? 'show' : 'movie';
			const maxAge = cachedIsError
				? CACHE_TTL.ERROR
				: isShow
					? CACHE_TTL.SHOW
					: CACHE_TTL.MOVIE;
			const cacheAge = Date.now() - cached.updatedAt.getTime();

			if (this.isFresh(cached.updatedAt, maxAge)) {
				console.log(`[MDBList] Using cached data for IMDB ID: ${imdbId}`);
				return cached.data;
			}

			console.log(
				`[MDBList] Cache expired for ${kind} ${imdbId} (age: ${Math.floor(cacheAge / ONE_DAY)} days), refetching`
			);
		}

		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('i', imdbId);

		let response;
		try {
			response = (await axios.get(url.toString())).data;
		} catch (error) {
			// An expired row is still better than none — callers render a failed
			// lookup as "Unknown", which is a worse page than slightly old metadata.
			if (cached) {
				console.error(`[MDBList] Refetch failed for ${imdbId}, serving stale cache`, error);
				return cached.data;
			}
			throw error;
		}

		if (isMdblistError(response)) {
			// A rate limit fires against ids mdblist knows perfectly well, so it
			// must never demote a row that already holds a real title.
			if (cached && !cachedIsError) {
				console.error(
					`[MDBList] Error body for ${imdbId} (${response?.error}), serving stale cache`
				);
				return cached.data;
			}
			await this.cache.set(imdbId, 'error', response);
			console.log(`[MDBList] Cached error for IMDB ID: ${imdbId} (${response?.error})`);
			return response;
		}

		const type = response.type === 'movie' ? 'movie' : 'show';
		await this.cache.set(imdbId, type, response);
		console.log(`[MDBList] Cached ${type} data for IMDB ID: ${imdbId}`);

		return response;
	}

	/**
	 * Get info for a movie or show by TMDB ID
	 */
	async getInfoByTmdbId(tmdbId: number | string): Promise<MMovie | MShow> {
		const cacheKey = `tmdb_${tmdbId}`;

		// Check cache first
		const cached = await this.cache.getWithMetadata(cacheKey);
		const cachedIsError = cached ? isMdblistError(cached.data) : false;
		if (cached) {
			const maxAge = cachedIsError
				? CACHE_TTL.ERROR
				: cached.data.type === 'show'
					? CACHE_TTL.SHOW
					: CACHE_TTL.MOVIE;
			if (this.isFresh(cached.updatedAt, maxAge)) {
				console.log(`[MDBList] Using cached data for TMDB ID: ${tmdbId}`);
				return cached.data;
			}
		}

		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('tm', tmdbId.toString());

		let response;
		try {
			response = (await axios.get(url.toString())).data;
		} catch (error) {
			if (cached) {
				console.error(
					`[MDBList] Refetch failed for TMDB ${tmdbId}, serving stale cache`,
					error
				);
				return cached.data;
			}
			throw error;
		}

		if (isMdblistError(response)) {
			if (cached && !cachedIsError) {
				console.error(
					`[MDBList] Error body for TMDB ${tmdbId} (${response?.error}), serving stale cache`
				);
				return cached.data;
			}
			await this.cache.set(cacheKey, 'error', response);
			console.log(`[MDBList] Cached error for TMDB ID: ${tmdbId} (${response?.error})`);
			return response;
		}

		// Determine type and cache accordingly
		const type = response.type === 'movie' ? 'movie' : 'show';
		await this.cache.set(cacheKey, type, response);
		console.log(`[MDBList] Cached ${type} data for TMDB ID: ${tmdbId}`);

		// Also cache by IMDB ID if available
		if (response.imdbid) {
			await this.cache.set(response.imdbid, type, response);
			console.log(`[MDBList] Also cached by IMDB ID: ${response.imdbid}`);
		}

		return response;
	}

	/**
	 * Search for lists by term
	 */
	async searchLists(term: string): Promise<any> {
		const cacheKey = `list_search_${term}`;

		// Check cache first
		const cached = await this.cache.getWithMetadata(cacheKey);
		if (cached && this.isFresh(cached.updatedAt, CACHE_TTL.LIST)) {
			console.log(`[MDBList] Using cached list search results for: ${term}`);
			return cached.data;
		}

		const url = new URL(`${this.baseUrl}/lists/search`);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('s', term);

		let response;
		try {
			response = (await axios.get(url.toString())).data;
		} catch (error) {
			if (cached) {
				console.error(
					`[MDBList] Refetch failed for list search ${term}, serving stale`,
					error
				);
				return cached.data;
			}
			throw error;
		}

		// Cache the response
		await this.cache.cacheList(cacheKey, response);
		console.log(`[MDBList] Cached list search results for: ${term}`);

		return response;
	}

	/**
	 * Get items from a list by list ID
	 */
	async getListItems(listId: string): Promise<any> {
		const cacheKey = `list_items_${listId}`;

		// Check cache first
		const cached = await this.cache.getWithMetadata(cacheKey);
		if (cached && this.isFresh(cached.updatedAt, CACHE_TTL.LIST)) {
			console.log(`[MDBList] Using cached list items for ID: ${listId}`);
			return cached.data;
		}

		const url = new URL(`${this.baseUrl}/lists/${listId}/items`);
		url.searchParams.append('apikey', this.apiKey);

		let response;
		try {
			response = (await axios.get(url.toString())).data;
		} catch (error) {
			if (cached) {
				console.error(`[MDBList] Refetch failed for list ${listId}, serving stale`, error);
				return cached.data;
			}
			throw error;
		}

		// Cache the response
		await this.cache.cacheList(cacheKey, response);
		console.log(`[MDBList] Cached list items for ID: ${listId}`);

		return response;
	}

	/**
	 * Get top lists
	 */
	async getTopLists(): Promise<MList[]> {
		const cacheKey = 'top_lists';

		// Check cache first (with 24 hour expiration for top lists)
		const cached = await this.cache.getWithMetadata(cacheKey);
		if (cached && this.isFresh(cached.updatedAt, ONE_DAY)) {
			console.log(`[MDBList] Using cached top lists`);
			return cached.data;
		}

		const url = new URL(`${this.baseUrl}/lists/top`);
		url.searchParams.append('apikey', this.apiKey);

		const response = (await axios.get(url.toString())).data;

		// Cache the response
		await this.cache.cacheList(cacheKey, response);
		console.log(`[MDBList] Cached top lists`);

		return response;
	}

	/**
	 * Get URL for searching by keyword
	 * @deprecated Use search() method instead
	 */
	getSearchUrl(keyword: string, year?: number, mediaType?: string): string {
		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('s', keyword);

		if (year) {
			url.searchParams.append('y', year.toString());
		}

		if (mediaType) {
			url.searchParams.append('m', mediaType || '');
		}

		return url.toString();
	}

	/**
	 * Get URL for fetching info by IMDB ID
	 * @deprecated Use getInfoByImdbId() method instead
	 */
	getImdbInfoUrl(imdbId: string): string {
		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('i', imdbId);

		return url.toString();
	}

	/**
	 * Get URL for fetching info by TMDB ID
	 * @deprecated Use getInfoByTmdbId() method instead
	 */
	getTmdbInfoUrl(tmdbId: number | string): string {
		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('tm', tmdbId.toString());

		return url.toString();
	}

	/**
	 * Get URL for searching lists
	 * @deprecated Use searchLists() method instead
	 */
	getSearchListsUrl(term: string): string {
		const url = new URL(`${this.baseUrl}/lists/search`);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('s', term);

		return url.toString();
	}

	/**
	 * Get URL for fetching list items
	 * @deprecated Use getListItems() method instead
	 */
	getListItemsUrl(listId: string): string {
		const url = new URL(`${this.baseUrl}/lists/${listId}/items`);
		url.searchParams.append('apikey', this.apiKey);

		return url.toString();
	}

	/**
	 * Get URL for fetching top lists
	 * @deprecated Use getTopLists() method instead
	 */
	getTopListsUrl(): string {
		const url = new URL(`${this.baseUrl}/lists/top`);
		url.searchParams.append('apikey', this.apiKey);

		return url.toString();
	}
}

// Create a singleton instance with the API key from environment
let mdblistClientInstance: MDBListClient | null = null;

export function getMdblistClient(): MDBListClient {
	if (!mdblistClientInstance) {
		const apiKey = process.env.MDBLIST_KEY;

		if (!apiKey) {
			throw new Error('MDBLIST_KEY environment variable is not defined');
		}

		mdblistClientInstance = new MDBListClient(apiKey);
	}

	return mdblistClientInstance;
}
