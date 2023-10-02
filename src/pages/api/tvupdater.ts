import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { scrapePassword, quantity } = req.query;
	if (process.env.SCRAPE_API_PASSWORD && scrapePassword !== process.env.SCRAPE_API_PASSWORD) {
		res.status(403).json({
			status: 'error',
			errorMessage: 'You are not authorized to use this feature',
		});
		return;
	}

	while (true) {
		let imdbIds = await db.getOldestScrapedMedia('tv', 10);
		if (!imdbIds) {
			console.log(
				'[tvupdater] There must be something wrong with the database, waiting 60 seconds'
			);
			await new Promise((resolve) => setTimeout(resolve, 60000));
			continue;
		}

		let uniqueIds = Array.from(new Set(imdbIds));
		uniqueIds = uniqueIds.slice(0, parseInt(quantity as string) || 1);
		await Promise.all(uniqueIds.map(async (imdbId) => await generateScrapeJobs(imdbId, true)));
	}
}
