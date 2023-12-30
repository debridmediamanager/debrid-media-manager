import { PlanetScaleCache } from '@/services/planetscale';
import axios from 'axios';
import { distance } from 'fastest-levenshtein';
import _ from 'lodash';
import { NextApiHandler } from 'next';

const omdbKey = process.env.OMDB_KEY;
const mdbKey = process.env.MDBLIST_KEY;
const searchOmdb = (keyword: string, year?: number, mediaType?: string) =>
	`https://www.omdbapi.com/?s=${keyword}&y=${year ?? ''}&apikey=${omdbKey}&type=${
		mediaType ?? ''
	}`;
const searchMdb = (keyword: string, year?: number, mediaType?: string) =>
	`https://mdblist.com/api/?apikey=${mdbKey}&s=${keyword}&y=${year ?? ''}&m=${mediaType ?? ''}`;
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
	score_average: number;
	distance?: number;
	matchCount?: number;
	searchTitle: string;
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

const currentYear = new Date().getFullYear() + 1;

async function searchOmdbApi(keyword: string, year?: number, mediaType?: string) {
	const searchResponse = await axios.get(
		searchOmdb(encodeURIComponent(keyword), year, mediaType)
	);
	if (searchResponse.data.Error || searchResponse.data.Response === 'False') {
		return [];
	}
	const results: MdbSearchResult[] = [...searchResponse.data.Search]
		.filter(
			(r: OmdbSearchResult) =>
				r.imdbID?.startsWith('tt') &&
				(r.Type === 'movie' || r.Type === 'series') &&
				parseInt(r.Year, 10) <= currentYear &&
				r.Poster !== 'N/A'
		)
		.map((r: OmdbSearchResult) => ({
			id: r.imdbID,
			type: r.Type === 'series' ? 'show' : 'movie',
			year: parseInt(r.Year, 10),
			title: r.Title,
			imdbid: r.imdbID,
			score: 1,
			score_average: 1,
			searchTitle: processSearchTitle(r.Title, articleRegex.test(keyword)),
		}));
	return results;
}

async function searchMdbApi(keyword: string, year?: number, mediaType?: string) {
	const searchResponse = await axios.get(searchMdb(encodeURIComponent(keyword), year, mediaType));
	if (searchResponse.data.error || !searchResponse.data.response) {
		return [];
	}
	const results: MdbSearchResult[] = [...searchResponse.data.search].filter(
		(r: MdbSearchResult) =>
			r.imdbid?.startsWith('tt') && r.year > 1888 && r.year <= currentYear && r.score > 0
	);
	return results.map((r: MdbSearchResult) => ({
		...r,
		searchTitle: processSearchTitle(r.title, articleRegex.test(keyword)),
	}));
}

function countSearchTerms(title: string, searchTerms: string[]): number {
	return searchTerms.reduce(
		(count, term) => (title.toLowerCase().includes(term) ? count + 1 : count),
		0
	);
}

const articleRegex = /^(the|a|an)\s+/i;

function removeLeadingArticles(str: string) {
	return str.replace(articleRegex, '');
}

function processSearchTitle(title: string, retainArticle: boolean) {
	const deburred = _.deburr(title);
	const lowercase = deburred.toLowerCase();
	const searchTitle = retainArticle ? lowercase : removeLeadingArticles(lowercase);
	return _.words(searchTitle).join(' ');
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

	if (keyword.length < 3) {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Keyword must be at least 3 characters',
		});
		return;
	}

	try {
		const cleanKeyword = keyword
			.toString()
			.replace(/[\W]+/gi, ' ')
			.split(' ')
			.filter((e) => e)
			.join(' ')
			.trim()
			.toLowerCase();
		const searchResults = await db.getSearchResults<MdbSearchResult[]>(
			encodeURIComponent(cleanKeyword)
		);
		if (searchResults) {
			res.status(200).json({ results: searchResults.filter((r) => r.imdbid) });
			return;
		}

		const [title, year, mediaType] = parseTitleAndYear(cleanKeyword);
		const searchQuery = title.toLowerCase();
		const [omdbResults, mdbResults] = await Promise.all([
			searchOmdbApi(searchQuery, year, mediaType),
			searchMdbApi(searchQuery, year, mediaType),
		]);
		let queryTerms = searchQuery.split(/\W/).filter((w) => w);
		if (queryTerms.length === 0) queryTerms = [searchQuery];
		// combine results and remove duplicates
		let results = [
			...mdbResults,
			...omdbResults.filter((mdbResult) => !mdbResults.find((r) => r.id === mdbResult.id)),
		]
			.map((result) => {
				const lowercaseTitle = result.title.toLowerCase();
				const distanceValue = distance(lowercaseTitle, searchQuery);
				if (articleRegex.test(lowercaseTitle)) {
					// whichever lower distance value is better
					const distanceValue2 = distance(result.searchTitle, searchQuery);
					if (distanceValue2 < distanceValue) {
						return {
							...result,
							distance: distanceValue2,
							matchCount: countSearchTerms(result.searchTitle, queryTerms),
						};
					}
				}
				return {
					...result,
					distance: distanceValue,
					matchCount: countSearchTerms(result.title, queryTerms),
				};
			})
			.filter((result) => result.matchCount >= Math.ceil(queryTerms.length / 2));

		let regex1 = new RegExp('^' + searchQuery + '$', 'i');
		let exactMatches = results.filter((result) => regex1.test(result.searchTitle));
		results = results.filter((result) => !regex1.test(result.searchTitle));

		let regex2 = new RegExp('^' + searchQuery, 'i');
		let startMatches = results.filter((result) => regex2.test(result.searchTitle));
		results = results.filter((result) => !regex2.test(result.searchTitle));

		let regex3 = new RegExp(searchQuery, 'i');
		let nearMatches = results.filter((result) => regex3.test(result.searchTitle));
		results = results.filter((result) => !regex3.test(result.searchTitle));

		// sort results by score
		exactMatches.sort(
			(a, b) =>
				(b.score_average * b.score) / 4 + b.year - (a.score_average * a.score) / 4 + a.year
		);
		startMatches.sort(
			(a, b) =>
				(b.score_average * b.score) / 4 + b.year - (a.score_average * a.score) / 4 + a.year
		);
		nearMatches.sort((a, b) => {
			if (a.distance === b.distance) {
				return (
					(b.score_average * b.score) / 4 +
					b.year -
					(a.score_average * a.score) / 4 +
					a.year
				);
			}
			return (a.distance ?? 0) - (b.distance ?? 0);
		});
		results.sort((a, b) => {
			if (a.matchCount === b.matchCount) {
				return (a.distance ?? 0) - (b.distance ?? 0);
			}
			return (b.matchCount ?? 0) - (a.matchCount ?? 0);
		});

		results = [...exactMatches, ...startMatches, ...nearMatches, ...results].filter(
			(r) => r.type === 'movie' || r.type === 'show' || r.type === 'series'
		);

		await db.saveSearchResults(keyword.toString().trim(), results);

		res.status(200).json({ results });
	} catch (error: any) {
		console.error('encountered a search issue', error);
		res.status(500).json({ status: 'error', errorMessage: error.message });
	}
};

export default handler;
