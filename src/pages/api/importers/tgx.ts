import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import { ScrapeResponse } from '@/services/scrapeJobs';
import fs from 'fs';
import { NextApiRequest, NextApiResponse } from 'next';

const pdb = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const cwd = process.cwd();
	console.log(`[tgx] cwd: ${cwd}`);

	// parse the json inside projectdir/tgx/movieImdbIds.json
	// const movieImdbIds = require('../../../tgx/movieImdbIds.json');
	const movieImdbIds: string[] = [];
	const movieImdbIdsLength = movieImdbIds.length;
	console.log(`[tgx] movieImdbIdsLength: ${movieImdbIdsLength}`);

	let toSave: { key: string; value: ScrapeSearchResult[] }[] = [];

	for (let i = 0; i < movieImdbIdsLength; i++) {
		const imdbId = movieImdbIds[i];
		// console.log(`[tgx] movieImdbId: ${imdbId}`);
		// check if file imdbId-1.json exists and parse it, use fs
		const getFname = (pg = 1) => `${cwd}/src/tgx/${imdbId}-${pg}.json`;
		const scrapes: ScrapeSearchResult[] = [];
		let page = 1;
		while (true) {
			if (fs.existsSync(getFname(page))) {
				console.log(`[tgx] file ${getFname(page)} exists`);
				const data = fs.readFileSync(getFname(page), 'utf8');
				const hashes = JSON.parse(data);
				for (const hash of hashes) {
					console.log(`[tgx] hash: ${hash.title.trim()}`);
					scrapes.push({
						title: hash.title.trim(),
						fileSize: hash.size,
						hash: hash.infoHash,
					});
				}
				page++;
			} else {
				console.log(`[tgx] file ${getFname(page)} does not exist`);
				break;
			}
		}
		toSave.push({ key: `movie:${imdbId}`, value: scrapes });
	}
	for (const save of toSave) {
		await pdb.saveScrapedTrueResults(save.key, save.value, true);
	}

	// parse the json inside projectdir/tgx/tvImdbIds.json
	// const tvImdbIds = require('../../../tgx/tvImdbIds.json');
	const tvImdbIds: string[] = [];
	const tvImdbIdsLength = tvImdbIds.length;
	console.log(`[tgx] tvImdbIdsLength: ${tvImdbIdsLength}`);

	toSave = [];
	const scrapesMap = new Map<string, ScrapeSearchResult[]>();

	for (let i = 0; i < tvImdbIdsLength; i++) {
		const imdbId = tvImdbIds[i];
		// console.log(`[tgx] movieImdbId: ${imdbId}`);
		// check if file imdbId-1.json exists and parse it, use fs
		const getFname = (pg = 1) => `${cwd}/src/tgx/${imdbId}-${pg}.json`;
		let page = 1;
		while (true) {
			if (fs.existsSync(getFname(page))) {
				// console.log(`[tgx] file ${getFname(page)} exists`);
				const data = fs.readFileSync(getFname(page), 'utf8');
				const hashes = JSON.parse(data);
				for (const hash of hashes) {
					let seasonNum: number | null = null;
					const seasonMatch =
						hash.title.match(/S(\d{1,2})E?/i) ||
						hash.title.match(/Season.?(\d{1,2})/i) ||
						hash.title.match(/(\d{1,2})x\d{1,2}/i);

					if (seasonMatch && seasonMatch[1]) {
						seasonNum = parseInt(seasonMatch[1], 10);
					} else {
						console.warn('No season match, setting to 1', hash.title);
						seasonNum = 1; // Default to season 1 if no match is found
					}
					// console.log(`[tgx] hash: ${hash.title.trim()}`);
					let scrape = {
						title: hash.title.trim(),
						fileSize: hash.size,
						hash: hash.infoHash,
					};
					if (scrapesMap.has(`tv:${imdbId}:${seasonNum}`)) {
						scrapesMap.get(`tv:${imdbId}:${seasonNum}`)!.push(scrape);
					} else {
						scrapesMap.set(`tv:${imdbId}:${seasonNum}`, [scrape]);
					}
				}
				page++;
			} else {
				// console.log(`[tgx] file ${getFname(page)} does not exist`);
				break;
			}
		}
		scrapesMap.forEach((value: ScrapeSearchResult[], key: string) => {
			toSave.push({ key, value });
		});
	}

	for (const save of toSave) {
		// console.log(`[tgx] saving ${save.key}`);
		await pdb.saveScrapedTrueResults(save.key, save.value, true);
	}

	res.status(200).json({ status: 'success' });
}
