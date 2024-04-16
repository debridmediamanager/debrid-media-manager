import { ScrapeSearchResult } from '@/services/mediasearch';
import { meetsTitleConditions } from '@/utils/checks';
import axios from 'axios';

const hostname = process.env.RUTOR ?? 'https://rutor.info';

const createSearchUrl = (finalQuery: string, page: number) =>
	`${hostname}/search/${page}/0/000/0/${encodeURIComponent(finalQuery)}`;

const processPage = async (
	finalQuery: string,
	targetTitle: string,
	years: string[]
): Promise<ScrapeSearchResult[]> => {
	const MAX_RETRIES = 5; // maximum number of retries

	let results: ScrapeSearchResult[] = [];
	let retries = 0; // current number of retries
	let responseData = '';
	let page = 0;
	while (true) {
		let searchUrl = createSearchUrl(finalQuery, page);
		try {
			const response = await axios.get(searchUrl);
			responseData = responseData + response.data;
			const numResults = parseInt(
				response.data.match(/Результатов поиска (\d+)/)?.[1] ?? '0'
			);
			if ((page + 1) * 100 < numResults) {
				page++;
				continue;
			}
			break;
		} catch (error: any) {
			console.log('RuTor request error:', error.message, searchUrl);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return results;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	// get all titles from page by regex matching
	// <a href="/torrent/979167/kung-fu-panda-4_kung-fu-panda-4-2024-web-dl-1080p-ot-jaskier-p">Кунг-фу Панда 4 / Kung Fu Panda 4 (2024) WEB-DL 1080p от Jaskier | P </a>
	const titleMatches = Array.from(
		responseData.matchAll(/<a href="\/torrent\/\d+\/[^"]+">([^<]+)<\/a>/g)
	);
	const titles = titleMatches
		.map((match) => match[1])
		.map((title) => title.trim())
		.map((title) => {
			// should just be: Kung Fu Panda 4 (2024) WEB-DL 1080p от Jaskier, remove everything before the first / and after the first |
			const split = title.split('/');
			if (split.length > 1) {
				title = split[split.length - 1];
			}
			const split2 = title.split('|');
			if (split2.length > 1) {
				title = split2[0];
			}
			return title.trim();
		});
	// console.log('titles:', titles.length);

	// get all hashes from page by regex matching
	// magnet:?xt=urn:btih:526a100a89601c0762ad48adaf32be622adc2fa1
	const hashMatches = Array.from(
		responseData.matchAll(/magnet:\?xt=urn:btih:([A-Fa-f0-9]{40})/g)
	);
	const hashes = hashMatches.map((match) => match[1]).map((hash) => hash.toLowerCase());
	// console.log('hashes:', hashes.length);

	// get all sizes from page by regex matching
	// <td align="right">4.99&nbsp;GB</td>
	const sizeMatches = Array.from(
		responseData.matchAll(/<td align="right">([\d.,]+\&nbsp;[KMGT]B)<\/td>/g)
	);
	const sizes = sizeMatches
		.map((match) => match[1])
		.map((size) => {
			let [num, unit] = size.split('&');
			unit = unit.replace('nbsp;', '').trim();
			switch (unit) {
				case 'KB':
					return parseFloat(num) / 1024;
				case 'MB':
					return parseFloat(num);
				case 'GB':
					return parseFloat(num) * 1024;
				case 'TB':
					return parseFloat(num) * 1024 * 1024;
				default:
					return parseFloat(num);
			}
		});
	// console.log('sizes:', sizes.length);

	// combine titles and hashes into an array of objects
	results = titles
		.map((title, index) => ({
			title,
			fileSize: sizes[index],
			hash: hashes[index],
		}))
		.filter(({ title }) => meetsTitleConditions(targetTitle, years, title));

	console.log(`☭ RuTor search returned ${results.length} for ${finalQuery}`);

	return results;
};

export async function scrapeRuTor(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching RuTor: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, years);
	} catch (error) {
		console.error('scrapeRuTor page processing error', error);
	}
	return [];
}
