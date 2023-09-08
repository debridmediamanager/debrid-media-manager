import { getMdbInfo } from '@/utils/mdblist';
import { cleanSearchQuery } from '@/utils/search';
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
	createAxiosInstance,
	flattenAndRemoveDuplicates,
	groupByParsedTitle,
	scrapeResults,
} from './btdigg-v2';
import { ScrapeSearchResult } from './mediasearch';
import { PlanetScaleCache } from './planetscale';

type TvScrapeJob = {
	title: string;
	originalTitle?: string;
	seasonNumber: number;
	seasonName?: string;
	seasonCode?: number;
	seasonYear?: string;
};

function padWithZero(num: number) {
	if (num < 10) {
		return '0' + num;
	} else {
		return num.toString();
	}
}

const getSeasons = (showResponse: any) =>
	showResponse.data.seasons.length
		? showResponse.data.seasons
		: [{ name: 'Season 1', season_number: 1, episode_count: 0 }];

const getSeasonNameAndCode = (season: any) => {
	let seasonName, seasonCode;
	let parts = season.name.split(/\s+/);
	for (let i = parts.length - 1; i >= 0; i--) {
		let match = parts[i].match(/\(?(\d+)\)?$/);
		if (match) {
			seasonCode = parseInt(match[1]);
			parts[i] = '';
			break;
		}
	}
	seasonName = cleanSearchQuery(parts.join(' ').trim());
	if (/series|season/.test(seasonName)) seasonName = undefined;
	return { seasonName, seasonCode };
};

const getSeasonYear = (season: any) => season.air_date?.substring(0, 4);

const getSearchResults = async (job: TvScrapeJob) => {
	const http = createAxiosInstance(
		new SocksProxyAgent(process.env.PROXY!, { timeout: parseInt(process.env.REQUEST_TIMEOUT!) })
	);

	let sets: ScrapeSearchResult[][] = [];

	sets.push(
		await scrapeResults(
			http,
			`"${job.title}" s${padWithZero(job.seasonNumber)}`,
			job.title,
			[new RegExp(`[0123]?${job.seasonNumber}[\\be]`, 'i')],
			false
		)
	);

	if (job.seasonName && job.seasonCode) {
		sets.push(
			await scrapeResults(
				http,
				`"${job.title}" "${job.seasonName}" s${padWithZero(job.seasonCode)}`,
				job.title,
				[new RegExp(`[0123]?${job.seasonCode}[\\be]`, 'i'), ...job.seasonName.split(/\s/)],
				false
			)
		);
	} else if (job.seasonName && job.seasonName !== job.title) {
		sets.push(
			await scrapeResults(
				http,
				`"${job.title}" "${job.seasonName}"`,
				job.title,
				[...job.seasonName.split(/\s/)],
				false
			)
		);
	}

	if (!job.originalTitle) return sets;

	let sets2: ScrapeSearchResult[][] = [];

	sets2.push(
		await scrapeResults(
			http,
			`"${job.originalTitle}" s${padWithZero(job.seasonNumber)}`,
			job.originalTitle,
			[new RegExp(`[0123]?${job.seasonNumber}[\\be]`, 'i')],
			false
		)
	);
	if (job.seasonName && job.seasonCode) {
		sets2.push(
			await scrapeResults(
				http,
				`"${job.originalTitle}" "${job.seasonName}" s${padWithZero(job.seasonCode)}`,
				job.originalTitle,
				[new RegExp(`[0123]?${job.seasonCode}[\\be]`, 'i'), ...job.seasonName.split(/\s/)],
				false
			)
		);
	} else if (job.seasonName && job.seasonName !== job.originalTitle) {
		sets2.push(
			await scrapeResults(
				http,
				`"${job.originalTitle}" "${job.seasonName}"`,
				job.originalTitle,
				[...job.seasonName.split(/\s/)],
				false
			)
		);
	}

	return [...sets, ...sets2];
};

export async function scrapeTv(
	imdbId: string,
	tmdbItem: any,
	db: PlanetScaleCache
): Promise<number> {
	console.log(`Scraping tv show: ${tmdbItem.name} (${imdbId})...`);
	const scrapeJobs: TvScrapeJob[] = [];

	let cleanTitle = cleanSearchQuery(tmdbItem.name);
	let cleanOriginalTitle;
	if (tmdbItem.original_name && tmdbItem.original_name !== tmdbItem.name) {
		cleanOriginalTitle = cleanSearchQuery(tmdbItem.original_name);
	}
	const showResponse = await axios.get(getMdbInfo(imdbId));
	for (const season of getSeasons(showResponse)) {
		if (season.season_number === 0) continue;
		let seasonNumber = season.season_number;
		const { seasonName, seasonCode } = getSeasonNameAndCode(season);
		const seasonYear = getSeasonYear(season);

		scrapeJobs.push({
			title: cleanTitle,
			originalTitle: cleanOriginalTitle,
			seasonNumber,
			seasonName,
			seasonCode,
			seasonYear,
		});

		if (cleanTitle.includes('&')) {
			scrapeJobs.push({
				title: cleanTitle.replaceAll('&', 'and'),
				// originalTitle: cleanOriginalTitle?.replaceAll('&', 'and'),
				seasonNumber,
				seasonName,
				seasonCode,
				seasonYear,
			});
		}
	}

	await db.saveScrapedResults(`processing:${imdbId}`, []);

	let totalResultsCount = 0;
	for (const job of scrapeJobs) {
		const searchResults = await getSearchResults(job);
		let processedResults = flattenAndRemoveDuplicates(searchResults);
		if (processedResults.length) processedResults = groupByParsedTitle(processedResults);
		if (!/movie/i.test(job.title)) {
			processedResults = processedResults.filter((result) => {
				return !/movie/i.test(result.title);
			});
		}
		totalResultsCount += processedResults.length;

		await db.saveScrapedResults<ScrapeSearchResult[]>(
			`tv:${imdbId}:${job.seasonNumber}`,
			processedResults
		);
		console.log(
			`Saved ${processedResults.length} results for ${job.title} season ${job.seasonNumber}`
		);
	}

	await db.markAsDone(imdbId);
	return totalResultsCount;
}
