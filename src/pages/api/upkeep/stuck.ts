import { ScrapeResponse, generateScrapeJobs } from '@/pages/scrapers/scrapeJobs';
import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	while (true) {
		let imdbId = await db.processingMoreThanAnHour();
		if (!imdbId) {
			console.log('[stuck] No processing jobs found, waiting 300 seconds');
			await new Promise((resolve) => setTimeout(resolve, 300000));
			continue;
		}
		await generateScrapeJobs(imdbId);
	}
}
