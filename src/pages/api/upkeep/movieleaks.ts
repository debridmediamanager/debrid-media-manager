import { ScrapeResponse, generateScrapeJobs } from '@/scrapers/scrapeJobs';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	while (true) {
		console.log('[movieleaks] Fetching leaked IDs');
		let imdbIds = await getLeakedIDs();
		if (!imdbIds) {
			console.log('[movieleaks] Reddit API failure, waiting 60 seconds');
			await new Promise((resolve) => setTimeout(resolve, 60000));
			continue;
		}

		for (const imdbId of imdbIds) {
			console.log(`[movieleaks] Generating scrape jobs for ${imdbId}`);
			await generateScrapeJobs(imdbId);
		}
		await new Promise((resolve) => setTimeout(resolve, 3600000));
	}
}

async function getLeakedIDs(): Promise<string[]> {
	const response = await axios.get('https://www.reddit.com/r/movieleaks.json');
	console.log(response.data.data.children);
	// match tt\d+ only on selftext
	const matches: string[] = response.data.data.children
		.map((post: any) => {
			return post.data.selftext.match(/tt\d+/g) || [];
		})
		.flat();
	return [...new Set(matches)];
}
