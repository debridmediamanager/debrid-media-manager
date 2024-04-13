import { ScrapeSearchResult } from '@/services/mediasearch';
import { meetsTitleConditions } from '@/utils/checks';
import axios from 'axios';

const hostname = `https://apibay.org`;

const createSearchUrl = (finalQuery: string) =>
	`${hostname}/q.php?q=${encodeURIComponent(finalQuery)}`;

const processPage = async (
	finalQuery: string,
	targetTitle: string,
	years: string[]
): Promise<ScrapeSearchResult[]> => {
	const MAX_RETRIES = 5; // maximum number of retries

	let results: ScrapeSearchResult[] = [];
	let retries = 0; // current number of retries
	let searchResults: any[] = [];
	while (true) {
		const searchUrl = createSearchUrl(finalQuery);
		try {
			const response = await axios.get(searchUrl);
			if (response.data.length > 0) {
				searchResults = response.data;
			}
			break;
		} catch (error: any) {
			console.log('ApiBay request error:', error.message, searchUrl);
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
			const fileSize = parseFloat(result.size) / 1024 / 1024;
			const hash = result.info_hash.toLowerCase();
			return {
				title,
				fileSize,
				hash,
			};
		})
		.filter((result) => meetsTitleConditions(targetTitle, years, result.title));

	console.log(`🏴‍☠️🦜 ApiBay search returned ${results.length} for ${finalQuery}`);
	return results;
};

export async function scrapeApiBay2(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching ApiBay: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, years);
	} catch (error) {
		console.error('scrapeApiBay2 page processing error', error);
	}
	return [];
}
