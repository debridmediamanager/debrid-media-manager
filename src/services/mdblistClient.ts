import { mdblistReleaseSignals, metadataMaxAge } from '@/utils/metadataFreshness';
import { scrubRequestError } from '@/utils/requestRedaction';
import axios from 'axios';
import { getMdblistCacheService } from './database/mdblistCache';
import { MList, MListItem, MMovie, MShow } from './mdblist';

const ONE_HOUR = 3600000;
const ONE_DAY = 86400000;

// Shows already expired after 7 days; movies were served from the first fetch
// forever, which froze pre-release placeholder synopses and teaser posters in
// place indefinitely. Lists are curated collections that gain items over time.
// A failed lookup is not data: an id mdblist does not know today it may well
// know tomorrow, so a miss expires in an hour rather than in a show's 7 days.
// These are the lifetimes for a title that has settled. One still being rated —
// a recent or unreleased movie, a show still airing — expires far sooner; see
// `metadataMaxAge`, which reads that from the cached row itself.
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
	 * Every request goes through here. The key rides in the query string, and a
	 * failed request's Axios error repeats the URL in `config.url` and in the raw
	 * request line. mdblist answers a bad key or a rate limit with a 503, which
	 * axios throws, so the error is scrubbed before anything can log it: the
	 * stale-cache fallbacks below log it, and callers log what is rethrown.
	 */
	private async get(url: URL): Promise<any> {
		try {
			return (await axios.get(url.toString())).data;
		} catch (error) {
			scrubRequestError(error);
			throw error;
		}
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
				: metadataMaxAge(
						mdblistReleaseSignals(cached.data),
						isShow ? CACHE_TTL.SHOW : CACHE_TTL.MOVIE
					);
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
			response = await this.get(url);
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
	 * Get info for a show by TVDB ID.
	 *
	 * The reverse of the mapping `tvdbLookup` does: Sonarr identifies a series by
	 * its TVDB id and DMM keys everything on IMDb ids, so a Torznab search that
	 * arrives with only a `tvdbid` has to be translated before it can be answered.
	 * `m=show` is sent because a TVDB id always names a series, and mdblist needs
	 * the media type to disambiguate its id spaces.
	 */
	async getInfoByTvdbId(tvdbId: number | string): Promise<MMovie | MShow> {
		const cacheKey = `tvdb_${tvdbId}`;

		const cached = await this.cache.getWithMetadata(cacheKey);
		const cachedIsError = cached ? isMdblistError(cached.data) : false;
		if (cached) {
			const maxAge = cachedIsError
				? CACHE_TTL.ERROR
				: metadataMaxAge(mdblistReleaseSignals(cached.data), CACHE_TTL.SHOW);
			if (this.isFresh(cached.updatedAt, maxAge)) {
				console.log(`[MDBList] Using cached data for TVDB ID: ${tvdbId}`);
				return cached.data;
			}
		}

		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('tv', tvdbId.toString());
		url.searchParams.append('m', 'show');

		let response;
		try {
			response = await this.get(url);
		} catch (error) {
			if (cached) {
				console.error(
					`[MDBList] Refetch failed for TVDB ${tvdbId}, serving stale cache`,
					error
				);
				return cached.data;
			}
			throw error;
		}

		if (isMdblistError(response)) {
			if (cached && !cachedIsError) {
				console.error(
					`[MDBList] Error body for TVDB ${tvdbId} (${response?.error}), serving stale cache`
				);
				return cached.data;
			}
			await this.cache.set(cacheKey, 'error', response);
			console.log(`[MDBList] Cached error for TVDB ID: ${tvdbId} (${response?.error})`);
			return response;
		}

		const type = response.type === 'movie' ? 'movie' : 'show';
		await this.cache.set(cacheKey, type, response);
		console.log(`[MDBList] Cached ${type} data for TVDB ID: ${tvdbId}`);

		// The IMDb id is the whole point of the lookup, so cache it under that key
		// too — the next caller asking about the same show by IMDb id skips a call.
		if (response.imdbid) {
			await this.cache.set(response.imdbid, type, response);
		}

		return response;
	}

	/**
	 * A list endpoint answers an array. Anything else is an error body served
	 * with HTTP 200, like the legacy host's {"error":"API Limit Reached!"}:
	 * it is never cached or returned, because /api/info/browse shuffles the
	 * result and a non-array there spun each web replica until its health
	 * check killed it (2026-10-30).
	 */
	private async cachedList(
		cacheKey: string,
		ttl: number,
		label: string,
		fetch: () => Promise<any>
	): Promise<any[]> {
		const row = await this.cache.getWithMetadata(cacheKey);
		const cached = row && Array.isArray(row.data) ? row : null;
		if (cached && this.isFresh(cached.updatedAt, ttl)) {
			console.log(`[MDBList] Using cached ${label}`);
			return cached.data;
		}

		let response;
		try {
			response = await fetch();
		} catch (error) {
			if (cached) {
				console.error(`[MDBList] Refetch failed for ${label}, serving stale`, error);
				return cached.data;
			}
			throw error;
		}

		if (!Array.isArray(response)) {
			const reason = response?.error ?? 'not a list';
			if (cached) {
				console.error(`[MDBList] Error body for ${label} (${reason}), serving stale`);
				return cached.data;
			}
			throw new Error(`MDBList ${label}: ${reason}`);
		}

		await this.cache.cacheList(cacheKey, response);
		console.log(`[MDBList] Cached ${label}`);
		return response;
	}

	/**
	 * Search for lists by term. The legacy host's limit runs out while the
	 * account's on api.mdblist.com does not (2026-10-31), so lists use the new one.
	 */
	async searchLists(term: string): Promise<MList[]> {
		const url = new URL('https://api.mdblist.com/lists/search');
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('query', term);
		return this.cachedList(
			`list_search_${term}`,
			CACHE_TTL.LIST,
			`list search results for: ${term}`,
			() => this.get(url)
		);
	}

	/**
	 * Get every item of a list by list ID, movies and shows merged back into
	 * the list's own order.
	 */
	async getListItems(listId: string): Promise<MListItem[]> {
		return this.cachedList(
			`list_items_${listId}`,
			CACHE_TTL.LIST,
			`list items for ID: ${listId}`,
			async () => {
				const items: MListItem[] = [];
				for (let offset = 0; ;) {
					const page = await this.getListItemsPage(Number(listId), offset);
					items.push(...page.movies, ...page.shows);
					const read = page.movies.length + page.shows.length;
					if (!page.pagination?.has_more || read === 0) break;
					offset += read;
				}
				return items.sort((a, b) => a.rank - b.rank);
			}
		);
	}

	/**
	 * A list by the `/lists/{user}/{slug}` path of its mdblist.com page, as the
	 * newer api.mdblist.com host answers it: `[{id, name, items, private, ...}]`,
	 * empty for a list it does not have. Not cached: a sponsor following it
	 * expects what is on it now.
	 */
	async getListByPath(user: string, slug: string): Promise<MList[]> {
		const url = new URL(
			`https://api.mdblist.com/lists/${encodeURIComponent(user)}/${encodeURIComponent(slug)}`
		);
		url.searchParams.append('apikey', this.apiKey);
		const data = await this.get(url);
		return Array.isArray(data) ? data : [];
	}

	/**
	 * One page of a list's items from api.mdblist.com, which splits them into
	 * `movies` and `shows` and says in `pagination.has_more` whether to ask for
	 * the next `offset`. Not cached, for the same reason as `getListByPath`.
	 */
	async getListItemsPage(
		listId: number,
		offset: number,
		limit = 1000
	): Promise<{ movies: MListItem[]; shows: MListItem[]; pagination?: { has_more?: boolean } }> {
		const url = new URL(`https://api.mdblist.com/lists/${listId}/items`);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('limit', String(limit));
		url.searchParams.append('offset', String(offset));
		const data = await this.get(url);
		return {
			movies: Array.isArray(data?.movies) ? data.movies : [],
			shows: Array.isArray(data?.shows) ? data.shows : [],
			pagination: data?.pagination,
		};
	}

	/**
	 * Get top lists
	 */
	async getTopLists(): Promise<MList[]> {
		const url = new URL('https://api.mdblist.com/lists/top');
		url.searchParams.append('apikey', this.apiKey);
		return this.cachedList('top_lists', ONE_DAY, 'top lists', () => this.get(url));
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
