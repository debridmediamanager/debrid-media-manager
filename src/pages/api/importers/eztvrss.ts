import { ScrapeResponse } from '@/pages/api/scrapers/services/scrapeJobs';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();
const eztvUrl = (imdbId: string, page: number = 1) =>
	`https://eztv.tf/api/get-torrents?imdb_id=${imdbId.replace('tt', '')}&limit=100&page=${page}`;
const eztvUrl2 = (page: number = 1) => `https://eztv.tf/api/get-torrents?limit=100&page=${page}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	let lastId = 0;
	while (true) {
		// iterate from 1 to 100
		let imdbIds: string[] = [];
		let breakLoop = false;
		for (let pg = 1; pg <= 100; pg++) {
			try {
				const response = await axios.get(eztvUrl2(pg));
				let torrentsToProcess = response.data.torrents || [];
				// filter response up to last id
				if (lastId > 0) {
					const lastIdx = torrentsToProcess.findIndex((e: EztvItem) => e.id === lastId);
					if (lastIdx >= 0) {
						torrentsToProcess = torrentsToProcess.slice(0, lastIdx);
						breakLoop = true;
					}
				}
				imdbIds = Array.from(
					new Set(
						torrentsToProcess
							.filter((e: EztvItem) => e.imdb_id && e.imdb_id !== '0')
							.map((e: EztvItem) => `tt${e.imdb_id}`)
					)
				);
				console.log(`[eztv] found ${torrentsToProcess.length} torrents, page ${pg}`);
				if (pg === 1 && torrentsToProcess.length > 0) {
					lastId = torrentsToProcess[0].id ?? 0;
				}
			} catch (e) {
				console.log(`[eztv] failed (${e})`);
			}
			for (const imdbId of imdbIds) {
				// show percentage
				const scrapesMap = new Map<string, any>();
				try {
					console.log(`[eztv] processing ${imdbId}`);
					const response = await axios.get(eztvUrl(imdbId));
					let eztvLinks: ScrapeSearchResult[] = (response.data.torrents || []).map(
						(e: EztvItem) => processStream(e, imdbId)
					);
					if (eztvLinks.length === 0) {
						console.log(`[eztv] ${imdbId} has no links`);
						continue;
					}

					const totalCount = response.data.torrents_count ?? 0;
					console.log(`[eztv] ${imdbId} has ${eztvLinks.length}/${totalCount} links`);
					while (eztvLinks.length < totalCount) {
						const nextPage = Math.floor(eztvLinks.length / 100) + 1;
						const nextResponse = await axios.get(eztvUrl(imdbId, nextPage));
						eztvLinks = eztvLinks.concat(
							(nextResponse.data.torrents || []).map((e: EztvItem) =>
								processStream(e, imdbId)
							)
						);
						console.log(`[eztv] ${imdbId} has ${eztvLinks.length}/${totalCount} links`);
					}
					eztvLinks = eztvLinks.filter((e: ScrapeSearchResult | null) => e !== null);

					for (const link of eztvLinks) {
						let seasonNum: number | null = null;
						const seasonMatch =
							link.title.match(/S(\d{1,2})E?/i) ||
							link.title.match(/S[a-z]+n\s?(\d{1,2})/i) ||
							link.title.match(/(\d{1,2})x\d{1,2}/i);
						if (seasonMatch && seasonMatch[1]) {
							seasonNum = parseInt(seasonMatch[1], 10);
						} else {
							console.warn('No season match, setting to 1', link.title);
							seasonNum = 1; // Default to season 1 if no match is found
						}
						if (scrapesMap.has(`tv:${imdbId}:${seasonNum}`)) {
							scrapesMap.get(`tv:${imdbId}:${seasonNum}`).push(link);
						} else {
							scrapesMap.set(`tv:${imdbId}:${seasonNum}`, [link]);
						}
					}
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
						console.log(
							url,
							scrapes,
							`(${imdbIds.indexOf(imdbId) + 1}/${imdbIds.length})`
						);
					});
				} catch (e) {
					console.log(`[eztv] ${imdbId} failed (${e})`);
				}
			}
			if (breakLoop) {
				break;
			}
			console.log(`[eztv] ${imdbIds.length} imdb ids processed`);
		}
		await new Promise((r) => setTimeout(r, 60000));
	}
}

interface EztvItem {
	id: number;
	filename: string;
	hash: string;
	imdb_id: string | null;
	size_bytes: string;
}

function processStream(item: EztvItem, imdbId: string): ScrapeSearchResult | null {
	if (`tt${item.imdb_id ?? ''}` !== imdbId) {
		return null;
	}
	return {
		title: item.filename,
		fileSize: parseInt(item.size_bytes, 10) / 1024 / 1024,
		hash: item.hash.toLowerCase(),
	};
}
