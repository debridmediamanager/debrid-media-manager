import { ScrapeResponse, generateScrapeJobs } from '@/scrapers/scrapeJobs';
import { Repository } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	while (true) {
		console.log('[tvupdater] Checking for old media');
		let imdbIds = await db.getOldestScrapedMedia('tv', 30);
		if (!imdbIds) {
			console.log(
				'[tvupdater] There must be something wrong with the database, waiting 60 seconds'
			);
			await new Promise((resolve) => setTimeout(resolve, 60000));
			continue;
		}

		let uniqueIds = Array.from(new Set(imdbIds));
		uniqueIds = uniqueIds.slice(0, 3);
		await Promise.all(uniqueIds.map(async (imdbId) => await generateScrapeJobs(imdbId)));
	}
}
