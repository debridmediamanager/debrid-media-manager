import { cleanSearchQuery } from '@/utils/search';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
	createAxiosInstance,
	flattenAndRemoveDuplicates,
	groupByParsedTitle,
	scrapeResults,
} from './btdigg-v2';
import { ScrapeSearchResult } from './mediasearch';
import { PlanetScaleCache } from './planetscale';

type MovieScrapeJob = {
	title: string;
	originalTitle?: string;
	cleanedTitle?: string;
	year?: string;
	airDate: string;
};

const getMovieSearchResults = async (job: MovieScrapeJob) => {
	const http = createAxiosInstance(
		new SocksProxyAgent(process.env.PROXY!, { timeout: parseInt(process.env.REQUEST_TIMEOUT!) })
	);

	let sets: ScrapeSearchResult[][] = [];

	sets.push(
		await scrapeResults(http, `"${job.title}" ${job.year ?? ''}`, job.title, [], job.airDate)
	);
	if (job.title.includes('&')) {
		sets.push(
			await scrapeResults(
				http,
				`"${job.title.replaceAll('&', 'and')}" ${job.year ?? ''}`,
				job.title,
				[],
				job.airDate
			)
		);
	}

	if (job.title.split(/\s/).length > 3) {
		sets.push(await scrapeResults(http, `"${job.title}"`, job.title, [], job.airDate));
	}

	if (job.originalTitle) {
		sets.push(
			await scrapeResults(
				http,
				`"${job.originalTitle}" ${job.year ?? ''}`,
				job.originalTitle,
				[],
				job.airDate
			)
		);
	}

	if (job.cleanedTitle) {
		sets.push(
			await scrapeResults(
				http,
				`"${job.cleanedTitle}" ${job.year ?? ''}`,
				job.cleanedTitle,
				[],
				job.airDate
			)
		);
	}

	return sets;
};

export async function scrapeMovies(
	imdbId: string,
	tmdbData: any,
	mdbData: any,
	db: PlanetScaleCache
): Promise<number> {
	console.log(`🏹 Scraping movie: ${tmdbData.title} (${imdbId})...`);
	const cleanTitle = cleanSearchQuery(tmdbData.title);
	const year =
		mdbData.year ?? mdbData.released?.substring(0, 4) ?? tmdbData.release_date?.substring(0, 4);
	const airDate = mdbData.released ?? tmdbData.release_date ?? '2000-01-01';

	let originalTitle, cleanedTitle;
	if (tmdbData.original_title && tmdbData.original_title !== tmdbData.title) {
		originalTitle = tmdbData.original_title.toLowerCase();
		for (let rating of mdbData.ratings) {
			if (rating.source === 'tomatoes') {
				if (!rating.url) continue;
				const tomatoTitle = (
					rating.url.includes('/m/')
						? rating.url.split('/m/')[1]
						: rating.url.split('/tv/')[1]
				).replaceAll('_', ' ');
				if (tomatoTitle.match(/^\d{6,}/)) continue;
				cleanedTitle = tomatoTitle
					.replaceAll(/[\W]+/g, ' ')
					.split(' ')
					.join(' ')
					.trim()
					.toLowerCase();
			}
		}
	}

	await db.saveScrapedResults(`processing:${imdbId}`, []);

	const searchResults = await getMovieSearchResults({
		title: cleanTitle,
		originalTitle,
		cleanedTitle,
		year,
		airDate,
	});
	let processedResults = flattenAndRemoveDuplicates(searchResults);
	if (processedResults.length) processedResults = groupByParsedTitle(processedResults);

	await db.saveScrapedResults<ScrapeSearchResult[]>(`movie:${imdbId}`, processedResults);
	console.log(`🎥 Saved ${processedResults.length} results for ${cleanTitle}`);

	await db.markAsDone(imdbId);

	return processedResults.length;
}
