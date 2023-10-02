import { cleanSearchQuery } from '@/utils/search';
import { scrapeBtdigg } from './btdigg-v2';
import { scrapeJackett } from './jackett';
import { ScrapeSearchResult, flattenAndRemoveDuplicates, sortByFileSize } from './mediasearch';
import { PlanetScaleCache } from './planetscale';
import { scrapeProwlarr } from './prowlarr';

type TvScrapeJob = {
	title: string;
	originalTitle?: string;
	seasonNumber: number;
	seasonName?: string;
	seasonCode?: number;
	seasonYear?: string;
	airDate: string;
};

function padWithZero(num: number) {
	if (num < 10) {
		return '0' + num;
	} else {
		return num.toString();
	}
}

const getSeasons = (mdbData: any) =>
	mdbData.seasons.length
		? mdbData.seasons
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

async function scrapeAll(
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: (string | RegExp)[],
	airDate: string
): Promise<ScrapeSearchResult[][]> {
	return await Promise.all([
		scrapeBtdigg(finalQuery, targetTitle, mustHaveTerms, airDate),
		scrapeProwlarr(finalQuery, targetTitle, mustHaveTerms, airDate),
		scrapeJackett(finalQuery, targetTitle, mustHaveTerms, airDate),
	]);
}

const getSearchResults = async (job: TvScrapeJob) => {
	let sets: ScrapeSearchResult[][] = [];

	sets.push(
		...(await scrapeAll(
			`"${job.title}" s${padWithZero(job.seasonNumber)}`,
			job.title,
			[new RegExp(`[0123]?${job.seasonNumber}[ex\\W_]`, 'i')],
			job.airDate
		))
	);

	if (job.seasonName && job.seasonCode) {
		sets.push(
			...(await scrapeAll(
				`"${job.title}" "${job.seasonName}" s${padWithZero(job.seasonCode)}`,
				job.title,
				[
					new RegExp(`[0123]?${job.seasonCode}[ex\\W_]`, 'i'),
					...job.seasonName.split(/\s/),
				],
				job.airDate
			))
		);
	} else if (job.seasonName && job.seasonName !== job.title) {
		sets.push(
			...(await scrapeAll(
				`"${job.title}" "${job.seasonName}"`,
				job.title,
				[...job.seasonName.split(/\s/)],
				job.airDate
			))
		);
	}

	if (job.title.split(/\s/).length > 3 && job.seasonNumber === 1) {
		sets.push(...(await scrapeAll(`"${job.title}"`, job.title, [], job.airDate)));
	}

	if (!job.originalTitle) return sets;

	let sets2: ScrapeSearchResult[][] = [];

	sets2 = await scrapeAll(
		`"${job.originalTitle}" s${padWithZero(job.seasonNumber)}`,
		job.originalTitle,
		[new RegExp(`[0123]?${job.seasonNumber}[ex\\W_]`, 'i')],
		job.airDate
	);
	if (job.seasonName && job.seasonCode) {
		sets2.push(
			...(await scrapeAll(
				`"${job.originalTitle}" "${job.seasonName}" s${padWithZero(job.seasonCode)}`,
				job.originalTitle,
				[
					new RegExp(`[0123]?${job.seasonCode}[ex\\W_]`, 'i'),
					...job.seasonName.split(/\s/),
				],
				job.airDate
			))
		);
	} else if (job.seasonName && job.seasonName !== job.originalTitle) {
		sets2.push(
			...(await scrapeAll(
				`"${job.originalTitle}" "${job.seasonName}"`,
				job.originalTitle,
				[...job.seasonName.split(/\s/)],
				job.airDate
			))
		);
	}

	return [...sets, ...sets2];
};

export async function scrapeTv(
	imdbId: string,
	tmdbData: any,
	mdbData: any,
	db: PlanetScaleCache,
	replaceOldScrape: boolean = false
): Promise<number> {
	console.log(
		`🏏 Scraping ${getSeasons(mdbData).length} season(s) of tv show: ${
			tmdbData.name
		} (${imdbId})...`
	);
	const scrapeJobs: TvScrapeJob[] = [];

	let cleanTitle = cleanSearchQuery(tmdbData.name);
	let cleanOriginalTitle;
	if (tmdbData.original_name && tmdbData.original_name !== tmdbData.name) {
		cleanOriginalTitle = cleanSearchQuery(tmdbData.original_name);
	}
	for (const season of getSeasons(mdbData)) {
		if (season.season_number === 0) continue;
		let seasonNumber = season.season_number;
		const { seasonName, seasonCode } = getSeasonNameAndCode(season);
		const seasonYear = getSeasonYear(season);
		const airDate = season.air_date ?? '2000-01-01';

		scrapeJobs.push({
			title: cleanTitle,
			originalTitle: cleanOriginalTitle,
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
		if (job.title.includes(' & ')) {
			const searchResultsArr = await Promise.all([
				getSearchResults(job),
				getSearchResults({
					...job,
					title: job.title.replace(' & ', ' and '),
					originalTitle: job.originalTitle?.includes(' & ')
						? job.originalTitle.replace(' & ', ' and ')
						: job.originalTitle,
				}),
			]);
			searchResults = searchResultsArr.flat();
		} else {
			searchResults = await getSearchResults(job);
		}
		let processedResults = flattenAndRemoveDuplicates(searchResults);
		if (processedResults.length) processedResults = sortByFileSize(processedResults);
		if (!/movie/i.test(job.title)) {
			processedResults = processedResults.filter((result) => {
				return !/movie/i.test(result.title);
			});
		}
		totalResultsCount += processedResults.length;

		await db.saveScrapedResults(
			`tv:${imdbId}:${job.seasonNumber}`,
			processedResults,
			replaceOldScrape
		);
		console.log(
			`📺 Saved ${processedResults.length} results for ${job.title} season ${job.seasonNumber}`
		);
	}

	await db.markAsDone(imdbId);
	return totalResultsCount;
}
