import axios from 'axios';
import { NextApiResponse } from 'next';
import { scrapeMovies } from './movieScraper';
import { PlanetScaleCache } from './planetscale';
import { scrapeTv } from './tvScraper';

const tmdbKey = process.env.TMDB_KEY;
const getTmdbSearch = (imdbId: string) =>
	`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
const mdbKey = process.env.MDBLIST_KEY;
const getMdbInfo = (imdbId: string) => `https://mdblist.com/api/?apikey=${mdbKey}&i=${imdbId}`;
const getTmdbTvInfo = (tmdbId: string) =>
	`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${tmdbKey}`;
const getTmdbMovieInfo = (tmdbId: string) =>
	`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbKey}`;

const db = new PlanetScaleCache();

const isAlreadyScraped = async (
	mediaType: string,
	imdbId: string,
	res: NextApiResponse<ScrapeResponse>
): Promise<boolean> => {
	const keyExists = await db.keyExists(`${mediaType}:${imdbId}${mediaType === 'tv' ? ':1' : ''}`);
	if (keyExists) {
		res.status(200).json({ status: 'skipped' });
		return true;
	}
	const isProcessing = await db.keyExists(`processing:${imdbId}`);
	if (isProcessing) {
		res.status(200).json({ status: 'processing' });
		return true;
	}
	return false;
};

function convertMdbToTmdb(apiResponse: any) {
	return {
		title: apiResponse.title,
		name: apiResponse.title,
		release_date: apiResponse.released,
		// original_title: apiResponse.original_title, // This field does not exist in the provided API response
	};
}

export type ScrapeResponse = {
	status: string;
	errorMessage?: string;
};

export async function generateScrapeJobs(
	res: NextApiResponse<ScrapeResponse>,
	imdbId: string,
	override: boolean = false
) {
	let tmdbResponse;
	try {
		tmdbResponse = await axios.get(getTmdbSearch(imdbId));
	} catch (error: any) {
		res.status(500).json({
			status: 'error',
			errorMessage: `an error occurred while fetching TMDB info (${error.message})`,
		});
		return;
	}

	if (tmdbResponse.data.movie_results?.length > 0) {
		if (!override && (await isAlreadyScraped('movie', imdbId, res))) return;

		try {
			const resultsCount = await scrapeMovies(imdbId, tmdbResponse.data.movie_results[0], db);
			res.status(200).json({ status: `scraped: ${resultsCount} movie torrents` });
		} catch (error: any) {
			res.status(500).json({
				status: 'error',
				errorMessage: `an error occurred while scraping Btdigg for movies (${error.message})`,
			});
		}

		return;
	}

	if (tmdbResponse.data.tv_results?.length > 0) {
		if (!override && (await isAlreadyScraped('tv', imdbId, res))) return;

		try {
			console.log('>>>>>>>>', tmdbResponse.data.tv_results[0].name, imdbId);
			const resultsCount = await scrapeTv(imdbId, tmdbResponse.data.tv_results[0], db);
			res.status(200).json({ status: `scraped: ${resultsCount} tv torrents` });
		} catch (error: any) {
			res.status(500).json({
				status: 'error',
				errorMessage: `an error occurred while scraping Btdigg for tv (${error.message})`,
			});
		}

		return;
	}

	if (!tmdbResponse.data.movie_results?.length && !tmdbResponse.data.tv_results?.length) {
		let mdbResponse;
		try {
			mdbResponse = await axios.get(getMdbInfo(imdbId));
		} catch (error: any) {
			res.status(500).json({
				status: 'error',
				errorMessage: `an error occurred while fetching MDB info (${error.message})`,
			});
			return;
		}

		if (mdbResponse.data.response) {
			const mediaType = mdbResponse.data.type === 'show' ? 'tv' : 'movie';
			if (!override && (await isAlreadyScraped(mediaType, imdbId, res))) return;

			const tmdbId = mdbResponse.data.tmdbid;

			if (mediaType === 'movie') {
				try {
					const tmdbResponse = await axios.get(getTmdbMovieInfo(tmdbId));
					const resultsCount = await scrapeMovies(imdbId, tmdbResponse.data, db);
					res.status(200).json({ status: `scraped: ${resultsCount} movie torrents` });
				} catch (error: any) {
					if (error.response?.status === 404) {
						const tmdbResponse = convertMdbToTmdb(mdbResponse.data);
						const resultsCount = await scrapeMovies(imdbId, tmdbResponse, db);
						res.status(200).json({ status: `scraped: ${resultsCount} movie torrents` });
					} else {
						res.status(500).json({
							status: 'error',
							errorMessage: `an error occurred while scraping Btdigg for movie (${error.message})`,
						});
					}
				}

				return;
			} else if (mediaType === 'tv') {
				try {
					const tmdbResponse = await axios.get(getTmdbTvInfo(tmdbId));
					const resultsCount = await scrapeTv(imdbId, tmdbResponse.data, db);
					res.status(200).json({ status: `scraped: ${resultsCount} tv torrents` });
				} catch (error: any) {
					if (error.response?.status === 404) {
						const tmdbResponse = convertMdbToTmdb(mdbResponse.data);
						const resultsCount = await scrapeTv(imdbId, tmdbResponse, db);
						res.status(200).json({ status: `scraped: ${resultsCount} tv torrents` });
					} else {
						res.status(500).json({
							status: 'error',
							errorMessage: `an error occurred while scraping Btdigg for tv (${error.message})`,
						});
					}
				}

				return;
			}
		}

		await db.saveScrapedResults(`movie:${imdbId}`, []);
		await db.saveScrapedResults(`tv:${imdbId}:1`, []);
		await db.markAsDone(imdbId);
		res.status(404).json({
			status: 'error',
			errorMessage: 'no movie or TV show found for this ID',
		});
	}
}
