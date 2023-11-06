import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	while (true) {
		let imdbId = await db.processingMoreThanAnHour();
		if (!imdbId) {
			console.log('[processed] No processing jobs found, waiting 120 seconds');
			await new Promise((resolve) => setTimeout(resolve, 120000));
			continue;
		}
		await generateScrapeJobs(imdbId);
	}
}
