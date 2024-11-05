import { PlanetScaleCache } from '@/services/planetscale';
import { TraktMediaItem, getMediaData } from '@/services/trakt';
import { NextApiRequest, NextApiResponse } from 'next';

const movieEndpoints = new Map<string, string>([
	['Box Office', 'movies/boxoffice'],
	['Most Played Today', 'movies/played/daily'],
	['Most Played This Month', 'movies/played/monthly'],
	['Most Played All Time', 'movies/played/all'],
	['Most Watched Today', 'movies/watched/daily'],
	['Most Watched This Month', 'movies/watched/monthly'],
	['Most Watched', 'movies/watched/all'],
	['Most Collected Today', 'movies/collected/daily'],
	['Most Collected This Month', 'movies/collected/monthly'],
	['Most Collected All Time', 'movies/collected/all'],
	['Most Favorited Today', 'movies/favorited/daily'],
	['Most Favorited This Month', 'movies/favorited/monthly'],
	['Most Favorited All Time', 'movies/favorited/all'],
	['Popular', 'movies/popular'],
	['Trending', 'movies/trending'],
	['Most Anticipated', 'movies/anticipated'],
]);

const showEndpoints = new Map<string, string>([
	['Most Played Today', 'shows/played/daily'],
	['Most Played This Month', 'shows/played/monthly'],
	['Most Played All Time', 'shows/played/all'],
	['Most Watched Today', 'shows/watched/daily'],
	['Most Watched This Month', 'shows/watched/monthly'],
	['Most Watched All Time', 'shows/watched/all'],
	['Most Collected Today', 'shows/collected/daily'],
	['Most Collected This Month', 'shows/collected/monthly'],
	['Most Collected All Time', 'shows/collected/all'],
	['Most Favorited Today', 'shows/favorited/daily'],
	['Most Favorited This Month', 'shows/favorited/monthly'],
	['Most Favorited All Time', 'shows/favorited/all'],
	['Popular', 'shows/popular'],
	['Trending', 'shows/trending'],
	['Most Anticipated', 'shows/anticipated'],
]);

type TraktBrowseResponseCache = {
	lastUpdated: number;
	results: TraktMediaItem[];
};
const responseCache: Record<string, TraktBrowseResponseCache> = {};

const traktClientID = process.env.TRAKT_CLIENT_ID;
const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { browse } = req.query;

	if (!browse || typeof browse !== 'string') {
		return res.status(400).json({ error: 'Browse parameter is required' });
	}

	let mediaType = browse.toLowerCase() === 'shows' ? 'show' : 'movie';
	const arrayOfResults: Record<string, TraktMediaItem[]> = {};

	try {
		let endpoints = mediaType === 'movie' ? movieEndpoints : showEndpoints;
		const keys = Array.from(endpoints.keys());

		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const endpoint = endpoints.get(key)!;

			if (
				responseCache[endpoint] &&
				responseCache[endpoint].results.length &&
				responseCache[endpoint].lastUpdated > new Date().getTime() - 1000 * 60 * 10
			) {
				arrayOfResults[key] = responseCache[endpoint].results;
				continue;
			}

			try {
				let searchResults = await db.getSearchResults<TraktMediaItem[]>(
					`trakt:${endpoint}`
				);
				if (!searchResults?.length) {
					searchResults = await getMediaData(traktClientID!, endpoint);
					await db.saveSearchResults(`trakt:${endpoint}`, searchResults);
				}
				responseCache[endpoint] = {
					lastUpdated: new Date().getTime(),
					results: searchResults,
				};
				arrayOfResults[key] = responseCache[endpoint].results;
			} catch (error: any) {
				console.error(`Error fetching ${endpoint}:`, error);
				continue;
			}
		}

		res.status(200).json({
			mediaType,
			arrayOfResults,
		});
	} catch (error) {
		console.error('Error in trakt info handler:', error);
		res.status(500).json({ error: 'Failed to fetch trakt information' });
	}
}
