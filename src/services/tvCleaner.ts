import {
	filterByTvConditions,
	getAllPossibleTitles,
	getSeasonNameAndCode,
	getSeasonYear,
	grabTvMetadata,
	meetsTitleConditions,
	padWithZero,
} from '@/utils/checks';
import axios from 'axios';
import { getMdblistClient } from './mdblistClient';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from './mediasearch';
import { Repository } from './repository';

type TvScrapeJob = {
	titles: string[];
	year: string;
	seasonNumber: number;
	seasonName?: string;
	seasonCode?: number;
	seasonYear?: string;
	airDate: string;
	scrapes: ScrapeSearchResult[];
};

const db = new Repository();
const mdblistClient = getMdblistClient();
const tmdbKey = process.env.TMDB_KEY;
const getTmdbSearch = (imdbId: string) =>
	`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
const getTmdbTvInfo = (tmdbId: string) =>
	`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${tmdbKey}`;

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
		mdbInfo = await mdblistClient.getInfoByImdbId(imdbId);
	} catch (error: any) {
		console.error(error);
		return;
	}

	const isTv = mdbInfo.type === 'show' || tmdbSearch.data.tv_results?.length > 0;
	if (isTv) {
		try {
			const tmdbId = mdbInfo.tmdbid ?? tmdbSearch.data.tv_results[0]?.id;
			const tmdbInfo = await axios.get(getTmdbTvInfo(String(tmdbId)));
			await cleanTvScrapes(imdbId, tmdbInfo.data, mdbInfo, db);
			return;
		} catch (error: any) {
			if (error.response?.status === 404 || error.message.includes("reading 'id'")) {
				try {
					const convertedMdb = convertMdbToTmdb(mdbInfo);
					await cleanTvScrapes(imdbId, convertedMdb, mdbInfo, db);
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
	years: string[],
	scrapes: ScrapeSearchResult[]
): ScrapeSearchResult[] {
	return scrapes.filter((scrape) => meetsTitleConditions(targetTitle, years, scrape.title));
}

const cleanBasedOnScrapeJob = (job: TvScrapeJob): ScrapeSearchResult[][] => {
	return job.titles.map((title) => {
		const years = [job.year, job.seasonYear].filter((y) => y !== undefined) as string[];
		return cleanScrapes(title, years, job.scrapes);
	});
};

export async function cleanTvScrapes(imdbId: string, tmdbData: any, mdbData: any, db: Repository) {
	const {
		cleanTitle,
		originalTitle,
		titleWithSymbols,
		alternativeTitle,
		cleanedTitle,
		year,
		seasons,
	} = grabTvMetadata(imdbId, tmdbData, mdbData);

	for (const season of seasons) {
		if (season.season_number === 0) continue;
		let seasonNumber = season.season_number;
		const { seasonName, seasonCode } = getSeasonNameAndCode(season);
		const seasonYear = getSeasonYear(season) ?? year;
		const airDate = season.air_date ?? '2000-01-01';

		const titles = getAllPossibleTitles([
			cleanTitle,
			originalTitle,
			cleanedTitle,
			titleWithSymbols,
			alternativeTitle,
		]);

		let scrapes: ScrapeSearchResult[] | undefined = await db.getScrapedResults(
			`tv:${imdbId}:${seasonNumber}`
		);
		if (!scrapes) {
			return;
		}
		const scrapesCount = scrapes.length;
		if (!scrapes.length) {
			console.log(`⚠️ No results for ${cleanTitle} S${padWithZero(seasonNumber)}}`);
			return;
		}

		scrapes = filterByTvConditions(
			scrapes,
			cleanTitle,
			year,
			seasonYear,
			seasonNumber,
			seasonName,
			seasonCode
		);
		if (!scrapes.length) {
			await db.saveScrapedResults(`tv:${imdbId}:${seasonNumber}`, scrapes, false, true);
			await db.markAsDone(imdbId);
			console.log(
				`⚠️ Preliminary procedure removed all results left for ${cleanTitle} S${padWithZero(seasonNumber)}`
			);
			continue;
		}

		const searchResults = cleanBasedOnScrapeJob({
			titles,
			year,
			seasonNumber,
			seasonName,
			seasonCode,
			seasonYear,
			airDate,
			scrapes,
		});
		let processedResults = flattenAndRemoveDuplicates(searchResults);
		processedResults = sortByFileSize(processedResults);
		if (processedResults.length < scrapesCount) {
			// await db.saveScrapedResults(
			// 	`tv:${imdbId}:${seasonNumber}`,
			// 	processedResults,
			// 	true,
			// 	true
			// );
			// await db.markAsDone(imdbId);
			console.log(
				`🌟 Removed ${scrapesCount - processedResults.length}, left ${
					processedResults.length
				} results for ${cleanTitle} S${padWithZero(seasonNumber)}}`
			);
			return;
		}

		console.log(
			`📺 Retained ${processedResults.length} results for ${cleanTitle} S${padWithZero(seasonNumber)}}`
		);
	}
}
