import { getMdblistClient } from '@/services/mdblistClient';
import { getTmdbKey } from '@/utils/freekeys';
import { TmdbResponse } from '@/utils/tmdb';
import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { imdbid } = req.query;

	if (!imdbid || typeof imdbid !== 'string') {
		return res.status(400).json({ error: 'IMDB ID is required' });
	}

	const mdblistClient = getMdblistClient();
	const getTmdbInfo = (imdbId: string) =>
		`https://api.themoviedb.org/3/find/${imdbId}?api_key=${getTmdbKey()}&external_source=imdb_id`;

	try {
		const tmdbResp = await axios.get<TmdbResponse>(getTmdbInfo(imdbid));
		const movieResult = tmdbResp.data.movie_results[0];
		const tvResult = tmdbResp.data.tv_results[0];
		const posterPath = movieResult?.poster_path || tvResult?.poster_path;

		if (posterPath) {
			return res.json({ url: `https://image.tmdb.org/t/p/w500${posterPath}` });
		}

		const mdbResp = await mdblistClient.getInfoByImdbId(imdbid);
		if (mdbResp.poster && mdbResp.poster.startsWith('http')) {
			return res.json({ url: mdbResp.poster });
		}

		return res.status(404).json({ error: 'Poster not found' });
	} catch (error) {
		return res.status(404).json({ error: 'Poster not found' });
	}
}
