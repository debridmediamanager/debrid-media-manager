import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { PlanetScaleCache } from '@/services/planetscale';
import axios, { AxiosError } from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();
const animeRssUrl = `https://feed.animetosho.org/rss2?only_tor=1`;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	while (true) {
		const rssResponse = await axios.get(animeRssUrl);
		const rssItems = rssResponse.data.matchAll(
			/<link>(https:\/\/animetosho\.org\/view\/[^<]+)<\/link>/gi
		);
		const scrapesMap = new Map<string, any>();
		const toSave: { key: string; value: ScrapeSearchResult[] }[] = [];
		for (const rssItem of rssItems) {
			const torrentUrl = rssItem[1];
			try {
				console.log(torrentUrl);
				let response = null;
				while (true) {
					await new Promise((resolve) => setTimeout(resolve, 10000));
					try {
						response = await axios.get(torrentUrl, {
							headers: {
								'User-Agent':
									'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
							},
						});
						break;
					} catch (e: any) {
						console.log(`encountered error ${e}`, torrentUrl);
						if (((e as AxiosError).response?.status ?? 0) / 100 < 5) {
							break;
						} else {
							console.log('retrying after 30s', torrentUrl);
							await new Promise((resolve) => setTimeout(resolve, 30000));
						}
					}
				}
				if (!response) {
					continue;
				}

				const seriesUrl = response.data.match(
					/<td><a href="https:\/\/animetosho\.org\/series\/([^"]+)">/i
				);
				console.log('filename', seriesUrl ? seriesUrl[1] : 'not found');
				const anidbId = seriesUrl[1].split('.').pop();
				console.log('anidbId', anidbId ? anidbId : 'not found');
				const hash = response.data.match(/([0-9a-f]{40})/i);
				const filename = response.data.match(/<h2 id="title">([^<]+)<\/h2>/i);
				const fileSizeStr = response.data.match(/\(([0-9\.,]+) (MB|GB|TB)\)/i);
				const size_bytes = fileSizeStr
					? parseFloat(fileSizeStr[1].replaceAll(',', '')) *
					  1024 ** ['MB', 'GB', 'TB'].indexOf(fileSizeStr[2])
					: 0;

				const link = {
					filename: filename[1],
					hash: hash[1],
					size_bytes,
				};

				if (scrapesMap.has(`anime:anidb-${anidbId}`)) {
					scrapesMap.get(`anime:anidb-${anidbId}`).push(link);
				} else {
					scrapesMap.set(`anime:anidb-${anidbId}`, [link]);
				}
				scrapesMap.forEach((value: ScrapeSearchResult[], key: string) => {
					toSave.push({ key, value });
				});
			} catch (e) {
				console.log(`[anime] ${torrentUrl} failed (${e})`);
			}
		}
		for (const save of toSave) {
			await db.saveScrapedTrueResults(save.key, save.value, true);
		}
		scrapesMap.forEach((scrapes, key) => {
			const url = `https://debridmediamanager.com/${key.replaceAll(':', '/')}`;
			console.log(url, scrapes);
		});
		await new Promise((resolve) => setTimeout(resolve, 60000));
	}
}
