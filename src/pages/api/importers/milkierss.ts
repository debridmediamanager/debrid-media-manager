import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';
import { milkieGetDetails } from './milkie';

interface ScrapeResponse {
	status: string;
	message?: string;
}

// Define a sleep function
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pdb = new PlanetScaleCache();

const extractIds = (rssContent: string): string[] => {
	const linkRegex = /<link>https:\/\/milkie.cc\/api\/v1\/torrents\/(.*?)\/[^<]+<\/link>/g;
	let match;
	const ids = [];
	while ((match = linkRegex.exec(rssContent)) !== null) {
		ids.push(match[1]);
	}
	return ids;
};

// Define a function to fetch RSS content, extract IDs, and fetch details for each ID
const fetchRssAndDetails = async (
	rssUrl: string,
	bearerToken: string,
	lastId: string
): Promise<string> => {
	try {
		const rssResponse = await fetch(rssUrl);
		const rssContent = await rssResponse.text();
		const ids = extractIds(rssContent);
		console.log('IDS', ids.length);
		const scrapesMap = new Map<string, any>();
		for (const id of ids) {
			if (id === lastId) {
				console.log('Encountered previously processed ID, stopping...');
				break;
			}
			const details = await milkieGetDetails(bearerToken, id);
			if (details === null) {
				continue;
			}
			let imdbId = details.torrent.externals.imdb;
			if (!imdbId) {
				imdbId = details.torrent.externals.tmdb
					? `tmdb-${details.torrent.externals.tmdb.toString()}`
					: null;
			}
			if (!imdbId) {
				imdbId = details.torrent.externals.tvmaze
					? `tvmaze-${details.torrent.externals.tvmaze.toString()}`
					: null;
			}
			if (!imdbId) {
				// console.error('No IMDB, TMDB, or TVMaze ID', details.torrent);
				continue;
			}
			if (details.torrent.category === 1) {
				// // movie
				// console.log('Movie');
				// console.log('Release name', details.torrent.releaseName);
				// console.log('Size', details.torrent.size);
				// console.log('Hash', details.torrent.infoHash);
				// console.log('IMDB', details.torrent.externals.imdb);
				const scrape = {
					title: details.torrent.releaseName,
					fileSize: details.torrent.size / 1024 / 1024,
					hash: details.torrent.infoHash.toLocaleLowerCase(),
				};
				if (scrapesMap.has(`movie:${imdbId}`)) {
					scrapesMap.get(`movie:${imdbId}`).push(scrape);
				} else {
					scrapesMap.set(`movie:${imdbId}`, [scrape]);
				}
			} else if (details.torrent.category === 2) {
				// // tv
				// console.log('TV');
				// console.log('Release name', details.torrent.releaseName);
				// console.log('Size', details.torrent.size);
				// console.log('Hash', details.torrent.infoHash);
				// console.log('IMDB', details.torrent.externals.imdb);
				let seasonNum: number | null = null;
				const seasonMatch =
					details.torrent.releaseName.match(/S(\d{1,2})E?/i) ||
					details.torrent.releaseName.match(/Season\s?(\d{1,2})/i) ||
					details.torrent.releaseName.match(/(\d{1,2})x\d{1,2}/i);

				if (seasonMatch && seasonMatch[1]) {
					seasonNum = parseInt(seasonMatch[1], 10);
				} else {
					console.warn('No season match, setting to 1', details.torrent.releaseName);
					seasonNum = 1; // Default to season 1 if no match is found
				}
				const scrape = {
					title: details.torrent.releaseName,
					fileSize: details.torrent.size / 1024 / 1024,
					hash: details.torrent.infoHash.toLocaleLowerCase(),
				};
				if (scrapesMap.has(`tv:${imdbId}:${seasonNum}`)) {
					scrapesMap.get(`tv:${imdbId}:${seasonNum}`).push(scrape);
				} else {
					scrapesMap.set(`tv:${imdbId}:${seasonNum}`, [scrape]);
				}
				// scrapes.push(scrape);
			} else {
				console.error('Unknown category', details.torrent);
			}
			// Here you would fetch and log the details as before
		}
		scrapesMap.forEach(async (scrapes, key) => {
			const url = `https://debridmediamanager.com/${key
				.replaceAll(':', '/')
				.replaceAll('tv/', 'show/')}`;
			console.log(url, key, scrapes.length);
			await pdb.saveScrapedTrueResults(key, scrapes, true);
		});
		return ids[0]; // Return the most recent ID to track it
	} catch (error) {
		console.error('An error occurred fetching rss link:', error);
		return '';
	}
};

// A looping function with sleep for periodic execution and stopping when encountering a specific ID
const startLoop = async (
	rssUrl: string,
	bearerToken: string,
	interval: number,
	stopAtId: string
) => {
	let lastId = stopAtId;
	while (true) {
		console.log('Waking up');
		const newLastId = await fetchRssAndDetails(rssUrl, bearerToken, lastId);
		lastId = newLastId;
		console.log('Sleeping for', interval, 'ms');
		await sleep(interval);
	}
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { rss, token } = req.query;
	const rssUrl = decodeURIComponent(rss as string);
	await startLoop(rssUrl, token as string, 60000, '');
	res.status(200).json({
		status: 'success',
		message: 'Scraping completed or stopped at specified ID',
	});
	return;
}
