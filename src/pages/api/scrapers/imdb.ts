import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	const { id, replaceOldScrape } = req.query;

	if (!id || !(typeof id === 'string')) {
		res.status(400).json({ status: 'error', errorMessage: 'Missing "id" query parameter' });
		return;
	}

	await new PlanetScaleCache().delete(id);
	await generateScrapeJobs(id.toString().trim(), replaceOldScrape === 'true');
	res.status(200).json({ status: 'success' });
	process.exit(0);
}
