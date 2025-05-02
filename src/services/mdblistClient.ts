import axios from 'axios';
import { MList, MMovie, MSearchResponse, MShow } from './mdblist';

export class MDBListClient {
	private apiKey: string;
	private baseUrl = 'https://mdblist.com/api';

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	/**
	 * Search for movies and shows by keyword
	 */
	async search(keyword: string, year?: number, mediaType?: string): Promise<MSearchResponse> {
		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('s', keyword);

		if (year) {
			url.searchParams.append('y', year.toString());
		}

		if (mediaType) {
			url.searchParams.append('m', mediaType);
		}

		return (await axios.get(url.toString())).data;
	}

	/**
	 * Get info for a movie or show by IMDB ID
	 */
	async getInfoByImdbId(imdbId: string): Promise<MMovie | MShow> {
		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('i', imdbId);

		return (await axios.get(url.toString())).data;
	}

	/**
	 * Get info for a movie or show by TMDB ID
	 */
	async getInfoByTmdbId(tmdbId: number | string): Promise<MMovie | MShow> {
		const url = new URL(this.baseUrl);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('tm', tmdbId.toString());

		return (await axios.get(url.toString())).data;
	}

	/**
	 * Search for lists by term
	 */
	async searchLists(term: string): Promise<any> {
		const url = new URL(`${this.baseUrl}/lists/search`);
		url.searchParams.append('apikey', this.apiKey);
		url.searchParams.append('s', term);

		return (await axios.get(url.toString())).data;
	}

	/**
	 * Get items from a list by list ID
	 */
	async getListItems(listId: string): Promise<any> {
		const url = new URL(`${this.baseUrl}/lists/${listId}/items`);
		url.searchParams.append('apikey', this.apiKey);

		return (await axios.get(url.toString())).data;
	}

	/**
	 * Get top lists
	 */
	async getTopLists(): Promise<MList[]> {
		const url = new URL(`${this.baseUrl}/lists/top`);
		url.searchParams.append('apikey', this.apiKey);

		return (await axios.get(url.toString())).data;
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
