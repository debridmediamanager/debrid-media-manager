export type TmdbResponse = {
	movie_results: {
		title: string;
		overview: string;
		release_date: string;
		poster_path: string;
	}[];
	tv_results: {
		name: string;
		overview: string;
		first_air_date: string;
		poster_path: string;
	}[];
};
