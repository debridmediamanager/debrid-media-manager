import { meetsTitleConditions } from '@/utils/checks';
import axios from 'axios';
import { ScrapeSearchResult } from './mediasearch';

const hostname =
	process.env.SNOWFL ??
	'https://worker-wispy-sky-2cca.bensarmiento.workers.dev/?https://snowfl.com';

const createSearchUrl = (finalQuery: string, page: number, token: string) => {
	const randomStr = Array.from(Array(8), () => Math.random().toString(36)[2]).join('');
	const timeMs = Date.now();
	return `${hostname}/${token}/${encodeURIComponent(
		finalQuery
	)}/${randomStr}/${page}/SEED/NONE/1?_=${timeMs + page}`;
};

const getToken = async () => {
	const script = await axios.get(`${hostname}/b.min.js%3F${Date.now()}`);
	const token = script.data.match(/"([a-zA-Z0-9]+)";\$\(\(function\(\){var e,t,n,r,o,a,i=/)[1];
	return token ?? '';
};

const processPage = async (
	finalQuery: string,
	targetTitle: string,
	years: string[]
): Promise<ScrapeSearchResult[]> => {
	const MAX_RETRIES = 5; // maximum number of retries

	let results: ScrapeSearchResult[] = [];
	let retries = 0; // current number of retries
	let searchResults: any[] = [];
	let token = await getToken();
	let page = 0;
	while (true) {
		const searchUrl = createSearchUrl(finalQuery, page, token);
		try {
			const response = await axios.get(searchUrl);
			if (response.data.length > 0) {
				searchResults = searchResults.concat(response.data);
				page++;
				if (page > 10) {
					break;
				}
			} else {
				break;
			}
		} catch (error: any) {
			console.log('snowfl request error:', error.message, searchUrl);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return results;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	results = searchResults
		.map((result) => {
			const title = result.name.trim();
			const size = result.size;
			let fileSize = 0;
			const [num, unit] = size.split(' ');
			switch (unit) {
				case 'KB':
					fileSize = parseFloat(num) / 1024;
					break;
				case 'MB':
					fileSize = parseFloat(num);
					break;
				case 'GB':
					fileSize = parseFloat(num) * 1024;
					break;
				case 'TB':
					fileSize = parseFloat(num) * 1024 * 1024;
					break;
				default:
					fileSize = parseFloat(num);
			}
			const hash = result.magnet
				? (result.magnet.split('&')[0].split(':').pop() ?? '').toLowerCase()
				: '';
			return {
				title,
				fileSize,
				hash,
			};
		})
		.filter((result) => meetsTitleConditions(targetTitle, years, result.title) && result.hash);

	console.log(`🧊 SnowFL search returned ${results.length} for ${finalQuery}`);
	return results;
};

export async function scrapeSnowFL(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching SnowFL: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, years);
	} catch (error) {
		console.error('scrapeSnowFL page processing error', error);
	}
	return [];
}
