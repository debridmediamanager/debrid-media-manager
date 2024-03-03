import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

interface ScrapeResponse {
	status: string;
	message?: string;
}

// Define a sleep function
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pdb = new PlanetScaleCache();

// Define a function to fetch RSS content, extract IDs, and fetch details for each ID
const fetchRssAndDetails = async (rssUrl: string, lastId: string): Promise<string> => {
	try {
		const rssResponse = await fetch(rssUrl);
		const rssContent = await rssResponse.text();
		// const ids = extractIds(rssContent);
		// https://showrss.info/show/145.rss
		// https://itorrents.org/torrent/B415C913643E5FF49FE37D304BBB5E6E11AD5101.torrent
		const scrapesMap = new Map<string, any>();
		// for (const id of ids) {
		// 	if (id === lastId) {
		// 		console.log('Encountered previously processed ID, stopping...');
		// 		break;
		// 	}
		// 	const imdbId = await tvMazeToImdb(id);
		// 	if (imdbId === null) {
		// 		continue;
		// 	}
		// 	let imdbId = imdbId.torrent.externals.imdb;
		// 	if (!imdbId) {
		// 		imdbId = imdbId.torrent.externals.tmdb
		// 			? `tmdb-${imdbId.torrent.externals.tmdb.toString()}`
		// 			: null;
		// 	}
		// 	if (!imdbId) {
		// 		imdbId = imdbId.torrent.externals.tvmaze
		// 			? `tvmaze-${imdbId.torrent.externals.tvmaze.toString()}`
		// 			: null;
		// 	}
		// 	if (imdbId.torrent.category === 2) {
		// 		let seasonNum: number | null = null;
		// 		const seasonMatch =
		// 			imdbId.torrent.releaseName.match(/S(\d{1,2})E?/i) ||
		// 			imdbId.torrent.releaseName.match(/Season\s?(\d{1,2})/i) ||
		// 			imdbId.torrent.releaseName.match(/(\d{1,2})x\d{1,2}/i);

		// 		if (seasonMatch && seasonMatch[1]) {
		// 			seasonNum = parseInt(seasonMatch[1], 10);
		// 		} else {
		// 			console.warn('No season match, setting to 1', imdbId.torrent.releaseName);
		// 			seasonNum = 1; // Default to season 1 if no match is found
		// 		}
		// 		const scrape = {
		// 			title: imdbId.torrent.releaseName,
		// 			fileSize: imdbId.torrent.size / 1024 / 1024,
		// 			hash: imdbId.torrent.infoHash.toLocaleLowerCase(),
		// 		};
		// 		if (scrapesMap.has(`tv:${imdbId}:${seasonNum}`)) {
		// 			scrapesMap.get(`tv:${imdbId}:${seasonNum}`).push(scrape);
		// 		} else {
		// 			scrapesMap.set(`tv:${imdbId}:${seasonNum}`, [scrape]);
		// 		}
		// 		// scrapes.push(scrape);
		// 	} else {
		// 		console.error('Unknown category', imdbId.torrent);
		// 	}
		// }
		// scrapesMap.forEach(async (scrapes, key) => {
		// 	const url = `https://debridmediamanager.com/${key
		// 		.replaceAll(':', '/')
		// 		.replaceAll('tv/', 'show/')}`;
		// 	console.log(url, key, scrapes);
		// 	await pdb.saveScrapedTrueResults(key, scrapes, true);
		// });
		// return ids[0]; // Return the most recent ID to track it
		return '';
	} catch (error) {
		console.error('An error occurred fetching rss link:', error);
		return '';
	}
};

// A looping function with sleep for periodic execution and stopping when encountering a specific ID
const startLoop = async (rssUrl: string, interval: number, stopAtId: string) => {
	let lastId = stopAtId;
	while (true) {
		const newLastId = await fetchRssAndDetails(rssUrl, lastId);
		lastId = newLastId;
		await sleep(interval);
	}
};

export const tvMazeToImdb = async (id: string): Promise<string | null> => {
	try {
		const response = await fetch(`https://api.tvmaze.com/shows/${id}`);
		const resp = await response.json();
		return resp.externals?.imdb || null;
	} catch (e) {
		console.error('Error', id, e);
		return null;
	}
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const rssUrl = `https://showrss.info/other/all.rss`;
	await startLoop(rssUrl, 60000, '');
	res.status(200).json({
		status: 'success',
		message: 'Scraping completed or stopped at specified ID',
	});
	return;
}
