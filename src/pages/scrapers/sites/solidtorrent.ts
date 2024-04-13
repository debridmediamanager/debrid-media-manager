import { ScrapeSearchResult } from '@/services/mediasearch';
import { meetsTitleConditions } from '@/utils/checks';
import axios from 'axios';

const hostname = process.env.SOLIDTORRENT ?? 'https://solidtorrent.to';

const createSearchUrl = (finalQuery: string) =>
	`${hostname}/search?q=${encodeURIComponent(
		finalQuery
	)}&category=1&subcat=2&limit=5000&sort=seeders`;

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
	while (true) {
		try {
			const response = await axios.get(searchUrl);
			responseData = response.data;
			break;
		} catch (error: any) {
			console.log('solidtorrent request error:', error.message, searchUrl);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return results;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	// get all titles from page by regex matching
	const titleMatches = Array.from(
		responseData.matchAll(/<h5 class="title w-100 truncate">.*?<a.*?>(.*?)<\/a>/gs)
	);
	const titles = titleMatches.map((match) => match[1]).map((title) => title.trim());

	// get all hashes from page by regex matching
	const hashMatches = Array.from(
		responseData.matchAll(/itorrents\.org\/torrent\/([A-Fa-f0-9]{40})\.torrent/g)
	);
	const hashes = hashMatches.map((match) => match[1]).map((hash) => hash.toLowerCase());

	// get all sizes from page by regex matching
	const sizeMatches = Array.from(
		responseData.matchAll(/<img[^>]*alt="Size"[^>]*>([\d,.]+\s*[KMGT]B)/gs)
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

	// combine titles and hashes into an array of objects
	results = titles
		.map((title, index) => ({
			title,
			fileSize: sizes[index],
			hash: hashes[index],
		}))
		.filter(({ title }) => meetsTitleConditions(targetTitle, years, title));

	console.log(`💪 SolidTorrent search returned ${results.length} for ${finalQuery}`);

	return results;
};

export async function scrapeSolidTorrent(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching SolidTorrent: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, years);
	} catch (error) {
		console.error('scrapeSolidTorrent page processing error', error);
	}
	return [];
}
