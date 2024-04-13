import { ScrapeResponse } from '@/pages/scrapers/scrapeJobs';
import { cleanByImdbId } from '@/services/movieCleaner';
import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	const { id } = req.query;

	let imdbIds = !!id ? [id as string] : await db.getAllImdbIds('movie');
	if (!imdbIds) {
		console.log(
			'[moviecleaner] There must be something wrong with the database, waiting 60 seconds'
		);
		return;
	}
	for (let i = 0; i < imdbIds.length; i++) {
		console.log(`[ ${i + 1} / ${imdbIds.length} ] `);
		await cleanByImdbId(imdbIds[i]);
	}
	res.status(200).json({ status: 'success' });
	return;
}
