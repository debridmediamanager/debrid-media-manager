import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse } from '@/services/scrapeJobs';
import { cleanByImdbId } from '@/services/tvCleaner';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	const { id } = req.query;

	let imdbIds = !!id ? [id as string] : await db.getAllImdbIds('tv');
	if (!imdbIds) {
		console.log(
			'[tvcleaner] There must be something wrong with the database, waiting 60 seconds'
		);
		return;
	}
	let uniqueIds = Array.from(new Set(imdbIds));
	for (let i = 0; i < uniqueIds.length; i++) {
		console.log(`[ ${i + 1} / ${uniqueIds.length} ] `);
		await cleanByImdbId(uniqueIds[i]);
	}
	res.status(200).json({ status: 'success' });
	return;
}
