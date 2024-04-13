import { ScrapeResponse } from '@/pages/scrapers/scrapeJobs';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();
const eztvUrl = (imdbId: string, page: number = 1) =>
	`https://eztv.tf/api/get-torrents?imdb_id=${imdbId.replace('tt', '')}&limit=100&page=${page}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { startFrom } = req.query;
	let imdbIds = await db.getAllImdbIds('tv');
	if (!imdbIds) {
		res.status(500).json({
			status: 'error',
			errorMessage: 'Something wrong with the database',
		});
		return;
	}
	imdbIds = Array.from(new Set(imdbIds.map((e) => e.split(':')[0])));
	imdbIds = imdbIds.sort();
	let startFromHere = (startFrom as string) ?? '';
	while (true) {
		for (const imdbId of imdbIds) {
			if (startFromHere && imdbId !== startFromHere) continue;
			startFromHere = '';
			const index = imdbIds.indexOf(imdbId);
			const percentage = Math.round((index / imdbIds.length) * 100);
			const scrapesMap = new Map<string, any>();
			try {
				const response = await axios.get(eztvUrl(imdbId));
				let eztvLinks: ScrapeSearchResult[] = (response.data.torrents || []).map(
					(e: EztvItem) => processStream(e, imdbId)
				);
				if (eztvLinks.length === 0) {
					console.log(`[eztv] ${imdbId} has no links`);
					continue;
				}

				const totalCount = response.data.torrents_count ?? 0;
				while (eztvLinks.length < totalCount) {
					const nextPage = Math.floor(eztvLinks.length / 100) + 1;
					const nextResponse = await axios.get(eztvUrl(imdbId, nextPage));
					eztvLinks = eztvLinks.concat(
						(nextResponse.data.torrents || []).map((e: EztvItem) =>
							processStream(e, imdbId)
						)
					);
				}
				eztvLinks = eztvLinks.filter((e: ScrapeSearchResult | null) => e !== null);

				console.log(
					`[eztv] ${imdbId} has ${eztvLinks.length} links ${percentage}% (${index}/${imdbIds.length})`
				);

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
					console.log(url, scrapes);
				});
			} catch (e) {
				console.log(`[eztv] ${imdbId} failed (${e})`);
			}
		}
		startFromHere = '';
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
