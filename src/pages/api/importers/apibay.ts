import { ScrapeResponse } from '@/pages/scrapers/scrapeJobs';
import { ApiBayItem, processStream } from '@/pages/scrapers/sites/apibay';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import UserAgent from 'user-agents';

const db = new PlanetScaleCache();
const apiBayUrl = (imdbId: string) => `https://apibay.org/q.php?q=${imdbId}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const { startFrom, mediaType } = req.query;
	if (mediaType !== 'movie' && mediaType !== 'tv') {
		res.status(500).json({
			status: 'error',
			errorMessage: 'Invalid media type',
		});
	}
	const mediaTypeString = (mediaType as string) === 'tv' ? 'tv' : 'movie';

	let imdbIds = await db.getAllImdbIds(mediaTypeString);
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
			// show percentage
			const index = imdbIds.indexOf(imdbId);
			const percentage = Math.round((index / imdbIds.length) * 100);
			const scrapesMap = new Map<string, any>();
			try {
				const response = await axios.get(apiBayUrl(imdbId), {
					headers: {
						accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
						'accept-language': 'en-US,en;q=0.5',
						'accept-encoding': 'gzip, deflate, br',
						connection: 'keep-alive',
						'sec-fetch-dest': 'document',
						'sec-fetch-mode': 'navigate',
						'sec-fetch-site': 'same-origin',
						'sec-fetch-user': '?1',
						'upgrade-insecure-requests': '1',
						'user-agent': new UserAgent().toString(),
					},
				});
				const apiBayLinks: ScrapeSearchResult[] = response.data
					.map((e: ApiBayItem) => processStream(e, imdbId))
					.filter((e: ScrapeSearchResult | null) => e !== null);

				if (apiBayLinks.length === 0) {
					console.log(`[apibay] ${imdbId} has no links`);
					continue;
				}

				console.log(
					`[apibay] ${imdbId} has ${apiBayLinks.length} links ${percentage}% (${index}/${imdbIds.length})`
				);

				if (mediaTypeString === 'movie') {
					const url = `https://debridmediamanager.com/${mediaTypeString}/${imdbId}`;
					await db.saveScrapedTrueResults(
						`${mediaTypeString}:${imdbId}`,
						apiBayLinks,
						true
					);
					console.log(url, apiBayLinks);
				} else {
					for (const link of apiBayLinks) {
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
				}
			} catch (e) {
				console.log(`[apibay] ${imdbId} failed (${e})`);
			}
		}
		startFromHere = '';
	}
}
