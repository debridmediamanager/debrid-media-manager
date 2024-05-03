import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import fs from 'fs';
import { NextApiRequest, NextApiResponse } from 'next';

const pdb = new PlanetScaleCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const cwd = process.cwd();
	console.log(`[json] cwd: ${cwd}`);

	let toSave: { key: string; value: ScrapeSearchResult[] }[] = [];
	const scrapesMap = new Map<string, ScrapeSearchResult[]>();
	let filesToDelete = [];

	// using fs, get the list of all json files in the directory
	let files = fs.readdirSync(`${cwd}/src/json-to-import`);
	//filter out everything where filename doesnt start with cine-
	// files = files.filter((file) => file.includes('cine-'));
	// iterate over the files
	for (const file of files) {
		// check if the file is a json file
		if (!file.endsWith('.json')) continue;
		// log the file name and position in array
		console.log(`[json] file: ${file}`, files.indexOf(file) + 1, 'of', files.length);
		// read the file
		const data = fs.readFileSync(`${cwd}/src/json-to-import/${file}`, 'utf8');
		// parse the json
		const contents = JSON.parse(data);
		// contents in an array of objects with prop: title, infoHash, imdbId, size and category
		for (const content of contents) {
			console.log(`[json] content`, content);
			const imdbId = content.imdbId ?? content.imdb;
			if (!imdbId || imdbId.includes('not found')) continue;
			if (!content.size.trim().endsWith('B')) continue;
			let fileSize = 0;
			let [size, unit] = content.size.trim().replace(/,/g, '').split(' ');
			switch (unit[0].toLocaleLowerCase()) {
				case 't':
					fileSize = parseFloat(size) * 1024 * 1024;
					break;
				case 'g':
					fileSize = parseFloat(size) * 1024;
					break;
				case 'm':
					fileSize = parseFloat(size);
					break;
				case 'k':
					fileSize = parseFloat(size) / 1024;
					break;
				default:
					fileSize = parseFloat(size);
					break;
			}
			let scrape = {
				title: content.title.trim(),
				fileSize,
				hash: content.infoHash.toLocaleLowerCase(),
			};
			const category = content.category.trim().toLocaleLowerCase();
			if (category.includes('tv')) {
				let seasonNum: number | null = null;
				const seasonMatch =
					content.title.match(/S(\d{1,2})E?/i) ||
					content.title.match(/Season.?(\d{1,2})/i) ||
					content.title.match(/(\d{1,2})x\d{1,2}/i);

				if (seasonMatch && seasonMatch[1]) {
					seasonNum = parseInt(seasonMatch[1], 10);
				} else {
					console.warn('No season match, setting to 1', content.title);
					seasonNum = 1; // Default to season 1 if no match is found
				}
				// console.log(`[json] hash: ${content.title.trim()}`);
				if (scrapesMap.has(`tv:${imdbId}:${seasonNum}`)) {
					scrapesMap.get(`tv:${imdbId}:${seasonNum}`)!.push(scrape);
				} else {
					scrapesMap.set(`tv:${imdbId}:${seasonNum}`, [scrape]);
				}
			} else {
				if (scrapesMap.has(`movie:${imdbId}`)) {
					scrapesMap.get(`movie:${imdbId}`)!.push(scrape);
				} else {
					scrapesMap.set(`movie:${imdbId}`, [scrape]);
				}
			}
		}

		scrapesMap.forEach((value: ScrapeSearchResult[], key: string) => {
			toSave.push({ key, value });
		});

		filesToDelete.push(`${cwd}/src/json-to-import/${file}`);

		if (toSave.length >= 2000) {
			console.log(`[json] saving ${toSave.length} items`);
			let promises = [];
			for (const save of toSave) {
				try {
					promises.push(pdb.saveScrapedTrueResults(save.key, save.value, true));
					if (promises.length >= 20) {
						console.log('awaiting all promises...');
						await new Promise((resolve) => setTimeout(resolve, 1000)); // wait 1 second
						await Promise.all(promises);
					}
				} catch (e) {
					console.error(`[json] error saving ${save.key}`, e);
					await new Promise((resolve) => setTimeout(resolve, 1000)); // wait 1 second
					await Promise.all(promises);
				} finally {
					if (promises.length >= 20) {
						promises.length = 0;
					}
				}
			}
			await Promise.all(promises);
			toSave.length = 0;
			scrapesMap.clear();
			// delete the files
			for (const file of filesToDelete) {
				fs.unlinkSync(file);
			}
			filesToDelete.length = 0;
		}
	}

	console.log(`[json] saving ${toSave.length} items`);

	let promises = [];
	for (const save of toSave) {
		try {
			promises.push(pdb.saveScrapedTrueResults(save.key, save.value, true));
			if (promises.length >= 10) {
				await Promise.all(promises);
			}
		} catch (e) {
			console.error(`[json] error saving ${save.key}`, e);
		} finally {
			if (promises.length >= 10) {
				promises.length = 0;
			}
		}
	}
	try {
		await Promise.all(promises);
	} catch (e) {}
	for (const file of filesToDelete) {
		fs.unlinkSync(file);
	}

	console.log(`[json] done saving`);

	res.status(200).json({ status: 'success' });
}
