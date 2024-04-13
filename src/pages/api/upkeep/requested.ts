import { ScrapeResponse, generateScrapeJobs } from '@/pages/scrapers/scrapeJobs';
import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	let updatedAt = null;
	while (true) {
		let request = await db.getOldestRequest(updatedAt);
		if (!request) {
			console.log('[requested] No requested jobs found, waiting 120 seconds');
			await new Promise((resolve) => setTimeout(resolve, 120000));
			continue;
		}

		const isProcessing = await db.keyExists(`processing:${request.key}`);
		if (isProcessing) {
			console.log(`[requested] Already processing ${request.key}, skipping`);
			updatedAt = request.updatedAt;
			continue;
		}

		await generateScrapeJobs(request.key);
	}
}
