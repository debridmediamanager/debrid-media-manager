import { PlanetScaleCache } from '@/services/planetscale';
import axios from 'axios';
import { distance } from 'fastest-levenshtein';
import { NextApiHandler } from 'next';

const omdbKey = process.env.OMDB_KEY;
const mdbKey = process.env.MDBLIST_KEY;
const searchOmdb = (keyword: string, year?: number, mediaType?: string) =>
	`https://www.omdbapi.com/?s=${keyword}&y=${year}&apikey=${omdbKey}&type=${mediaType}`;
const searchMdb = (keyword: string, year?: number, mediaType?: string) =>
	`https://mdblist.com/api/?apikey=${mdbKey}&s=${keyword}&y=${year}&m=${mediaType}`;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdbKey}&i=${imdbId}`;
const db = new PlanetScaleCache();

export type MdbSearchResult = {
	id: string;
	type: 'movie' | 'show';
	year: number;
	title: string;
	imdbid: string;
	tmdbid?: string;
	season_count?: number;
	season_names?: string[];
	score: number;
};

type OmdbSearchResult = {
	Title: string;
	Year: string;
	imdbID: string;
	Type: string;
	Poster: string;
};

function parseTitleAndYear(searchQuery: string): [string, number?, string?] {
	if (searchQuery.trim().indexOf(' ') === -1) {
		return [searchQuery.trim(), undefined, undefined];
	}

	// Regex to find a year at the end of the search query
	const yearRegex = / (19\d{2}|20\d{2}|2100)$/;

	// Extract the year from the end of the search query
	const match = searchQuery.match(yearRegex);

	// If there's a year match and it's within the valid range, parse it
	let year: number | undefined;
	const currentYearPlusOne = new Date().getFullYear() + 1;
	if (match && match[0]) {
		const parsedYear = parseInt(match[0].trim(), 10);
		if (parsedYear >= 1900 && parsedYear <= currentYearPlusOne) {
			year = parsedYear;
			searchQuery = searchQuery.replace(yearRegex, '').trim();
		}
	}

	let mediaType: string | undefined;
	const mediaTypes = ['movie', 'show', 'series'];
	for (let word of mediaTypes) {
		if (searchQuery.includes(word)) {
			mediaType = word === 'series' ? 'show' : word;
			searchQuery = searchQuery.replace(word, '').trim();
			break;
		}
	}

	const title = searchQuery
		.split(' ')
		.filter((e) => e)
		.join(' ')
		.trim()
		.toLowerCase();

	return [title, year, mediaType];
}

async function searchOmdbApi(keyword: string, year?: number, mediaType?: string) {
	const searchResponse = await axios.get(
		searchOmdb(encodeURIComponent(keyword), year, mediaType)
	);
	if (searchResponse.data.Error || searchResponse.data.Response === 'False') {
		return [];
	}
	const results: MdbSearchResult[] = [...searchResponse.data.Search]
		.filter((r: OmdbSearchResult) => r.imdbID?.startsWith('tt'))
		.map((r: OmdbSearchResult) => ({
			id: r.imdbID,
			type: r.Type === 'series' ? 'show' : 'movie',
			year: parseInt(r.Year, 10),
			title: r.Title,
			imdbid: r.imdbID,
			score: 0,
		}));
	return results;
}

async function searchMdbApi(keyword: string, year?: number, mediaType?: string) {
	const searchResponse = await axios.get(searchMdb(encodeURIComponent(keyword), year, mediaType));
	if (searchResponse.data.error || !searchResponse.data.response) {
		return [];
	}
	const results: MdbSearchResult[] = [...searchResponse.data.search].filter(
		(r: MdbSearchResult) => r.imdbid?.startsWith('tt')
	);
	return results;
}

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
		const cleanKeyword = keyword
			.toString()
			.replace(/[\W]+/g, ' ')
			.split(' ')
			.filter((e) => e)
			.join(' ')
			.trim()
			.toLowerCase();
		const searchResults = await db.getSearchResults<any[]>(encodeURIComponent(cleanKeyword));
		if (searchResults) {
			res.status(200).json({ results: searchResults.filter((r) => r.imdbid) });
			return;
		}

		const [searchTerm, year, mediaType] = parseTitleAndYear(cleanKeyword);
		// search both APIs in parallel
		const [omdbResults, mdbResults] = await Promise.all([
			searchOmdbApi(searchTerm, year, mediaType),
			searchMdbApi(searchTerm, year, mediaType),
		]);
		// combine results and remove duplicates
		const results = [
			...omdbResults,
			...mdbResults.filter((mdbResult) => !omdbResults.find((r) => r.id === mdbResult.id)),
		];
		// sort result by levenstein distance to search term
		// start by computing the levenstein distance for each result
		results.forEach((result) => {
			const levensteinDistance = distance(result.title.toLowerCase(), searchTerm);
			result.score = levensteinDistance;
		});
		// sort results by levenstein distance
		results.sort((a, b) => a.score - b.score);

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
