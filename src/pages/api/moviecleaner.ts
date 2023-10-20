import { cleanByImdbId } from '@/services/movieCleaner';
import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { scrapePassword, id } = req.query;
	if (process.env.SCRAPE_API_PASSWORD && scrapePassword !== process.env.SCRAPE_API_PASSWORD) {
		res.status(403).json({
			status: 'error',
			errorMessage: 'You are not authorized to use this feature',
		});
		return;
	}

	let imdbIds = !!id ? [id as string] : await db.getAllImdbIds('movie');
	if (!imdbIds) {
		console.log(
			'[moviecleaner] There must be something wrong with the database, waiting 60 seconds'
		);
		return;
	}
	for (let i = 0; i < imdbIds.length; i++) {
		await cleanByImdbId(imdbIds[i]);
	}
	res.status(200).json({ status: 'success' });
	return;
}
