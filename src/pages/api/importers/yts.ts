import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

interface ScrapeResponse {
	status: string;
	message?: string;
}

const pdb = new PlanetScaleCache();

// Define a function to fetch RSS content, extract IDs, and fetch details for each ID
const processJson = async (): Promise<void> => {
	try {
		// open file containing json and cast to YtsDetails[]
		const json = require('./yts.json') as YtsDetails[];
		const scrapesMap = new Map<string, any>();
		for (const details of json) {
			let imdbId = details.imdb_id;
			if (!imdbId) {
				console.error('No IMDB, TMDB, or TVMaze ID', details);
				continue;
			}
			const scrape = {
				title: details.title,
				fileSize: details.size / 1024 / 1024,
				hash: details.hash.toLocaleLowerCase(),
			};
			if (scrapesMap.has(`movie:${imdbId}`)) {
				scrapesMap.get(`movie:${imdbId}`).push(scrape);
			} else {
				scrapesMap.set(`movie:${imdbId}`, [scrape]);
			}
		}
		const toSave: { key: string; value: ScrapeSearchResult[] }[] = [];
		scrapesMap.forEach((value: ScrapeSearchResult[], key: string) => {
			toSave.push({ key, value });
		});
		for (const save of toSave) {
			await pdb.saveScrapedTrueResults(save.key, save.value, true);
		}
	} catch (error) {
		console.error('An error occurred processing json:', error);
	}
};

interface YtsDetails {
	url: string;
	imdb_id: string;
	hash: string;
	title: string;
	quality_id: string;
	size: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	await processJson();
	res.status(200).json({
		status: 'success',
		message: 'Scraping completed or stopped at specified ID',
	});
	return;
}
