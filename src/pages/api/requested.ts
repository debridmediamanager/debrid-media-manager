import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<ScrapeResponse>
) {
	const { scrapePassword, processing } = req.query;
	if (process.env.SEARCH_SPEED_PASSWORD && scrapePassword !== process.env.SEARCH_SPEED_PASSWORD) {
		res.status(403).json({ status: 'error', errorMessage: 'You are not authorized to use this feature' });
		return;
	}

	let imdbId: string | null = '';
	if (processing === 'true') {
		imdbId = await db.getOldestProcessing();
		if (!imdbId) {
			res.status(200).json({ status: 'done' });
			return;
		}
	} else {
		imdbId = await db.getLatestRequest();
		if (!imdbId) {
			res.status(200).json({ status: 'done' });
			return;
		}

		const isProcessing = await db.keyExists(`processing:${imdbId}`);
		if (isProcessing) {
			res.status(200).json({ status: 'processing' });
			return;
		}
	}

	await generateScrapeJobs(res, imdbId, true);
}
