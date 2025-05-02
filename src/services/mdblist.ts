// MDBList API interface types
export type MList = {
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

export type MListItem = {
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

export type MRating = {
	source: string;
	value: number | null;
	score: number | null;
	votes: number | null;
	url?: string;
	popular?: number;
	id?: string | null;
};

export type MStream = {
	id: number;
	name: string;
};

export type MKeyword = {
	id: number;
	name: string;
};

export type MSeason = {
	tmdbid: number;
	name: string;
	air_date: string | null;
	episode_count: number;
	season_number: number;
	tomatofresh: null;
	poster_path: string;
};

export type MReview = {
	updated_at: string;
	author: string;
	rating: number;
	provider_id: number;
	content: string;
};

export type MWatchProvider = {
	id: number;
	name: string;
};

export type MMovie = {
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
	watch_providers: MWatchProvider[];
	reviews: MReview[];
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

export type MShow = {
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
	watch_providers: MWatchProvider[];
	reviews: MReview[];
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

export type MSearchResult = {
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

export type MSearchResponse = {
	search: MSearchResult[];
	total: number;
	response: boolean;
};
