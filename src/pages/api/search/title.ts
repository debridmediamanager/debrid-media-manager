import { PlanetScaleCache } from '@/services/planetscale';
import axios from 'axios';
import { NextApiHandler } from 'next';

const mdblistKey = process.env.MDBLIST_KEY;
const searchMdb = (keyword: string, year?: number) => `https://mdblist.com/api/?apikey=${mdblistKey}&s=${keyword}&y=${year}`;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
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

function parseTitleAndYear(searchQuery: string): [string, number?] {
	// Get the current year + 1
	const currentYearPlusOne = new Date().getFullYear() + 1;

	// Regex to find a year at the end of the search query
	const yearRegex = / (19\d{2}|20\d{2}|2100)$/;

	// Check if the searchQuery is just a year
	if (yearRegex.test(searchQuery) && searchQuery.trim().length === 4) {
	  return [searchQuery.trim(), undefined];
	}

	// Extract the year from the end of the search query
	const match = searchQuery.match(yearRegex);

	let title: string = searchQuery;
	let year: number | undefined;

	// If there's a year match and it's within the valid range, parse it
	if (match && match[0]) {
	  const parsedYear = parseInt(match[0].trim(), 10);
	  if (parsedYear >= 1900 && parsedYear <= currentYearPlusOne) {
		year = parsedYear;
		// Remove the year from the title
		title = searchQuery.replace(yearRegex, '').trim();
	  }
	}

	return [title, year];
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
		const cleanKeyword = keyword.toString().replace(/[\W]+/g, ' ').split(' ').filter(e => e).join(' ').trim().toLowerCase();
		const searchResults = await db.getSearchResults<any[]>(encodeURIComponent(cleanKeyword));
		if (searchResults) {
			res.status(200).json({ results: searchResults.filter((r) => r.imdbid) });
			return;
		}

		const [searchTerm, year] = parseTitleAndYear(cleanKeyword);
		const searchResponse = await axios.get(searchMdb(encodeURIComponent(searchTerm), year));
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
