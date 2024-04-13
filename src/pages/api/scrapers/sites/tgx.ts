import { ScrapeSearchResult } from '@/services/mediasearch';
import { meetsTitleConditions } from '@/utils/checks';
import axios from 'axios';

const hostname = process.env.TGX ?? 'https://tgx.rs';

const createSearchUrl = (finalQuery: string) =>
	`${hostname}/torrents.php?search=${encodeURIComponent(finalQuery)}`;

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
			console.log('TorrentGalaxy request error:', error.message, searchUrl);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return results;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	// get all titles from page by regex matching
	// <span src="torrent"><b>Kung Fu Panda 4 2024 1080p WEBRip DS4K AV1 Opus 5.1 [dAV1nci]</b></span>
	const titleMatches = Array.from(
		responseData.matchAll(/<span src='torrent'><b>(.*?)<\/b><\/span>/gs)
	);
	const titles = titleMatches.map((match) => match[1]).map((title) => title.trim());
	// console.log('titles:', titles.length);

	// get all hashes from page by regex matching
	// magnet:?xt=urn:btih:465250e909ddc663476ed1fa9ae5cc2b65989d5d
	const hashMatches = Array.from(
		responseData.matchAll(/magnet:\?xt=urn:btih:([A-Fa-f0-9]{40})/g)
	);
	const hashes = hashMatches.map((match) => match[1]).map((hash) => hash.toLowerCase());
	// console.log('hashes:', hashes.length);

	// get all sizes from page by regex matching
	// <div class="tgxtablecell collapsehide rounded txlight" style="text-align:right;"><span class="badge badge-secondary txlight" style="border-radius:4px;">1.31 GB</span></div>
	const sizeMatches = Array.from(
		responseData.matchAll(
			/<span class='badge badge-secondary txlight' style='border-radius:4px;'>([\d,.]+\s*[KMGT]B)<\/span>/gs
		)
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
	// console.log('sizes:', sizes.length);

	// combine titles and hashes into an array of objects
	results = titles
		.map((title, index) => ({
			title,
			fileSize: sizes[index],
			hash: hashes[index],
		}))
		.filter(({ title }) => meetsTitleConditions(targetTitle, years, title));

	console.log(`🚀🪐🌕🌑☄️🛸 TorrentGalaxy search returned ${results.length} for ${finalQuery}`);

	return results;
};

export async function scrapeTorrentGalaxy(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching TorrentGalaxy: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, years);
	} catch (error) {
		console.error('scrapeTorrentGalaxy page processing error', error);
	}
	return [];
}
