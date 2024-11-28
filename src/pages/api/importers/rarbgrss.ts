import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { Repository } from '@/services/planetscale';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();
const rarbgUrl = (page: number = 1) => `https://therarbg.to/get-posts/format:json/?page=${page}`;
const rarbgItemUrl = (id: string) => `https://therarbg.com/post-detail/${id}/abcdef/?format=json`;

// TODO: Add a way to process first page and second page

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	let pg = 1;
	while (true) {
		const scrapesMap = new Map<string, any>();
		try {
			const response: any = await axios.get(rarbgUrl(pg));
			let torrentsToProcess = response.data.results || [];
			torrentsToProcess = torrentsToProcess.filter((e: any) => e.i && e.i.startsWith('tt'));
			console.log(`[rarbg] found ${torrentsToProcess.length} torrents, page ${pg}`);
			try {
				for (const torrent of torrentsToProcess) {
					const item: any = await axios.get(rarbgItemUrl(torrent.pk));
					const result = processStream(item.data);
					if (torrent.c === 'Movies') {
						if (scrapesMap.has(`movie:${torrent.i}`)) {
							scrapesMap.get(`movie:${torrent.i}`).push(result);
						} else {
							scrapesMap.set(`movie:${torrent.i}`, [result]);
						}
					} else {
						let seasonNum: number | null = null;
						const seasonMatch =
							result.title.match(/S(\d{1,2})E?/i) ||
							result.title.match(/S[a-z]+n\s?(\d{1,2})/i) ||
							result.title.match(/(\d{1,2})x\d{1,2}/i);
						if (seasonMatch && seasonMatch[1]) {
							seasonNum = parseInt(seasonMatch[1], 10);
						} else {
							console.warn('No season match, setting to 1', result.title);
							seasonNum = 1; // Default to season 1 if no match is found
						}
						if (scrapesMap.has(`tv:${torrent.i}:${seasonNum}`)) {
							scrapesMap.get(`tv:${torrent.i}:${seasonNum}`).push(result);
						} else {
							scrapesMap.set(`tv:${torrent.i}:${seasonNum}`, [result]);
						}
					}
				}
			} catch (e) {
				console.log(`[rarbg] failed (${e})`);
			}
			pg++;
		} catch (e) {
			console.log(`[rarbg] failed (${e})`);
		}
		if (pg > 2) {
			const toSave: { key: string; value: ScrapeSearchResult[] }[] = [];
			scrapesMap.forEach((value: ScrapeSearchResult[], key: string) => {
				toSave.push({ key, value });
			});
			for (const save of toSave) {
				await db.saveScrapedTrueResults(save.key, save.value, true);
			}
			scrapesMap.forEach((scrapes, key) => {
				const url = `https://debridmediamanager.com/${key
					.replaceAll(':', '/')
					.replaceAll('tv/', 'show/')}`;
				console.log(url, scrapes);
			});
			pg = 1;
			await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 5));
		}
		continue;
	}
}

interface EztvItem {
	eid: string;
	name: string;
	info_hash: string;
	size: number;
}

function processStream(item: EztvItem): ScrapeSearchResult {
	return {
		title: item.name,
		fileSize: item.size / 1024 / 1024,
		hash: item.info_hash.toLowerCase(),
	};
}
