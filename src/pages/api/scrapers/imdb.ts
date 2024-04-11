import { ScrapeResponse, generateScrapeJobs } from '@/services/scrapeJobs';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	const { id, season, lastSeason, replaceOldScrape } = req.query;

	if (!id || !(typeof id === 'string')) {
		res.status(400).json({ status: 'error', errorMessage: 'Missing "id" query parameter' });
		return;
	}
	if (!id.startsWith('tt')) {
		res.status(400).json({ status: 'error', errorMessage: 'Invalid "id" query parameter' });
		return;
	}
	let seasonNum = parseInt((season as string) ?? '0', 10);
	if (lastSeason === 'true') {
		seasonNum = -1;
	}

	await generateScrapeJobs(id.toString().trim(), seasonNum, replaceOldScrape === 'true');
	res.status(200).json({ status: 'success' });
	// process.exit(0);
}
