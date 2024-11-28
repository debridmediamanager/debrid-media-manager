import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { Repository } from '@/services/planetscale';
import { computeHashFromTorrent } from '@/utils/extractHashFromTorrent';
import axios, { AxiosError } from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();
const animeUrl = (anidbId: number, page: number = 1) =>
	`https://animetosho.org/series/${anidbId}?page=${page}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	const toSave: { key: string; value: ScrapeSearchResult[] }[] = [];
	const { startFrom } = req.query;
	let startFromHere = parseInt((startFrom as string) ?? '1', 10);
	// loop from 1 to 18600
	for (let anidbId = startFromHere; anidbId <= 18600; anidbId++) {
		const scrapesMap = new Map<string, any>();
		try {
			console.log(animeUrl(anidbId));
			let response = null;
			while (true) {
				await new Promise((resolve) => setTimeout(resolve, 10000));
				try {
					response = await axios.get(animeUrl(anidbId), {
						headers: {
							'User-Agent':
								'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
						},
					});
					break;
				} catch (e: any) {
					console.log(`encountered error ${e}`, animeUrl(anidbId));
					if (((e as AxiosError).response?.status ?? 0) / 100 < 5) {
						break;
					} else {
						console.log('retrying after 30s', animeUrl(anidbId));
						await new Promise((resolve) => setTimeout(resolve, 30000));
					}
				}
			}
			if (!response) {
				continue;
			}
			const malId = response.data.match(
				/<a href="https:\/\/myanimelist.net\/anime\/(\d+)">MAL<\/a>/i
			);

			while (true) {
				const filenames: RegExpMatchArray[] = Array.from(
					response.data.matchAll(
						/<div class="link"><a href="https:\/\/animetosho.org\/view\/[^>]+>([^<]+)/gi
					)
				);
				// console.log(filenames.length);
				// <a href="{url}" class="dllink">Torrent</a>
				const torrentUrl: RegExpMatchArray[] = Array.from(
					response.data.matchAll(/<a href="([^"]+)" class="dllink">Torrent<\/a>/gi)
				);
				// console.log(torrentUrl.length);
				const fileSizes: RegExpMatchArray[] = Array.from(
					response.data.matchAll(
						/<div class="size" title="Total file size: ([0-9,]+) bytes">\d/gi
					)
				);
				// console.log(fileSizes.length);

				if (
					filenames.length !== torrentUrl.length ||
					torrentUrl.length !== fileSizes.length
				) {
					console.log('mismatch', filenames.length, torrentUrl.length, fileSizes.length);
					break;
				}

				const aniLinks = filenames.map((filename, index) => {
					const url = torrentUrl[index][1];
					// check if we can extract sha1 hash from url
					let hash = url.match(/([0-9a-f]{40})/i);
					return {
						filename: filename[1],
						hash: hash ? hash[1] : url,
						size_bytes:
							parseInt(fileSizes[index][1].replaceAll(',', ''), 10) / 1024 / 1024,
					};
				});

				for (const link of aniLinks) {
					if (
						link.hash.startsWith('http://bakabt.me') ||
						link.hash.startsWith('http://tracker.yibis')
					) {
						continue;
					}
					if (link.hash.startsWith('http')) {
						link.hash = (await computeHashFromTorrent(link.hash)) ?? '-';
					}
					if (link.hash === '-') {
						continue;
					}

					if (scrapesMap.has(`anime:anidb-${anidbId}`)) {
						scrapesMap.get(`anime:anidb-${anidbId}`).push(link);
					} else {
						scrapesMap.set(`anime:anidb-${anidbId}`, [link]);
					}
					if (malId) {
						if (scrapesMap.has(`anime:mal-${malId[1]}`)) {
							scrapesMap.get(`anime:mal-${malId[1]}`).push(link);
						} else {
							scrapesMap.set(`anime:mal-${malId[1]}`, [link]);
						}
					}
				}
				scrapesMap.forEach((value: ScrapeSearchResult[], key: string) => {
					toSave.push({ key, value });
				});

				// do this while there is a next page
				// href="{nextpageurl}">Older Entries
				const nextPage: RegExpMatchArray = response.data.match(
					/href="([^"]+)">Older Entries/i
				);
				if (nextPage) {
					await new Promise((resolve) => setTimeout(resolve, 10000));
					console.log(nextPage[1]);
					response = await axios.get(nextPage[1], {
						headers: {
							'User-Agent':
								'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
						},
					});
				} else {
					break;
				}
			}
			for (const save of toSave) {
				await db.saveScrapedTrueResults(save.key, save.value, true);
			}
			// reset toSave
			toSave.length = 0;
			scrapesMap.forEach((scrapes, key) => {
				const url = `https://debridmediamanager.com/${key.replaceAll(':', '/')}`;
				console.log(url, scrapes);
			});
		} catch (e) {
			console.log(`[anime] ${anidbId} failed (${e})`);
		}
	}
	res.status(200).json({ status: 'success' });
}
