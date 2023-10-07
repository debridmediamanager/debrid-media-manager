import {
	filterByTvConditions,
	getAllPossibleTitles,
	getSeasonNameAndCode,
	getSeasonYear,
	grabTvMetadata,
	padWithZero,
} from '@/utils/checks';
import { filenameParse } from '@ctrl/video-filename-parser';
import { scrapeBtdigg } from './btdigg-v2';
import { scrapeJackett } from './jackett';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from './mediasearch';
import { PlanetScaleCache } from './planetscale';
import { scrapeProwlarr } from './prowlarr';

type TvScrapeJob = {
	titles: string[];
	seasonNumber: number;
	seasonName?: string;
	seasonCode?: number;
	seasonYear: string;
	airDate: string;
};

async function scrapeAll(
	finalQuery: string,
	targetTitle: string,
	airDate: string
): Promise<ScrapeSearchResult[][]> {
	return await Promise.all([
		scrapeBtdigg(finalQuery, targetTitle, airDate),
		scrapeProwlarr(finalQuery, targetTitle, airDate),
		scrapeJackett(finalQuery, targetTitle, airDate),
	]);
}

const getSearchResults = async (job: TvScrapeJob): Promise<ScrapeSearchResult[][]> => {
	let results: ScrapeSearchResult[][] = [];
	for (let i = 0; i < job.titles.length; i++) {
		const title = job.titles[i];
		results.push(
			...(await scrapeAll(`"${title}" s${padWithZero(job.seasonNumber)}`, title, job.airDate))
		);
		if (job.seasonName && job.seasonCode) {
			results.push(
				...(await scrapeAll(
					`"${title}" ${job.seasonName} s${padWithZero(job.seasonCode)}`,
					title,
					job.airDate
				))
			);
		} else if (job.seasonName && job.seasonName !== title) {
			results.push(...(await scrapeAll(`"${title}" ${job.seasonName}`, title, job.airDate)));
		} else if (job.seasonNumber === 1) {
			let results2 = [...(await scrapeAll(`"${title}"`, title, job.airDate))].flat();
			results2 = results2.filter((t) => filenameParse(t.title, true).title === title);
			results.push(results2);
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
			replaceOldScrape
		);
		console.log(
			`📺 Saved ${processedResults.length} results for ${cleanTitle} season ${job.seasonNumber}`
		);
	}

	await db.markAsDone(imdbId);
	return totalResultsCount;
}
