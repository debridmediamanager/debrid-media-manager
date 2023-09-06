import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { scrapePassword, mediaType } = req.query;
	if (process.env.SCRAPE_API_PASSWORD && scrapePassword !== process.env.SCRAPE_API_PASSWORD) {
		res.status(403).json({
			status: 'error',
			errorMessage: 'You are not authorized to use this feature',
		});
		return;
	}

	let imdbId = await db.getOldestScrapedMedia(mediaType === 'tv' ? 'tv' : 'movie');
	if (!imdbId) {
		res.status(200).json({ status: 'done' });
		return;
	}

	await generateScrapeJobs(res, imdbId, true);
}
