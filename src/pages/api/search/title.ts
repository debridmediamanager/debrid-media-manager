import { getMdblistClient } from '@/services/mdblistClient';
import { Repository } from '@/services/repository';
import axios from 'axios';
import { distance } from 'fastest-levenshtein';
import _ from 'lodash';
import { NextApiHandler } from 'next';
import UserAgent from 'user-agents';

const omdbKey = process.env.OMDB_KEY;
const searchOmdb = (keyword: string, year?: number, mediaType?: string) =>
	`https://www.omdbapi.com/?s=${keyword}&y=${year ?? ''}&apikey=${omdbKey}&type=${
		mediaType ?? ''
	}`;
const searchCinemetaSeries = (keyword: string) =>
	`https://v3-cinemeta.strem.io/catalog/series/top/search=${keyword}.json`;
const searchCinemetaMovies = (keyword: string) =>
	`https://v3-cinemeta.strem.io/catalog/movie/top/search=${keyword}.json`;
const db = new Repository();

export type SearchResult = {
	id: string;
	type: 'movie' | 'show';
	year: number;
	title: string;
	imdbid: string;

	score: number;
	score_average: number;
	searchTitle: string;
};

type OmdbSearchResult = {
	Title: string;
	Year: string;
	imdbID: string;
	Type: string;
	Poster: string;
};

type CinemetaSearchResult = {
	id: string;
	imdb_id: string;
	type: string;
	name: string;
	releaseInfo: string;
	poster: string;
};

function parseQuery(searchQuery: string): [string, number?, string?] {
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

async function searchOmdbApi(
	keyword: string,
	year?: number,
	mediaType?: string
): Promise<SearchResult[]> {
	const searchResponse = await axios.get(
		searchOmdb(encodeURIComponent(keyword), year, mediaType)
	);
	if (searchResponse.data.Error || searchResponse.data.Response === 'False') {
		return [];
	}
	// console.log('omdb search response', searchResponse.data);
	const results: SearchResult[] = [...searchResponse.data.Search]
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

async function searchMdbApi(
	keyword: string,
	year?: number,
	mediaType?: string
): Promise<SearchResult[]> {
	const mdblistClient = getMdblistClient();
	const searchResponse = await mdblistClient.search(encodeURIComponent(keyword), year, mediaType);
	if (!searchResponse.response) {
		return [];
	}
	// console.log('mdb search response', searchResponse);
	const results = [...searchResponse.search].filter(
		(r) => r.imdbid?.startsWith('tt') && r.year > 1888 && r.year <= currentYear && r.score > 0
	) as any[];
	// console.log('mdb results', results.map(r => `${r.title} ${r.year} =>> ${processSearchTitle(r.title, articleRegex.test(keyword))}`));
	return results.map((r: SearchResult) => ({
		...r,
		searchTitle: processSearchTitle(r.title, articleRegex.test(keyword)),
	}));
}

async function searchCinemeta(keyword: string, mediaType?: string): Promise<SearchResult[]> {
	const promises = [];
	const requestConfig = {
		headers: {
			accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'accept-language': 'en-US,en;q=0.5',
			'accept-encoding': 'gzip, deflate, br',
			connection: 'keep-alive',
			'sec-fetch-dest': 'document',
			'sec-fetch-mode': 'navigate',
			'sec-fetch-site': 'same-origin',
			'sec-fetch-user': '?1',
			'upgrade-insecure-requests': '1',
			'user-agent': new UserAgent().toString(),
		},
	};
	if (!mediaType) {
		promises.push(axios.get(searchCinemetaSeries(encodeURIComponent(keyword)), requestConfig));
		promises.push(axios.get(searchCinemetaMovies(encodeURIComponent(keyword)), requestConfig));
	} else if (mediaType === 'movie') {
		promises.push(axios.get(searchCinemetaMovies(encodeURIComponent(keyword)), requestConfig));
	} else {
		promises.push(axios.get(searchCinemetaSeries(encodeURIComponent(keyword)), requestConfig));
	}
	const responses = await Promise.all(promises);
	// console.log('cinemeta search responses', responses.map((r) => r.data));
	const results: SearchResult[] = responses
		.filter((r) => r.data && r.data.metas)
		.map((r) => r.data.metas)
		.flat()
		.filter(
			(r: CinemetaSearchResult) =>
				r.imdb_id?.startsWith('tt') &&
				(r.type === 'movie' || r.type === 'series') &&
				parseInt(r.releaseInfo, 10) <= currentYear &&
				r.poster?.startsWith('http')
		)
		.map((r: CinemetaSearchResult) => ({
			id: r.id,
			type: r.type === 'series' ? 'show' : 'movie',
			year: parseInt(r.releaseInfo, 10),
			title: r.name,
			imdbid: r.imdb_id,
			score: 1,
			score_average: 1,
			searchTitle: processSearchTitle(r.name, articleRegex.test(keyword)),
		}));
	return results;
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
	// Shōgun -> shogun
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

	try {
		const cleanKeyword = keyword
			.toString()
			.replace(/[\W]+/gi, ' ')
			.split(' ')
			.filter((e) => e)
			.join(' ')
			.trim()
			.toLowerCase();
		const searchResults = await db.getSearchResults<SearchResult[]>(
			encodeURIComponent(cleanKeyword)
		);
		if (searchResults) {
			res.status(200).json({ results: searchResults.filter((r) => r.imdbid) });
			return;
		}

		const [title, year, mediaType] = parseQuery(cleanKeyword);
		const searchQuery = title.toLowerCase();
		const [omdbResults, mdbResults, cinemetaResults] = await Promise.all([
			searchOmdbApi(searchQuery, year, mediaType),
			searchMdbApi(searchQuery, year, mediaType),
			searchCinemeta(searchQuery, mediaType),
		]);
		let queryTerms = searchQuery.split(/\W/).filter((w) => w);
		if (queryTerms.length === 0) queryTerms = [searchQuery];

		// combine results and remove duplicates
		let results = [
			...mdbResults,
			...omdbResults.filter((mdbResult) => !mdbResults.find((r) => r.id === mdbResult.id)),
			...cinemetaResults.filter(
				(mdbResult) =>
					!mdbResults.find((r) => r.id === mdbResult.id) &&
					!omdbResults.find((r) => r.id === mdbResult.id)
			),
		].map((result) => {
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
				matchCount: countSearchTerms(result.searchTitle, queryTerms),
			};
		});
		// console.log('results', results);
		// filter out results with less than 1/3 of the search terms
		results = results.filter((result) => result.matchCount >= Math.ceil(queryTerms.length / 3));

		// search for exact matches
		let regex1 = new RegExp('^' + searchQuery + '$', 'i');
		let exactMatches = results.filter((result) => regex1.test(result.searchTitle));
		results = results.filter((result) => !regex1.test(result.searchTitle));

		// search for start matches
		let regex2 = new RegExp('^' + searchQuery, 'i');
		let startMatches = results.filter((result) => regex2.test(result.searchTitle));
		results = results.filter((result) => !regex2.test(result.searchTitle));

		// search for near matches
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

		if (results.length > 0 && results[0].title.toLowerCase().indexOf(searchQuery) >= 0) {
			await db.saveSearchResults(keyword.toString().trim(), results);
		}

		res.status(200).json({ results });
	} catch (error: any) {
		console.error(
			'Encountered a search issue:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ status: 'error', errorMessage: 'An internal error occurred' });
	}
};

export default handler;
