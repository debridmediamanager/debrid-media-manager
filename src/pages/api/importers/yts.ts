import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import fs from 'fs';
import { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

interface ScrapeResponse {
	status: string;
	message?: string;
}

const pdb = new PlanetScaleCache();

// Define a function to fetch RSS content, extract IDs, and fetch details for each ID
const processJson = async (): Promise<void> => {
	try {
		// Read and parse the JSON file using fs
		const jsonPath = path.join(process.cwd(), 'src', 'pages', 'api', 'importers', 'yts.json');
		const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
		const json = JSON.parse(jsonContent) as YtsDetails[];

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
