import { Repository } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

interface ScrapeResponse {
	status: string;
	message?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pdb = new Repository();

type CinemazMovieItem = {
	title: string;
	size: string;
	hash: string;
	imdb: string;
};

type CinemazTvItem = {
	title: string;
	size: string;
	hash: string;
	imdb: string;
	seasonNum: number;
};

const extractMovieItems = (rssContent: string): CinemazMovieItem[] => {
	const items: CinemazMovieItem[] = [];
	const regex =
		/<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>.*?imdb.com\/title\/(tt\d{7,8})\/.*?<\/link>[\s\S]*?<description>.*?Size: (.*?)<br>.*?Hash: (.*?)<br>.*?<\/description>[\s\S]*?<\/item>/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(rssContent)) !== null) {
		items.push({
			title: match[1],
			size: match[2],
			hash: match[3],
			imdb: match[4],
		});
	}
	return items;
};

const extractTvItems = (rssContent: string): CinemazTvItem[] => {
	const items: CinemazTvItem[] = [];
	const regex =
		/<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>.*?imdb.com\/title\/(tt\d{7,8})\/.*?<\/link>[\s\S]*?<description>.*?Size: (.*?)<br>.*?Hash: (.*?)<br>.*?Season: (\d{1,2})<br>.*?<\/description>[\s\S]*?<\/item>/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(rssContent)) !== null) {
		items.push({
			title: match[1],
			size: match[2],
			hash: match[3],
			imdb: match[4],
			seasonNum: parseInt(match[5], 10),
		});
	}
	return items;
};

// Define a function to fetch RSS content, extract IDs, and fetch details for each ID
const fetchRssAndDetails = async (
	rssUrl: string,
	mediaType: string,
	lastTitle: string
): Promise<string> => {
	try {
		const rssResponse = await fetch(rssUrl);
		const rssContent = await rssResponse.text();
		const movies = extractMovieItems(rssContent);
		const scrapesMap = new Map<string, any>();
		for (const movie of movies) {
			if (movie.title === lastTitle) {
				// console.log('Encountered previously processed ID, stopping...');
				break;
			}
			const details: any[] = [{}];
			// const details = await cinemazGetDetails(id);
			// if (!details.length) {
			// 	continue;
			// }
			if (mediaType === 'movie') {
				for (let i = 0; i < details.length; i++) {
					let imdbId = details[i].imdb;
					if (!imdbId) {
						console.error('No IMDB, TMDB, or TVMaze ID', details[i]);
						continue;
					}
					const scrape = {
						title: details[i].name,
						fileSize: details[i].size,
						hash: details[i].hash.toLocaleLowerCase(),
					};
					if (scrapesMap.has(`movie:${imdbId}`)) {
						scrapesMap.get(`movie:${imdbId}`).push(scrape);
					} else {
						scrapesMap.set(`movie:${imdbId}`, [scrape]);
					}
				}
			} else if (mediaType === 'tv') {
				for (let i = 0; i < details.length; i++) {
					let imdbId = details[i].imdb;
					if (!imdbId) {
						console.error('No IMDB, TMDB, or TVMaze ID', details[i]);
						continue;
					}
					let seasonNum: number | null = null;
					const seasonMatch =
						details[i].name.match(/S(\d{1,2})E?/i) ||
						details[i].name.match(/Season.?(\d{1,2})/i) ||
						details[i].name.match(/(\d{1,2})x\d{1,2}/i);

					if (seasonMatch && seasonMatch[1]) {
						seasonNum = parseInt(seasonMatch[1], 10);
					} else {
						console.warn('No season match, setting to 1', details[i].name);
						seasonNum = 1; // Default to season 1 if no match is found
					}
					const scrape = {
						title: details[i].name,
						fileSize: details[i].size,
						hash: details[i].hash.toLocaleLowerCase(),
					};
					if (scrapesMap.has(`tv:${imdbId}:${seasonNum}`)) {
						scrapesMap.get(`tv:${imdbId}:${seasonNum}`).push(scrape);
					} else {
						scrapesMap.set(`tv:${imdbId}:${seasonNum}`, [scrape]);
					}
				}
			}
		}
		scrapesMap.forEach(async (scrapes, key) => {
			const url = `https://debridmediamanager.com/${key
				.replaceAll(':', '/')
				.replaceAll('tv/', 'show/')}`;
			console.log(url, key, scrapes);
			await pdb.saveScrapedTrueResults(key, scrapes, true);
		});
		return movies[0].title;
	} catch (error) {
		console.error('An error occurred fetching rss link:', error);
		return '';
	}
};

// A looping function with sleep for periodic execution and stopping when encountering a specific ID
const startLoop = async (rssUrl: string, mediaType: string, interval: number, stopAtId: string) => {
	let lastTitle = stopAtId;
	while (true) {
		const newlastTitle = await fetchRssAndDetails(rssUrl, mediaType, lastTitle);
		lastTitle = newlastTitle;
		await sleep(interval);
	}
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { rss, mediaType } = req.query;
	const rssUrl = decodeURIComponent(rss as string);
	await startLoop(rssUrl, mediaType as string, 60000, '');
	res.status(200).json({
		status: 'success',
		message: 'Scraping completed or stopped at specified ID',
	});
	return;
}
