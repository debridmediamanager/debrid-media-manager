import { grabAllMetadata, grabYears, hasYear, meetsTitleConditions } from '@/utils/checks';
import axios from 'axios';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from './mediasearch';
import { PlanetScaleCache } from './planetscale';

type MovieScrapeJob = {
	titles: (string | undefined)[];
	year: string;
	airDate: string;
	scrapes: ScrapeSearchResult[];
};

const db = new PlanetScaleCache();
const tmdbKey = process.env.TMDB_KEY;
const getTmdbSearch = (imdbId: string) =>
	`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
const mdbKey = process.env.MDBLIST_KEY;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdbKey}&i=${imdbId}`;
const getTmdbMovieInfo = (tmdbId: string) =>
	`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbKey}`;

function convertMdbToTmdb(apiResponse: any) {
	return {
		title: apiResponse.title,
		name: apiResponse.title,
		release_date: apiResponse.released,
		// original_title: apiResponse.original_title, // This field does not exist in the provided API response
	};
}

export async function cleanByImdbId(imdbId: string) {
	let tmdbSearch, mdbInfo;
	try {
		tmdbSearch = await axios.get(getTmdbSearch(imdbId));
		mdbInfo = await axios.get(getMdbInfo(imdbId));
	} catch (error: any) {
		console.error(error);
		return;
	}

	const isMovie = mdbInfo.data.type === 'movie' || tmdbSearch.data.movie_results?.length > 0;

	if (isMovie) {
		try {
			const tmdbId = mdbInfo.data.tmdbid ?? tmdbSearch.data.movie_results[0]?.id;
			const tmdbInfo = await axios.get(getTmdbMovieInfo(tmdbId));
			await cleanMovieScrapes(imdbId, tmdbInfo.data, mdbInfo.data, db);
			return;
		} catch (error: any) {
			if (error.response?.status === 404 || error.message.includes("reading 'id'")) {
				try {
					const convertedMdb = convertMdbToTmdb(mdbInfo.data);
					await cleanMovieScrapes(imdbId, convertedMdb, mdbInfo.data, db);
					return;
				} catch (error: any) {
					console.error(error);
				}
			} else {
				console.error(error);
				return;
			}
		}
	}
	return;
}

function cleanScrapes(
	targetTitle: string,
	year: string,
	scrapes: ScrapeSearchResult[]
): ScrapeSearchResult[] {
	const ret = scrapes.filter((scrape) => meetsTitleConditions(targetTitle, year, scrape.title));
	return ret;
}

const cleanBasedOnScrapeJob = (job: MovieScrapeJob): ScrapeSearchResult[][] => {
	return job.titles.map((title) => (title ? cleanScrapes(title, job.year, job.scrapes) : []));
};

export async function cleanMovieScrapes(
	imdbId: string,
	tmdbData: any,
	mdbData: any,
	db: PlanetScaleCache
) {
	let scrapes: ScrapeSearchResult[] | undefined = await db.getScrapedResults(`movie:${imdbId}`);
	if (!scrapes) {
		return;
	}
	const scrapesCount = scrapes.length;
	if (!scrapes.length) {
		console.log(`! No results for ${mdbData.title} !`);
		return;
	}

	const {
		cleanTitle,
		originalTitle,
		titleWithSymbols,
		alternativeTitle,
		cleanedTitle,
		year,
		airDate,
	} = grabAllMetadata(imdbId, tmdbData, mdbData);

	// extra conditions based on media type = movie
	scrapes = scrapes
		.filter((result) => !/s\d\de\d\d/i.test(result.title))
		.filter((result) => result.fileSize < 200000 && result.fileSize > 500)
		.filter((result) => {
			const yearsFromTitle = grabYears(cleanTitle);
			const yearsFromFile = grabYears(result.title).filter(
				(y) => !yearsFromTitle.includes(y)
			);
			return yearsFromFile.length > 0 && hasYear(result.title, year);
		});
	if (!scrapes.length) {
		await db.saveScrapedResults(`movie:${imdbId}`, scrapes, false, true);
		console.log(`!!! Prelim Removed all results left for ${cleanTitle}`);
		return;
	}

	const titles = [cleanTitle, originalTitle, cleanedTitle, titleWithSymbols, alternativeTitle];
	titles.slice().forEach((title) => {
		if (title?.includes(' & ')) {
			titles.push(title.replace(' & ', ' and '));
		}
	});
	const searchResults = cleanBasedOnScrapeJob({
		titles,
		year,
		airDate,
		scrapes,
	});
	let processedResults = flattenAndRemoveDuplicates(searchResults);
	processedResults = sortByFileSize(processedResults);

	if (processedResults.length < scrapesCount) {
		await db.saveScrapedResults(`movie:${imdbId}`, processedResults, false, true);
		console.log(
			scrapes
				.filter((s) => !processedResults.find((p) => p.hash === s.hash))
				.map((s) => `⚡ ${s.title}`)
		);
		console.log(
			`🎥 Removed ${scrapesCount - processedResults.length}, left ${
				processedResults.length
			} results for ${cleanTitle}`
		);
	}
}
