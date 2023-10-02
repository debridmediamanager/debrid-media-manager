import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { imdbId, scrapePassword } = req.query;
	if (process.env.SCRAPE_API_PASSWORD && scrapePassword !== process.env.SCRAPE_API_PASSWORD) {
		res.status(403).json({
			status: 'error',
			errorMessage: 'You are not authorized to use this feature',
		});
		return;
	}

	if (!imdbId || !(typeof imdbId === 'string')) {
		res.status(400).json({ status: 'error', errorMessage: 'Missing "imdbId" query parameter' });
		return;
	}

	await new PlanetScaleCache().delete(imdbId);
	await generateScrapeJobs(imdbId.toString().trim(), true);
	res.status(200).json({ status: 'success' });
}
