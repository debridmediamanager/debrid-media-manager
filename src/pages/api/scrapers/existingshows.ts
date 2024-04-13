import { ScrapeResponse, generateScrapeJobs } from '@/pages/api/scrapers/services/scrapeJobs';
import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	const { quantity } = req.query;

	while (true) {
		console.log('[tvupdater] Checking for old media');
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
		await Promise.all(uniqueIds.map(async (imdbId) => await generateScrapeJobs(imdbId)));
	}
}
