import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	const { quantity } = req.query;

	while (true) {
		let imdbIds = await db.getOldestScrapedMedia('movie', parseInt(quantity as string));
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
