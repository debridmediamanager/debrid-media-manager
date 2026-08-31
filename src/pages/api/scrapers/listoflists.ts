import { ScrapeInput } from '@/scrapers/scrapeInput';
import { ScrapeResponse, generateScrapeJobs } from '@/scrapers/scrapeJobs';
import { repository as db } from '@/services/repository';
import { authorizeScrapeRequest, exitIfScrapeWorker } from '@/services/scrapeAuth';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	// Before the env guard, so an anonymous caller learns nothing about which
	// indexers this deployment has configured.
	if (!authorizeScrapeRequest(req, res)) {
		return;
	}

	if (!process.env.JACKETT || !process.env.PROWLARR) {
		res.status(403).json({ status: 'failed' });
		return;
	}

	const { search, rescrapeIfXDaysOld, skipMs, quantity } = req.query;

	if (!search || typeof search !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'You must provide a search term',
		});
		return;
	}

	const scrapeInput = new ScrapeInput();

	for await (let listId of scrapeInput.byLists(search)) {
		let imdbIds = [];
		for await (let imdbId of scrapeInput.byListId(listId)) {
			if (!imdbId.startsWith('tt')) continue;
			const isProcessing = await db.keyExists(`processing:${imdbId}`);
			if (isProcessing) {
				console.log(`[searchlist] Already processing ${imdbId}, skipping`);
				continue;
			}
			if (!(await db.isOlderThan(imdbId, parseInt(rescrapeIfXDaysOld as string) || 10))) {
				console.log(`[searchlist] ${imdbId} was scraped recently, skipping`);
				await new Promise((resolve) =>
					setTimeout(resolve, parseInt(skipMs as string) || 1000)
				);
				continue;
			}
			imdbIds.push(imdbId);
			if (imdbIds.length >= (parseInt(quantity as string) || 1)) {
				await Promise.all(imdbIds.map(async (id) => await generateScrapeJobs(id)));
				imdbIds = [];
			}
		}
		if (imdbIds.length > 0) {
			await Promise.all(imdbIds.map(async (id) => await generateScrapeJobs(id)));
		}
	}
	res.status(200).json({ status: 'success' });
	// Only a one-shot `scraper.sh` worker exits here; a swarm replica must not.
	exitIfScrapeWorker();
}
