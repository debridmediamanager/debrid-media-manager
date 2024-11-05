import { TmdbResponse } from '@/utils/tmdb';
import axios from 'axios';
import { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (context) => {
	const mdblistKey = process.env.MDBLIST_KEY;
	const tmdbKey = process.env.TMDB_API_KEY;
	const getTmdbInfo = (imdbId: string) =>
		`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
	const getMdbInfo = (imdbId: string) =>
		`https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
	const imdbId = context.params!.imdbid as string;

	try {
		// Try TMDB first
		const tmdbResp = await axios.get<TmdbResponse>(getTmdbInfo(imdbId));
		const movieResult = tmdbResp.data.movie_results[0];
		const tvResult = tmdbResp.data.tv_results[0];
		const posterPath = movieResult?.poster_path || tvResult?.poster_path;

		if (posterPath) {
			return {
				redirect: {
					destination: `https://image.tmdb.org/t/p/w500${posterPath}`,
					permanent: false,
				},
			};
		}

		// If no TMDB poster, try mdblist as fallback
		const mdbResp = await axios.get(getMdbInfo(imdbId));
		if (mdbResp.data.poster && mdbResp.data.poster.startsWith('http')) {
			return {
				redirect: {
					destination: mdbResp.data.poster,
					permanent: false,
				},
			};
		}

		// return a 404
		return {
			notFound: true,
		};
	} catch (error) {
		return {
			notFound: true,
		};
	}
};

export default function Mdblist() {
	return <></>;
}
