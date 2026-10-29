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
	/** api.mdblist.com says it; the legacy host leaves it out. */
	private?: boolean;
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
	streams: any[];
	watch_providers: any[];
	reviews: any[];
	keywords: any[];
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
	streams: any[];
	watch_providers: any[];
	reviews: any[];
	keywords: any[];
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
	seasons: any[];
};

export type MSearchResponse = {
	search: any[];
	total: number;
	response: boolean;
};
