import {
	filterByTvConditions,
	getAllPossibleTitles,
	getSeasonNameAndCode,
	getSeasonYear,
	grabTvMetadata,
	padWithZero,
} from '@/utils/checks';
import { scrapeBtdigg } from './btdigg-v2';
import { scrapeJackett } from './jackett';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from './mediasearch';
import { PlanetScaleCache } from './planetscale';
import { scrapeProwlarr } from './prowlarr';

type TvScrapeJob = {
	titles: string[];
	year: string;
	seasonNumber: number;
	seasonName?: string;
	seasonCode?: number;
	seasonYear: string;
	airDate: string;
};

async function scrapeAll(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[][]> {
	return await Promise.all([
		scrapeBtdigg(finalQuery, targetTitle, years, airDate),
		scrapeProwlarr(finalQuery, targetTitle, years, airDate, 'tv'),
		scrapeJackett(finalQuery, targetTitle, years, airDate, 'tv'),
	]);
}

const getSearchResults = async (job: TvScrapeJob): Promise<ScrapeSearchResult[][]> => {
	let results: ScrapeSearchResult[][] = [];
	const years = [job.year, job.seasonYear].filter((y) => y !== undefined) as string[];
	for (let i = 0; i < job.titles.length; i++) {
		const title = job.titles[i];
		results.push(
			...(await scrapeAll(
				`"${title}" s${padWithZero(job.seasonNumber)}`,
				title,
				years,
				job.airDate
			))
		);
		if (job.seasonName && job.seasonCode) {
			results.push(
				...(await scrapeAll(
					`"${title}" ${job.seasonName} s${padWithZero(job.seasonCode)}`,
					title,
					years,
					job.airDate
				))
			);
		} else if (job.seasonName && job.seasonName !== title) {
			results.push(
				...(await scrapeAll(`"${title}" ${job.seasonName}`, title, years, job.airDate))
			);
		} else if (job.seasonNumber === 1) {
			results.push(...(await scrapeAll(`"${title}"`, title, years, job.airDate)));
		}
	}
	return results;
};

export async function scrapeTv(
	imdbId: string,
	tmdbData: any,
	mdbData: any,
	db: PlanetScaleCache,
	replaceOldScrape: boolean = false
): Promise<number> {
	const scrapeJobs: TvScrapeJob[] = [];

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

		scrapeJobs.push({
			titles,
			year,
			seasonNumber,
			seasonName,
			seasonCode,
			seasonYear,
			airDate,
		});
	}

	await db.saveScrapedResults(`processing:${imdbId}`, []);

	let totalResultsCount = 0;
	for (const job of scrapeJobs) {
		let searchResults: ScrapeSearchResult[][] = [];
		searchResults = await getSearchResults(job);
		let processedResults = flattenAndRemoveDuplicates(searchResults);
		processedResults = filterByTvConditions(
			processedResults,
			cleanTitle,
			year,
			job.seasonYear,
			job.seasonNumber,
			job.seasonName,
			job.seasonCode
		);
		if (processedResults.length) processedResults = sortByFileSize(processedResults);
		totalResultsCount += processedResults.length;

		await db.saveScrapedResults(
			`tv:${imdbId}:${job.seasonNumber}`,
			processedResults,
			true,
			replaceOldScrape
		);
		console.log(
			`📺 Saved ${processedResults.length} results for ${cleanTitle} season ${job.seasonNumber}`
		);
	}

	await db.markAsDone(imdbId);
	return totalResultsCount;
}
