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
	let tmdbSearch, mdbInfo;
	try {
		tmdbSearch = await axios.get(getTmdbSearch(imdbId));
		mdbInfo = await axios.get(getMdbInfo(imdbId));
	} catch (error: any) {
		console.error(error);
		res.status(500).json({
			status: 'error',
			errorMessage: `an error occurred while fetching media info for '${imdbId}' (${error.message})`,
		});
		return;
	}

	const isMovie = mdbInfo.data.type === 'movie' || tmdbSearch.data.movie_results?.length > 0;
	const isTv = mdbInfo.data.type === 'show' || tmdbSearch.data.tv_results?.length > 0;

	if (isMovie) {
		if (!override && (await isAlreadyScraped('movie', imdbId, res))) return;

		try {
			const tmdbId = mdbInfo.data.tmdbid ?? tmdbSearch.data.movie_results[0]?.id;
			const tmdbInfo = await axios.get(getTmdbMovieInfo(tmdbId));
			const resultsCount = await scrapeMovies(imdbId, tmdbInfo.data, mdbInfo.data, db);
			res.status(200).json({
				status: `scraped: ${resultsCount} movie torrents for '${mdbInfo.data.title}'`,
			});
			return;
		} catch (error: any) {
			if (error.response?.status === 404 || error.message.includes("reading 'id'")) {
				try {
					const convertedMdb = convertMdbToTmdb(mdbInfo.data);
					const resultsCount = await scrapeMovies(imdbId, convertedMdb, mdbInfo.data, db);
					res.status(200).json({
						status: `scraped: ${resultsCount} movie torrents for '${mdbInfo.data.title}'`,
					});
					return;
				} catch (error: any) {
					console.error(error);
				}
			} else {
				console.error(error);
				res.status(500).json({
					status: 'error',
					errorMessage: `an error occurred while scraping Btdigg for movie '${mdbInfo.data.title}' (${error.message})`,
				});
				return;
			}
		}
	}

	if (isTv) {
		if (!override && (await isAlreadyScraped('tv', imdbId, res))) return;

		try {
			const tmdbId = mdbInfo.data.tmdbid ?? tmdbSearch.data.tv_results[0]?.id;
			const tmdbInfo = await axios.get(getTmdbTvInfo(tmdbId));
			const resultsCount = await scrapeTv(imdbId, tmdbInfo.data, mdbInfo.data, db);
			res.status(200).json({
				status: `scraped: ${resultsCount} tv torrents for '${mdbInfo.data.title}'`,
			});
			return;
		} catch (error: any) {
			if (error.response?.status === 404 || error.message.includes("reading 'id'")) {
				try {
					const convertedMdb = convertMdbToTmdb(mdbInfo.data);
					const resultsCount = await scrapeTv(imdbId, convertedMdb, mdbInfo.data, db);
					res.status(200).json({
						status: `scraped: ${resultsCount} tv torrents for '${mdbInfo.data.title}'`,
					});
					return;
				} catch (error: any) {
					console.error(error);
				}
			} else {
				console.error(error);
				res.status(500).json({
					status: 'error',
					errorMessage: `an error occurred while scraping Btdigg for tv '${mdbInfo.data.title}' (${error.message})`,
				});
				return;
			}
		}
	}

	await db.saveScrapedResults(`movie:${imdbId}`, []);
	await db.saveScrapedResults(`tv:${imdbId}:1`, []);
	await db.markAsDone(imdbId);
	res.status(200).json({
		status: 'error',
		errorMessage: 'no movie or TV show found for this ID',
	});
	return;
}
