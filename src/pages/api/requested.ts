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

	let updatedAt = null;
	while (true) {
		let request = await db.getOldestRequest(updatedAt);
		if (!request) {
			console.log('[requested] No requested jobs found, waiting 60 seconds');
			await new Promise((resolve) => setTimeout(resolve, 60000));
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
