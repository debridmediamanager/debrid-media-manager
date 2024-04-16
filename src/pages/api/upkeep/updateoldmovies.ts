import { ScrapeResponse, generateScrapeJobs } from '@/scrapers/scrapeJobs';
import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	while (true) {
		console.log('[movieupdater] Checking for old media');
		let imdbIds = await db.getOldestScrapedMedia('movie', 3);
		if (!imdbIds) {
			console.log(
				'[movieupdater] There must be something wrong with the database, waiting 60 seconds'
			);
			await new Promise((resolve) => setTimeout(resolve, 60000));
			continue;
		}

		await Promise.all(imdbIds.map(async (imdbId) => await generateScrapeJobs(imdbId)));
	}
}
