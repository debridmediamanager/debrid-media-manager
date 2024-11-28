import { ScrapeResponse } from '@/scrapers/scrapeJobs';
import { ScrapeSearchResult } from '@/services/mediasearch';
import { Repository } from '@/services/planetscale';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();
const tgRssUrl = () => `https://torrentgalaxy.to/rss`;
const tgItemUrl = (id: string) => `https://torrentgalaxy.to/torrent/${id}`;

// TODO: Add a way to process first page and second page

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScrapeResponse>) {
	while (true) {
		const toSave: { key: string; value: ScrapeSearchResult[] }[] = [];
		try {
			const response: any = await axios.get(tgRssUrl());
			const rssText = response.data;
			const categoryRegex = /<category>(.*?)<\/category>/g;
			// Regex to find URLs within the comments tag and extract the ID
			const urlRegex = /<comments>https:\/\/torrentgalaxy\.to\/torrent\/(\d+)/g;
			const categoryMatches = rssText.match(categoryRegex);
			const urlMatches = rssText.match(urlRegex);
			for (let i = 0; i < categoryMatches.length; i++) {
				const category = categoryMatches[i].replace(/<\/?category>/g, '');
				if (!category.startsWith('Movies') && !category.startsWith('TV')) continue;
				// get item and pass to tgItemUrl
				const itemUrl = urlMatches[i].replace(/<\/?comments>/g, '');
				const item = await processItem(itemUrl);
				if (!item) continue;

				if (category.startsWith('Movies')) {
					// console.log(`[tgx] found ${category} ${itemUrl}`);
					// console.log('Movie item', item);
					toSave.push({
						key: `movie:${item.imdb}`,
						value: [
							{
								title: item.title.trim(),
								fileSize: computeFileSize(item.size),
								hash: item.hash,
							},
						],
					});
				}
				if (category.startsWith('TV')) {
					// console.log(`[tgx] found ${category} ${itemUrl}`);
					let seasonNum: number | null = null;
					const seasonMatch =
						item.title.match(/S(\d{1,2})E?/i) ||
						item.title.match(/S[a-z]+n\s?(\d{1,2})/i) ||
						item.title.match(/(\d{1,2})x\d{1,2}/i);
					if (seasonMatch && seasonMatch[1]) {
						seasonNum = parseInt(seasonMatch[1], 10);
					} else {
						console.warn('No season match, setting to 1', item.title);
						seasonNum = 1; // Default to season 1 if no match is found
					}
					toSave.push({
						key: `tv:${item.imdb}:${seasonNum}`,
						value: [
							{
								title: item.title.trim(),
								fileSize: computeFileSize(item.size),
								hash: item.hash,
							},
						],
					});
					// console.log('TV item', item);
				}
			}
			for (const save of toSave) {
				const url = `https://debridmediamanager.com/${save.key
					.replaceAll(':', '/')
					.replaceAll('tv/', 'show/')}`;
				console.log(`[tgx] saving ${url}`, save.value);
				await db.saveScrapedTrueResults(save.key, save.value, true);
			}
			await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
		} catch (e) {
			console.log(`[tgx] failed (${e})`);
		}
	}
}

interface TGItem {
	title: string;
	size: string;
	hash: string;
	imdb: string;
}

async function processItem(url: string): Promise<TGItem | null> {
	try {
		// console.log(`[tgx] processing ${url}`);
		const response = await axios.get(url);
		const itemText = response.data;
		console.log(`[tgx] got ${itemText.length} bytes`);

		const titleRegex = /<title>TGx:(.*)<\/title>/g;
		const hashRegex = /watercache\.nanobytes\.org\/get\/([a-f0-9]+)/g;
		// Total Size:</b></div><div class='tpcell'>3.96 GB</div>
		const sizeRegex = /Total Size:<\/b><\/div><div class='tpcell'>([^<]+)<\/div>/g;
		const imdbRegex = /www\.imdb\.com\/title\/(tt\d+)/g;

		const titleMatches = itemText.match(titleRegex);
		// console.log(`[tgx] titleMatches: ${titleMatches}`);
		const hashMatches = itemText.match(hashRegex);
		// console.log(`[tgx] hashMatches: ${hashMatches}`);
		const sizeMatches = itemText.match(sizeRegex);
		// console.log(`[tgx] sizeMatches: ${sizeMatches}`);
		const imdbMatches = itemText.match(imdbRegex);
		// if (titleMatches === null || hashMatches === null || sizeMatches === null || imdbMatches === null) {
		// 	console.log(`[tgx] failed to match ${url}`);
		// 	return null;
		// }
		// console.log(`[tgx] imdbMatches: ${imdbMatches}`);

		const title = titleMatches[0]
			.replace(/<\/?title>/g, '')
			.replace('TGx:', '')
			.trim();
		const hash = hashMatches[0]
			.replace('watercache.nanobytes.org/get/', '')
			.toLocaleLowerCase();
		const size = sizeMatches[0]
			.replace("Total Size:</b></div><div class='tpcell'>", '')
			.replace('</div>', '');
		const imdb = imdbMatches[0].replace('www.imdb.com/title/', '');

		return {
			title,
			hash,
			size,
			imdb,
		};
	} catch (e) {
		console.log(`[tgx] failed to process ${url} (${e})`);
		return null;
	}
}

function computeFileSize(size: string): number {
	const sizeMatch = size.match(/([\d.]+)\s([MGT])B/);
	if (!sizeMatch) {
		console.log(`[tgx] failed to match size ${size}`);
		return 0;
	}
	const num = parseFloat(sizeMatch[1]);
	const unit = sizeMatch[2];
	switch (unit) {
		case 'M':
			return num;
		case 'G':
			return num * 1024;
		case 'T':
			return num * 1024 * 1024;
		default:
			return 0;
	}
}
