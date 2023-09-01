import { SearchResult } from '@/services/btdigg-v2';
import {
	createAxiosInstance,
	scrapeResults,
	flattenAndRemoveDuplicates,
	groupByParsedTitle,
} from '@/services/btdigg-v2';
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { PlanetScaleCache } from './planetscale';
import { NextApiResponse } from 'next';

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
		.split(/[\s\=:\?\.\-\(\)\/]/) // split the search query into an array of elements
		.filter((e) => e !== '') // filter out any empty elements
		.map((e) => e.toLowerCase()) // convert each element to lowercase
		.join(' ') // join the remaining elements with a single space
		.replace(/[áàäâ]/g, 'a') // replace certain characters with their equivalent
		.replace(/[éèëê]/g, 'e')
		.replace(/[íìïî]/g, 'i')
		.replace(/[óòöô]/g, 'o')
		.replace(/[úùüû]/g, 'u')
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
        movieTitles.push(`"${cleanSearchQuery(tmdbItem.title)}"`);
        movieTitles.push(`"${cleanSearchQuery(tmdbItem.title)}" ${tmdbItem.release_date.substring(0, 4)}`);

        if (tmdbItem.original_title && tmdbItem.original_title !== tmdbItem.title) {
            movieTitles.push(`"${tmdbItem.original_title}"
            imdbId`);
            movieTitles.push(`"${tmdbItem.original_title}" ${tmdbItem.release_date.substring(0, 4)}`);
            const mdbItem = await axios.get(getMdbInfo(imdbId));
            for (let rating of mdbItem.data.ratings) {
                if (rating.source === 'tomatoes') {
                    if (!rating.url) continue;
                    const cleanedTitle = (
                        itemType === 'movie' ? rating.url.split('/m/') : rating.url.split('/tv/')
                    )[1].replaceAll('_', ' ');
                    if (cleanedTitle.startsWith(/\d{6,}/)) continue;
                    movieTitles.push(`"${cleanedTitle}"`);
                    movieTitles.push(`"${cleanedTitle}" ${tmdbItem.release_date.substring(0, 4)}`);
                }
            }
        }

        await db.saveScrapedResults(`processing:${imdbId}`, []);

        try {
            const results: SearchResult[][] = [];
            for (const movieTitle of movieTitles) {
                for (const lType of ['720p', '1080p', '2160p', '']) {
                    console.log('Scraping >', `${movieTitle} ${lType}`.trim());
                    const mustHave = [];
                    let numbers = movieTitle.match(/\b\d{1,4}\b/g);
                    if (numbers) mustHave.push(...numbers);
                    results.push(
                        await scrapeResults(
                            createAxiosInstance(
                                new SocksProxyAgent(process.env.PROXY!, { timeout: 10000 })
                            ),
                            `${movieTitle} ${lType}`.trim(),
                            movieTitle,
                            mustHave,
                            lType || '1080p',
                        )
                    );
                }
            }
            let processedResults = flattenAndRemoveDuplicates(results);
            if (processedResults.length) processedResults = groupByParsedTitle(processedResults);

            await db.saveScrapedResults<SearchResult[]>(`movie:${imdbId}`, processedResults);

            res.status(200).json({ status: `scraped: ${processedResults.length} items` });
        } catch (error: any) {
            res.status(500).json({
                status: 'error',
                errorMessage: `An error occurred while scraping Btdigg (${error.message})`,
            });
        }
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
        tvTitles.push(`"${cleanSearchQuery(tmdbItem.name)}"`);
        tvTitles.push(`"${cleanSearchQuery(tmdbItem.name)}" ${tmdbItem.first_air_date.substring(0, 4)}`);

        if (tmdbItem.original_name && tmdbItem.original_name !== tmdbItem.name) {
            tvTitles.push(`"${tmdbItem.original_name}"`);
            tvTitles.push(`"${tmdbItem.original_name}" ${tmdbItem.first_air_date.substring(0, 4)}`);
        }

        await db.saveScrapedResults(`processing:${imdbId}`, []);

        let totalResultsCount = 0;
        const showResponse = await axios.get(getMdbInfo(imdbId));
        for (const season of showResponse.data.seasons
            ? showResponse.data.seasons
            : [{ season_number: 1, episode_count: 0 }]) {
            if (season.season_number === 0) continue;
            let seasonQueries = tvTitles.map((q) => `${q} "s${padWithZero(season.season_number)}"`);
            try {
                const results: SearchResult[][] = [];
                for (const finalQuery of seasonQueries) {
                    for (const lType of ['720p', '1080p', '2160p', '']) {
                        console.log('Scraping >', `${finalQuery} ${lType}`.trim());
                        const mustHave = [];
                        let numbers = finalQuery.match(/\bs?\d{1,4}\b/g);
                        if (numbers) mustHave.push(...numbers);
                        results.push(
                            await scrapeResults(
                                createAxiosInstance(
                                    new SocksProxyAgent(process.env.PROXY!, { timeout: 10000 })
                                ),
                                `${finalQuery} ${lType}`.trim(),
                                finalQuery.replace(/\bs\d\d\b/g, ''),
                                mustHave,
                                lType || '1080p',
                            )
                        );
                    }
                }
                let processedResults = flattenAndRemoveDuplicates(results);
                if (processedResults.length) processedResults = groupByParsedTitle(processedResults);

                await db.saveScrapedResults<SearchResult[]>(`tv:${imdbId}:${season.season_number}`, processedResults);

                totalResultsCount += processedResults.length;
            } catch (error: any) {
                res.status(500).json({
                    status: 'error',
                    errorMessage: `An error occurred while scraping Btdigg (${error.message})`,
                });
            }
            // if (season.episode_count === 0) continue;
            // for (let i = 1; i <= season.episode_count; i++) {
            // 	seasonQueries = seasonQueries.concat(
            // 		tvTitles.map(
            // 			(q) =>
            // 				`${q} "s${padWithZero(season.season_number)}e${padWithZero(i)}"`
            // 		)
            // 	);
            // }
        }

        res.status(200).json({ status: `scraped: ${totalResultsCount} items` });

  imdbId  }

    await db.markAsDone(imdbId);
}
