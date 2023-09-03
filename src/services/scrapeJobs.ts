import {
	createAxiosInstance,
	flattenAndRemoveDuplicates,
	groupByParsedTitle,
	scrapeResults,
} from '@/services/btdigg-v2';
import axios from 'axios';
import { NextApiResponse } from 'next';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { PlanetScaleCache } from './planetscale';
import { ScrapeSearchResult } from './mediasearch';

const tmdbKey = process.env.TMDB_KEY;
const mdblistKey = process.env.MDBLIST_KEY;
const getTmdbInfo = (imdbId: string) =>
	`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
function padWithZero(num: number) {
	if (num < 10) {
		return '0' + num;
	} else {
		return num.toString();
	}
}
const cleanSearchQuery = (search: string): string => {
	return search
		.split(/[\s\(\)\[\]\{\}\+\\\^\|·\?]/) // split the search query into an array of elements
		.filter((e) => e !== '') // filter out any empty elements
		.map((e) => e.toLowerCase()) // convert each element to lowercase
		.join(' ') // join the remaining elements with a single space
		.replace(/[áàäâ]/g, 'a') // replace certain characters with their equivalent
		.replace(/[éèëê]/g, 'e')
		.replace(/[íìïî]/g, 'i')
		.replace(/[óòöô]/g, 'o')
		.replace(/[úùüû]/g, 'u')
		.replaceAll(':', ' ')
		.replace(/\s+/g, ' ') // replace multiple spaces with a single space
		.trim();
};

const db = new PlanetScaleCache();

export type ScrapeResponse = {
	status: string;
	errorMessage?: string;
};

export async function generateScrapeJobs(
	res: NextApiResponse<ScrapeResponse>,
	imdbId: string,
	override: boolean = false
) {
	// imdbId to search for
	const tmdbResponse = await axios.get(getTmdbInfo(imdbId));

	const movieTitles: string[] = [];
	const tvTitles: string[] = [];

	let tmdbItem: any = {};
	let itemType: 'movie' | 'tv' = 'movie';

	if (tmdbResponse.data.movie_results.length > 0) {
		if (!override) {
			const isProcessing = await db.keyExists(`processing:${imdbId}`);
			if (isProcessing) {
				res.status(200).json({ status: 'processing' });
				return;
			}
			const keyExists = await db.keyExists(`movie:${imdbId}`);
			if (keyExists) {
				res.status(200).json({ status: 'skipped' });
				return;
			}
		}

		itemType = 'movie';
		tmdbItem = tmdbResponse.data.movie_results[0];
		const cleanTitle = cleanSearchQuery(tmdbItem.title);
		const titleLength = cleanTitle.split(' ').length;
		if (titleLength > 2) movieTitles.push(`"${cleanTitle}"`);
		if (tmdbItem.release_date)
			movieTitles.push(`"${cleanTitle}" ${tmdbItem.release_date.substring(0, 4)}`);

		if (tmdbItem.original_title && tmdbItem.original_title !== tmdbItem.title) {
			movieTitles.push(`"${tmdbItem.original_title}"`);
			if (tmdbItem.release_date)
				movieTitles.push(
					`"${tmdbItem.original_title}" ${tmdbItem.release_date.substring(0, 4)}`
				);
			const mdbItem = await axios.get(getMdbInfo(imdbId));
			for (let rating of mdbItem.data.ratings) {
				if (rating.source === 'tomatoes') {
					if (!rating.url) continue;
					const cleanedTitle = (
						rating.url.includes('/m/')
							? rating.url.split('/m/')[1]
							: rating.url.split('/tv/')[1]
					).replaceAll('_', ' ');
					if (cleanedTitle.match(/^\d{6,}/)) continue;
					movieTitles.push(`"${cleanedTitle}"`);
					if (tmdbItem.release_date)
						movieTitles.push(
							`"${cleanedTitle}" ${tmdbItem.release_date.substring(0, 4)}`
						);
				}
			}
		}

		await db.saveScrapedResults(`processing:${imdbId}`, []);

		try {
			const results = [];
			for (const movieTitle of movieTitles) {
				for (const lType of ['', '1080p', '2160p', '720p']) {
					const mustHave = [];
					let numbers = movieTitle.match(/\b(\d+(\.\d+)?)\b/g);
					if (numbers) mustHave.push(...numbers);
					const scrapedResults = await scrapeResults(
						createAxiosInstance(
							new SocksProxyAgent(process.env.PROXY!, { timeout: 10000 })
						),
						`${movieTitle} ${lType}`.trim(),
						movieTitle,
						mustHave,
						lType || '1080p'
					);
					if (!scrapedResults.length) continue;
					results.push(scrapedResults);
				}
			}
			let processedResults = flattenAndRemoveDuplicates(results);
			if (processedResults.length) processedResults = groupByParsedTitle(processedResults);

			await db.saveScrapedResults<ScrapeSearchResult[]>(`movie:${imdbId}`, processedResults);

			res.status(200).json({ status: `scraped: ${processedResults.length} movie torrents` });
			await db.markAsDone(imdbId);
		} catch (error: any) {
			res.status(500).json({
				status: 'error',
				errorMessage: `An error occurred while scraping Btdigg (${error.message})`,
			});
		}

		return;
	}

	if (tmdbResponse.data.tv_results.length > 0) {
		if (!override) {
			const isProcessing = await db.keyExists(`processing:${imdbId}`);
			if (isProcessing) {
				res.status(200).json({ status: 'processing' });
				return;
			}
			const keyExists = await db.keyExists(`tv:${imdbId}:1`);
			if (keyExists) {
				res.status(200).json({ status: 'skipped' });
				return;
			}
		}

		itemType = 'tv';
		tmdbItem = tmdbResponse.data.tv_results[0];
		const cleanTitle = cleanSearchQuery(tmdbItem.name);
		tvTitles.push(`"${cleanTitle}"`);
		if (tmdbItem.first_air_date)
			tvTitles.push(`"${cleanTitle}" ${tmdbItem.first_air_date.substring(0, 4)}`);

		if (tmdbItem.original_name && tmdbItem.original_name !== tmdbItem.name) {
			tvTitles.push(`"${tmdbItem.original_name}"`);
			if (tmdbItem.first_air_date)
				tvTitles.push(
					`"${tmdbItem.original_name}" ${tmdbItem.first_air_date.substring(0, 4)}`
				);
		}

		await db.saveScrapedResults(`processing:${imdbId}`, []);

		let totalResultsCount = 0;
		const showResponse = await axios.get(getMdbInfo(imdbId));
		let lastError = null;
		for (const season of showResponse.data.seasons
			? showResponse.data.seasons
			: [{ season_number: 1, episode_count: 0 }]) {
			if (season.season_number === 0) continue;
			let seasonQueries = tvTitles.map((q) => `${q} "s${padWithZero(season.season_number)}"`);
			try {
				const results: ScrapeSearchResult[][] = [];
				for (const finalQuery of seasonQueries) {
					for (const lType of ['', '1080p', '2160p', '720p']) {
						const mustHave = [];
						let numbers = finalQuery.match(/\bs?(\d+(\.\d+)?)\b/g);
						if (numbers) mustHave.push(...numbers);
						const scrapedResults = await scrapeResults(
							createAxiosInstance(
								new SocksProxyAgent(process.env.PROXY!, { timeout: 10000 })
							),
							`${finalQuery} ${lType}`.trim(),
							finalQuery.replace(/\bs\d\d\b/g, ''),
							mustHave,
							lType || '1080p'
						);
						if (!scrapedResults.length) continue;
						results.push(scrapedResults);
					}
				}
				let processedResults = flattenAndRemoveDuplicates(results);
				if (processedResults.length)
					processedResults = groupByParsedTitle(processedResults);

				await db.saveScrapedResults<ScrapeSearchResult[]>(
					`tv:${imdbId}:${season.season_number}`,
					processedResults
				);

				totalResultsCount += processedResults.length;
			} catch (error: any) {
				lastError = error;
			}
		}

		if (lastError) {
			res.status(500).json({
				status: 'error',
				errorMessage: `An error occurred while scraping Btdigg (${lastError.message})`,
			});
		} else {
			await db.markAsDone(imdbId);
			res.status(200).json({ status: `scraped: ${totalResultsCount} tv torrents` });
		}

		return;
	}
}
