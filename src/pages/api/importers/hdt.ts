import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { Repository } from '@/services/planetscale';
import fs from 'fs';
import { NextApiRequest, NextApiResponse } from 'next';

const pdb = new Repository();

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const cwd = process.cwd();
	console.log(`[tgx] cwd: ${cwd}`);

	let toSave: { key: string; value: ScrapeSearchResult[] }[] = [];

	const getFname = (pg = 1) => `${cwd}/src/hdt/movies-${pg}.json`;
	let page = 991;
	// 1003, 2003, 3003...
	// while (true) {
	// 	if (fs.existsSync(getFname(page))) {
	// 		console.log(`[tgx] file ${getFname(page)} exists`);
	// 		const data = fs.readFileSync(getFname(page), 'utf8');
	// 		const fileData = JSON.parse(data);
	// 		for (const torrent of fileData) {
	// 			if (toSave.find((e) => e.key === `movie:${torrent.imdbId}`) !== undefined) {
	// 				toSave.find((e) => e.key === `movie:${torrent.imdbId}`)!.value.push({
	// 					title: torrent.title.trim(),
	// 					fileSize: torrent.fileSize,
	// 					hash: torrent.infohash.toLowerCase(),
	// 				});
	// 			} else {
	// 				toSave.push({ key: `movie:${torrent.imdbId}`, value: [{
	// 					title: torrent.title.trim(),
	// 					fileSize: torrent.fileSize,
	// 					hash: torrent.infohash.toLowerCase(),
	// 				}] });
	// 			}
	// 		}
	// 		page=page+4;
	// 	} else {
	// 		console.error(`[tgx] file ${getFname(page)} does not exist`);
	// 		break;
	// 	}
	// 	// if toSave keys are more than 500, save them
	// 	if (toSave.length > 500) {
	// 		for (const save of toSave) {
	// 			console.log(`[tgx] saving ${save.key}`, save.value.length);
	// 			await pdb.saveScrapedTrueResults(save.key, save.value, true);
	// 		}
	// 		toSave = [];
	// 	}
	// }

	// for (const save of toSave) {
	// 	console.log(`[tgx] saving ${save.key}`, save.value.length);
	// 	await pdb.saveScrapedTrueResults(save.key, save.value, true);
	// }

	toSave = [];

	const getFname2 = (pg = 1) => `${cwd}/src/hdt/tv-${pg}.json`;
	page = 3;
	while (true) {
		if (fs.existsSync(getFname2(page))) {
			console.error(`[tgx] file ${getFname2(page)} exists`);
			const data = fs.readFileSync(getFname2(page), 'utf8');
			const fileData = JSON.parse(data);
			for (const torrent of fileData) {
				if (
					toSave.find((e) => e.key === `tv:${torrent.imdbId}:${torrent.seasonNum}`) !==
					undefined
				) {
					toSave
						.find((e) => e.key === `tv:${torrent.imdbId}:${torrent.seasonNum}`)!
						.value.push({
							title: torrent.title.trim(),
							fileSize: torrent.fileSize,
							hash: torrent.infohash.toLowerCase(),
						});
				} else {
					toSave.push({
						key: `tv:${torrent.imdbId}:${torrent.seasonNum}`,
						value: [
							{
								title: torrent.title.trim(),
								fileSize: torrent.fileSize,
								hash: torrent.infohash.toLowerCase(),
							},
						],
					});
				}
			}
			page = page + 4;
		} else {
			console.error(`[tgx] file ${getFname2(page)} does not exist`);
			break;
		}
		// if toSave keys are more than 500, save them
		if (toSave.length > 500) {
			for (const save of toSave) {
				console.log(`[tgx] saving ${save.key}`, save.value.length);
				await pdb.saveScrapedTrueResults(save.key, save.value, true);
			}
			toSave = [];
		}
	}

	for (const save of toSave) {
		console.log(`[tgx] saving ${save.key}`, save.value.length);
		await pdb.saveScrapedTrueResults(save.key, save.value, true);
	}

	res.status(200).json({ status: 'success' });
}
