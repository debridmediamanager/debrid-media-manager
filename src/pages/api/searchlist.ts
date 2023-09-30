import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeInput } from '@/services/scrapeInput';
import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { scrapePassword, search, rescrapeIfXDaysOld, skipMs, quantity } = req.query;
	if (process.env.SCRAPE_API_PASSWORD && scrapePassword !== process.env.SCRAPE_API_PASSWORD) {
		res.status(403).json({
			status: 'error',
			errorMessage: 'You are not authorized to use this feature',
		});
		return;
	}
	if (!search || typeof search !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'You must provide a search term',
		});
		return;
	}

	const scrapeInput = new ScrapeInput();

	for await (let listId of scrapeInput.byLists(search)) {
		let imdbIds = [];
		for await (let imdbId of scrapeInput.byListId(listId)) {
			const isProcessing = await db.keyExists(`processing:${imdbId}`);
			if (isProcessing) {
				console.log(`[searchlist] Already processing ${imdbId}, skipping`);
				continue;
			}
			if (!(await db.isOlderThan(imdbId, parseInt(rescrapeIfXDaysOld as string) || 10))) {
				console.log(`[searchlist] ${imdbId} was scraped recently, skipping`);
				await new Promise((resolve) =>
					setTimeout(resolve, parseInt(skipMs as string) || 1000)
				);
				continue;
			}
			imdbIds.push(imdbId);
			if (imdbIds.length >= (parseInt(quantity as string) || 1)) {
				await Promise.all(imdbIds.map(async (id) => await generateScrapeJobs(id, true)));
				imdbIds = [];
			}
		}
		if (imdbIds.length > 0) {
			await Promise.all(imdbIds.map(async (id) => await generateScrapeJobs(id, true)));
		}
	}
}
