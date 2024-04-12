import { meetsTitleConditions } from '@/utils/checks';
import axios from 'axios';
import { ScrapeSearchResult } from './mediasearch';

const hostname = process.env.TGX ?? 'https://gtso.cc';

const createSearchUrl = (finalQuery: string) =>
	`${hostname}/search_results.php?cat=1,41,71,72&search=${encodeURIComponent(
		finalQuery
	)}&incldead=1&inclexternal=0&lang=0&sort=id&order=desc`;

const processPage = async (
	finalQuery: string,
	targetTitle: string,
	years: string[]
): Promise<ScrapeSearchResult[]> => {
	const MAX_RETRIES = 5; // maximum number of retries

	let results: ScrapeSearchResult[] = [];
	let retries = 0; // current number of retries
	let responseData = '';
	const searchUrl = createSearchUrl(finalQuery);
	let page = 0;
	while (true) {
		try {
			const response = await axios.get(searchUrl);
			responseData = responseData + response.data;
			if (response.data.includes('NEXT&nbsp;»')) {
				page++;
				continue;
			}
			break;
		} catch (error: any) {
			console.log('GloTorrents request error:', error.message, searchUrl);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return results;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	// get all titles from page by regex matching
	// <a title="Avatar.The.Last.Airbender.2024.S01.1080p.x265-AMBER" href
	const titleMatches = Array.from(responseData.matchAll(/<a title="(.*?)" href/g));
	const titles = titleMatches.map((match) => match[1]).map((title) => title.trim());
	console.log('titles:', titles.length);

	// get all hashes from page by regex matching
	// magnet:?xt=urn:btih:465250e909ddc663476ed1fa9ae5cc2b65989d5d
	const hashMatches = Array.from(
		responseData.matchAll(/magnet:\?xt=urn:btih:([A-Fa-f0-9]{40})/g)
	);
	const hashes = hashMatches.map((match) => match[1]).map((hash) => hash.toLowerCase());
	console.log('hashes:', hashes.length);

	// get all sizes from page by regex matching
	// <td class="ttable_col1" align="center">6.43 GB</td>
	const sizeMatches = Array.from(
		responseData.matchAll(/<td class='ttable_col1' align='center'>([\d,.]+\s*[KMGT]B)<\/td>/g)
	);
	const sizes = sizeMatches
		.map((match) => match[1])
		.map((size) => {
			const [num, unit] = size.split(' ');
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
	console.log('sizes:', sizes.length);

	// combine titles and hashes into an array of objects
	results = titles
		.map((title, index) => ({
			title,
			fileSize: sizes[index],
			hash: hashes[index],
		}))
		.filter(({ title }) => meetsTitleConditions(targetTitle, years, title));

	console.log(`🚀🪐🌕🌑☄️🛸 GloTorrents search returned ${results.length} for ${finalQuery}`);

	return results;
};

export async function scrapeGloTorrents(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching GloTorrents: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, years);
	} catch (error) {
		console.error('scrapeGloTorrents page processing error', error);
	}
	return [];
}
