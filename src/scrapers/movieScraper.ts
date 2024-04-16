import {
	ScrapeSearchResult,
	flattenAndRemoveDuplicates,
	sortByFileSize,
} from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import { filterByMovieConditions, getAllPossibleTitles, grabMovieMetadata } from '@/utils/checks';
import { scrapeApiBay2 } from './sites/apibay2';
import { scrapeBtdigg } from './sites/btdigg-v2';
import { scrapeGloTorrents } from './sites/glotorrents';
import { scrapeMagnetDL } from './sites/magnetdl';
import { scrapeRuTor } from './sites/rutor';
import { scrapeSolidTorrent } from './sites/solidtorrent';
import { scrapeTorrentGalaxy } from './sites/tgx';

type MovieScrapeJob = {
	titles: string[];
	year: string;
	airDate: string;
	imdbId: string;
};

async function scrapeAll(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string,
	imdbId: string
): Promise<ScrapeSearchResult[][]> {
	return await Promise.all([
		scrapeApiBay2(finalQuery.replaceAll('"', ''), targetTitle, years, airDate),
		scrapeBtdigg(finalQuery, targetTitle, years, airDate),
		scrapeGloTorrents(finalQuery.replaceAll('"', ''), targetTitle, years, airDate),
		scrapeMagnetDL(finalQuery.replaceAll('"', ''), targetTitle, years, airDate),
		scrapeRuTor(finalQuery.replaceAll('"', ''), targetTitle, years, airDate),
		scrapeSolidTorrent(finalQuery, targetTitle, years, airDate),
		scrapeTorrentGalaxy(finalQuery.replaceAll('"', ''), targetTitle, years, airDate),
	]);
}

const processMovieJob = async (job: MovieScrapeJob): Promise<ScrapeSearchResult[][]> => {
	const years = [job.year, job.airDate.substring(0, 4)].filter(
		(y) => y !== undefined
	) as string[];
	const results: ScrapeSearchResult[][] = [];
	for (let i = 0; i < job.titles.length; i++) {
		const title = job.titles[i];
		results.push(
			...(await scrapeAll(`"${title}" ${job.year}`, title, years, job.airDate, job.imdbId))
		);
		results.push(...(await scrapeAll(`"${title}"`, title, years, job.airDate, job.imdbId)));
	}
	return results;
};

export async function scrapeMovies(
	imdbId: string,
	tmdbData: any,
	mdbData: any,
	db: PlanetScaleCache,
	replaceOldScrape: boolean = false
): Promise<number> {
	const {
		cleanTitle,
		originalTitle,
		titleWithSymbols,
		alternativeTitle,
		cleanedTitle,
		year,
		airDate,
	} = grabMovieMetadata(imdbId, tmdbData, mdbData);

	await db.saveScrapedResults(`processing:${imdbId}`, []);

	const titles = getAllPossibleTitles([
		cleanTitle,
		originalTitle,
		cleanedTitle,
		titleWithSymbols,
		alternativeTitle,
	]);
	const searchResults = await processMovieJob({
		titles,
		year,
		airDate,
		imdbId,
	});
	let processedResults = flattenAndRemoveDuplicates(searchResults);
	processedResults = filterByMovieConditions(processedResults);
	if (processedResults.length) processedResults = sortByFileSize(processedResults);

	await db.saveScrapedResults(`movie:${imdbId}`, processedResults, true, replaceOldScrape);
	await db.markAsDone(imdbId);
	console.log(`🎥 Saved ${processedResults.length} results for ${cleanTitle}`);

	return processedResults.length;
}
