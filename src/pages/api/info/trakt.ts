import { Repository } from '@/services/repository';
import { TraktMediaItem, getMediaData } from '@/services/trakt';
import { NextApiRequest, NextApiResponse } from 'next';

type Category = {
	name: string;
	items: [string, string][];
};

// Movie endpoints organized by category
const movieEndpoints: Category[] = [
	{
		name: 'Box Office',
		items: [['Box Office', 'movies/boxoffice']],
	},
	{
		name: 'Popular & Trending',
		items: [
			['Popular', 'movies/popular'],
			['Trending', 'movies/trending'],
		],
	},
	{
		name: 'Most Played',
		items: [
			['Most Played Today', 'movies/played/daily'],
			['Most Played This Month', 'movies/played/monthly'],
			['Most Played All Time', 'movies/played/all'],
		],
	},
	{
		name: 'Most Watched',
		items: [
			['Most Watched Today', 'movies/watched/daily'],
			['Most Watched This Month', 'movies/watched/monthly'],
			['Most Watched All Time', 'movies/watched/all'],
		],
	},
	{
		name: 'Most Favorited',
		items: [
			['Most Favorited Today', 'movies/favorited/daily'],
			['Most Favorited This Month', 'movies/favorited/monthly'],
			['Most Favorited All Time', 'movies/favorited/all'],
		],
	},
	{
		name: 'Anticipated',
		items: [['Most Anticipated', 'movies/anticipated']],
	},
];

// Show endpoints organized by category
const showEndpoints: Category[] = [
	{
		name: 'Popular & Trending',
		items: [
			['Popular', 'shows/popular'],
			['Trending', 'shows/trending'],
		],
	},
	{
		name: 'Most Played',
		items: [
			['Most Played Today', 'shows/played/daily'],
			['Most Played This Month', 'shows/played/monthly'],
			['Most Played All Time', 'shows/played/all'],
		],
	},
	{
		name: 'Most Watched',
		items: [
			['Most Watched Today', 'shows/watched/daily'],
			['Most Watched This Month', 'shows/watched/monthly'],
			['Most Watched All Time', 'shows/watched/all'],
		],
	},
	{
		name: 'Most Favorited',
		items: [
			['Most Favorited Today', 'shows/favorited/daily'],
			['Most Favorited This Month', 'shows/favorited/monthly'],
			['Most Favorited All Time', 'shows/favorited/all'],
		],
	},
	{
		name: 'Anticipated',
		items: [['Most Anticipated', 'shows/anticipated']],
	},
];

type TraktBrowseResponseCache = {
	lastUpdated: number;
	results: TraktMediaItem[];
};

const responseCache: Record<string, TraktBrowseResponseCache> = {};
const traktClientID = process.env.TRAKT_CLIENT_ID;
const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { browse } = req.query;

	if (!browse || typeof browse !== 'string') {
		return res.status(400).json({ error: 'Browse parameter is required' });
	}

	let mediaType = browse.toLowerCase() === 'shows' ? 'show' : 'movie';
	const categories: { name: string; results: Record<string, TraktMediaItem[]> }[] = [];

	try {
		const endpoints = mediaType === 'movie' ? movieEndpoints : showEndpoints;

		for (const category of endpoints) {
			const categoryResults: Record<string, TraktMediaItem[]> = {};

			for (const [key, endpoint] of category.items) {
				if (
					responseCache[endpoint] &&
					responseCache[endpoint].results.length &&
					responseCache[endpoint].lastUpdated > new Date().getTime() - 1000 * 60 * 10
				) {
					categoryResults[key] = responseCache[endpoint].results;
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
					categoryResults[key] = responseCache[endpoint].results;
				} catch (error: any) {
					console.error(`Error fetching ${endpoint}:`, error);
					continue;
				}
			}

			if (Object.keys(categoryResults).length > 0) {
				categories.push({
					name: category.name,
					results: categoryResults,
				});
			}
		}

		res.status(200).json({
			mediaType,
			categories,
		});
	} catch (error) {
		console.error('Error in trakt info handler:', error);
		res.status(500).json({ error: 'Failed to fetch trakt information' });
	}
}
