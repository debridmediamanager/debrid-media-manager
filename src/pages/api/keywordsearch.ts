import { PlanetScaleCache } from '@/services/planetscale';
import axios from 'axios';
import { NextApiHandler } from 'next';

const mdblistKey = process.env.MDBLIST_KEY;
const searchMdb = (keyword: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&s=${keyword}`;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
const tmdbSearchMovie = (keyword: string, tmdbKey: string) =>
	`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${keyword}&page=1`;
const tmdbSearchTv = (keyword: string, tmdbKey: string) =>
	`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${keyword}&page=1`;
const db = new PlanetScaleCache();

export type MdbSearchResult = {
	id: string;
	type: 'movie' | 'show';
	year: number;
	score: number;
	title: string;
	imdbid: string;
	tmdbid?: string;
	season_count?: number;
	season_names?: string[];
};

const handler: NextApiHandler = async (req, res) => {
	const { keyword } = req.query;

	if (!keyword || !(typeof keyword === 'string')) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Missing "keyword" query parameter',
		});
		return;
	}

	try {
		const cleanKeyword = encodeURIComponent(
			keyword.toString().replace(/[\W]+/g, ' ').split(' ').join(' ').trim().toLowerCase()
		);
		const searchResults = await db.getSearchResults<any[]>(cleanKeyword);
		if (searchResults) {
			res.status(200).json({ results: searchResults.filter((r) => r.imdbid) });
			return;
		}

		const searchResponse = await axios.get(searchMdb(cleanKeyword));
		const results: MdbSearchResult[] = [...searchResponse.data.search].filter(
			(result: any) => result.imdbid
		);

		for (let i = 0; i < results.length; i++) {
			if (results[i].type === 'show') {
				const showResponse = await axios.get(getMdbInfo(results[i].imdbid));
				if (showResponse.data.type === 'show' && showResponse.data.seasons?.length !== 0) {
					const seasons = showResponse.data.seasons.filter(
						(season: any) => season.season_number > 0
					);
					results[i].season_count = Math.max(
						...seasons.map((season: any) => {
							return season.season_number;
						})
					);
					results[i].season_names = seasons.map((season: any) => {
						return season.name;
					});
				} else {
					results[i].type = 'movie';
				}
			}
		}

		await db.saveSearchResults(keyword.toString().trim(), results);

		res.status(200).json({ results });
	} catch (error: any) {
		console.error('encountered a search issue', error);
		res.status(500).json({ status: 'error', errorMessage: error.message });
	}
};

export default handler;
