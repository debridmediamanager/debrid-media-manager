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

type MovieScrapeJob = {
	title: string;
	originalTitle?: string;
	cleanedTitle?: string;
	year?: string;
};

const getMovieSearchResults = async (job: MovieScrapeJob) => {
	const http = createAxiosInstance(
		new SocksProxyAgent(process.env.PROXY!, { timeout: parseInt(process.env.REQUEST_TIMEOUT!) })
	);

	let sets: ScrapeSearchResult[][] = [];

	sets.push(await scrapeResults(http, `"${job.title}" ${job.year ?? ''}`, job.title, [], false));
	const resolutions = [
		'1080p',
		'2160p',
		'720p',
		'480p',
		'x264',
		'x265',
		'h264',
		'h265',
		'aac',
		'dts',
		'xvid',
	];
	let prevLength = flattenAndRemoveDuplicates(sets).length;

	for (let i = 0; i < resolutions.length; i++) {
		sets.push(
			await scrapeResults(
				http,
				`"${job.title}" ${job.year ?? ''} ${resolutions[i]}`,
				job.title,
				[],
				false
			)
		);
		let newLength = flattenAndRemoveDuplicates(sets).length;
		if (newLength !== prevLength) {
			console.log(`$$$$ length from ${resolutions[i]}:`, newLength);
			prevLength = newLength;
		}
	}

	if (job.originalTitle) {
		sets.push(
			await scrapeResults(
				http,
				`"${job.originalTitle}" ${job.year ?? ''}`,
				job.originalTitle,
				[],
				false
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
				false
			)
		);
	}

	return sets;
};

export async function scrapeMovies(
	imdbId: string,
	tmdbItem: any,
	db: PlanetScaleCache
): Promise<number> {
	const cleanTitle = cleanSearchQuery(tmdbItem.title);
	const year = tmdbItem.release_date?.substring(0, 4);

	let cleanedTitle;
	if (tmdbItem.original_title && tmdbItem.original_title !== tmdbItem.title) {
		const mdbItem = await axios.get(getMdbInfo(imdbId));
		for (let rating of mdbItem.data.ratings) {
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
		originalTitle: tmdbItem.original_title,
		cleanedTitle,
		year,
	});
	let processedResults = flattenAndRemoveDuplicates(searchResults);
	if (processedResults.length) processedResults = groupByParsedTitle(processedResults);

	await db.saveScrapedResults<ScrapeSearchResult[]>(`movie:${imdbId}`, processedResults);
	console.log(`Saved ${processedResults.length} results for ${cleanTitle}`);

	await db.markAsDone(imdbId);

	return processedResults.length;
}
