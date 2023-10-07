import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse } from '@/services/scrapeJobs';
import { cleanByImdbId } from '@/services/tvCleaner';
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

	let imdbIds = ['tt0903747']; //await db.getAllImdbIds('tv');
	if (!imdbIds) {
		console.log(
			'[moviecleaner] There must be something wrong with the database, waiting 60 seconds'
		);
		return;
	}
	let uniqueIds = Array.from(new Set(imdbIds));
	for (let i = 0; i < uniqueIds.length; i++) {
		await cleanByImdbId(imdbIds[i]);
	}
	res.status(200).json({ status: 'success' });
	return;
}
