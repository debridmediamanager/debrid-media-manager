import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { scrapePassword } = req.query;
	if (process.env.SCRAPE_API_PASSWORD && scrapePassword !== process.env.SCRAPE_API_PASSWORD) {
		res.status(403).json({
			status: 'error',
			errorMessage: 'You are not authorized to use this feature',
		});
		return;
	}

	while (true) {
		let imdbId = await db.processingMoreThanAnHour();
		if (!imdbId) {
			console.log('[processed] No processing jobs found, waiting 60 seconds');
			await new Promise((resolve) => setTimeout(resolve, 60000));
			continue;
		}
		await generateScrapeJobs(imdbId);
	}
}
