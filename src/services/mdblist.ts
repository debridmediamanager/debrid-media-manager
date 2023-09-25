import axios from 'axios';

type MList = {
	id: number;
	name: string;
	slug: string;
	items: number;
	likes: number;
	user_id: number;
	mediatype: string;
	user_name: string;
	description: string;
};

type MListItem = {
	id: number;
	rank: number;
	adult: number; // or boolean if 0 represents false and 1 represents true
	title: string;
	imdb_id: string;
	mediatype: string;
	release_year: number;
	language: string;
	spoken_language: string;
};

type MRating = {
	source: string;
	value: number | null;
	score: number | null;
	votes: number | null;
	url?: string;
	popular?: number;
	id?: string | null;
};

type MStream = {
	id: number;
	name: string;
};

type MKeyword = {
	id: number;
	name: string;
};

type MSeason = {
	tmdbid: number;
	name: string;
	air_date: string | null;
	episode_count: number;
	season_number: number;
	tomatofresh: null;
	poster_path: string;
};

type MReview = {
	updated_at: string;
	author: string;
	rating: number;
	provider_id: number;
	content: string;
};

type MWatchProvider = {
	id: number;
	name: string;
};

type MMovie = {
	title: string;
	year: number;
	released: string;
	description: string;
	runtime: number;
	score: number;
	score_average: number;
	imdbid: string;
	traktid: number;
	tmdbid: number;
	type: string;
	ratings: MRating[];
	streams: MStream[]; // Replace with the appropriate type if you know the structure
	watch_providers: MWatchProvider[];
	reviews: MReview[]; // Replace with the appropriate type if you know the structure
	keywords: MKeyword[];
	language: string;
	spoken_language: string;
	country: string;
	certification: string;
	commonsense: number | null;
	age_rating: number;
	status: string;
	trailer: string;
	poster: string;
	backdrop: string;
	response: boolean;
	apiused: number;
};

type MShow = {
	title: string;
	year: number;
	released: string;
	description: string;
	runtime: number;
	score: number;
	score_average: number;
	imdbid: string;
	traktid: number;
	tmdbid: number;
	type: string;
	ratings: MRating[];
	streams: MStream[];
	watch_providers: MWatchProvider[]; // Replace with the appropriate type if you know the structure
	reviews: MReview[]; // Replace with the appropriate type if you know the structure
	keywords: MKeyword[];
	language: string;
	spoken_language: string;
	country: string;
	certification: string;
	commonsense: number;
	age_rating: number;
	status: string;
	trailer: string;
	poster: string;
	backdrop: string;
	response: boolean;
	apiused: number;
	tvdbid: number;
	seasons: MSeason[];
};

type MSearchResult = {
	id: string;
	title: string;
	year: number;
	score: number;
	score_average: number;
	type: string;
	imdbid: string;
	tmdbid: number;
	traktid: number;
};

type MSearchResponse = {
	search: MSearchResult[];
	total: number;
	response: boolean;
};

class MdbList {
	private mdblistKey: string;

	constructor() {
		this.mdblistKey = process.env.MDBLIST_KEY || 'demo';
	}

	async search(keyword: string): Promise<MSearchResponse> {
		return (await axios.get(`https://mdblist.com/api/?apikey=${this.mdblistKey}&s=${keyword}`))
			.data;
	}

	async getInfo(imdbId: string): Promise<MMovie | MShow> {
		return (await axios.get(`https://mdblist.com/api/?apikey=${this.mdblistKey}&i=${imdbId}`))
			.data;
	}

	async searchLists(term: string): Promise<MList[]> {
		return (
			await axios.get(
				`https://mdblist.com/api/lists/search?apikey=${this.mdblistKey}&s=${term}`
			)
		).data;
	}

	async listItems(listId: number): Promise<MListItem[]> {
		return (
			await axios.get(
				`https://mdblist.com/api/lists/${listId}/items?apikey=${this.mdblistKey}`
			)
		).data;
	}

	async topLists(): Promise<MList[]> {
		return (await axios.get(`https://mdblist.com/api/lists/top?apikey=${this.mdblistKey}`))
			.data;
	}
}

export default MdbList;
