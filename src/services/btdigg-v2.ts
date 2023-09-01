import { getMediaType } from '@/utils/mediaType';
import axios, { AxiosInstance } from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import UserAgent from 'user-agents';

const BTDIG = 'http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion';
// const BTDIG = 'http://btdig.com';

export type SearchResult = {
	title: string;
	fileSize: number;
	hash: string;
};

export const createAxiosInstance = (agent: SocksProxyAgent) => {
	return axios.create({
		httpAgent: BTDIG.endsWith('.onion') ? agent : undefined,
		headers: {
			accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'accept-language': 'en-US,en;q=0.5',
			'accept-encoding': 'gzip, deflate, br',
			referer: `${BTDIG}/`,
			connection: 'keep-alive',
			'sec-fetch-dest': 'document',
			'sec-fetch-mode': 'navigate',
			'sec-fetch-site': 'same-origin',
			'sec-fetch-user': '?1',
			'upgrade-insecure-requests': '1',
			'user-agent': new UserAgent().toString(),
		},
		timeout: parseInt(process.env.REQUEST_TIMEOUT || '3000', 10),
	});
};

export const flattenAndRemoveDuplicates = (arr: SearchResult[][]): SearchResult[] => {
	const flattened = arr.reduce((acc, val) => acc.concat(val), []);
	const unique = new Map<string, SearchResult>();
	flattened.forEach((item) => {
		if (!unique.has(item.hash)) {
			unique.set(item.hash, item);
		}
	});
	return Array.from(unique.values());
};

export const groupByParsedTitle = (results: SearchResult[]): SearchResult[] => {
	results.sort((a, b) => {
		return b.fileSize - a.fileSize;
	});
	return results;
};


function convertToMB(fileSizeStr: string) {
	let fileSize = parseFloat(fileSizeStr); // extracts the numeric part
	if (fileSizeStr.includes('GB')) {
		fileSize *= 1024; // if GB, convert to MB
	}
	return Math.round(fileSize); // returns the rounded integer value
}

const dhtSearchHostname = `${BTDIG}`;

export async function scrapeResults(
	client: AxiosInstance,
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: string[],
	libraryType: string
): Promise<SearchResult[]> {
	while (true) {
		try {
			let pageNum = 1;

			const createSearchUrl = (pg: number) =>
				`${dhtSearchHostname}/search?order=0&q=${encodeURIComponent(finalQuery)}&p=${pg - 1}`;

			const BAD_RESULT_THRESHOLD = 15;
			let badResults = 0;
			let searchResultsArr: SearchResult[] = [];

			const MAX_RETRIES = 5; // maximum number of retries
			const RETRY_DELAY = 1500; // initial delay in ms, doubles with each retry

			while (pageNum <= 100) {
				console.log(`Scraping page ${pageNum} (${finalQuery})...`, new Date().getTime());
				let retries = 0; // current number of retries
				let responseData = '';
				let numResults = 0;
				const searchUrl = createSearchUrl(pageNum);
				while (true) {
					try {
						const response = await client.get(searchUrl);
						responseData = response.data;
						const numResultsStr = responseData.match(/(\d+) results found/) || [];
						numResults = parseInt(numResultsStr[1], 10);
						retries = 0;
						break;
					} catch (error: any) {
						console.error(`Error scraping page ${pageNum} (${finalQuery})`, error.message);
						if (error.message.includes('status code 404') && pageNum === 1) {
							console.error('404 error, aborting search');
							throw error;
						}
						if (
							error.message.includes('status code 429') ||
							error.message.includes('"socket" was not created')
						) {
							console.log('Waiting 5 seconds before retrying...');
							await new Promise((resolve) => setTimeout(resolve, 5000));
						} else {
							retries++;
							if (retries > MAX_RETRIES) {
								console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
								throw error;
							}
						}
						const delay = RETRY_DELAY * Math.pow(2, retries - 1);
						await new Promise((resolve) => setTimeout(resolve, delay));
					}
				}
				const fileSizes = Array.from(
					responseData.matchAll(
						/class=\"torrent_size\"[^>]*>(\d+(?:\.\d+)?)(?:[^A-Z<]+)?([A-Z]+)?/g
					)
				);
				const namesAndHashes = Array.from(
					responseData.matchAll(/magnet:\?xt=urn:btih:([a-z\d]{40})&amp;dn=([^&]+)&/g)
				);

				if (fileSizes.length !== namesAndHashes.length) {
					console.warn('Mismatch in file sizes and names');
					break;
				}

				for (let resIndex = 0; resIndex < fileSizes.length; resIndex++) {
					console.log(`searchResultsArr:`, searchResultsArr.length)
					const title = decodeURIComponent(namesAndHashes[resIndex][2].replaceAll('+', ' '));
					const fileSizeStr = `${fileSizes[resIndex][1]} ${fileSizes[resIndex][2] || 'B'}`;

					if (
						!fileSizeStr.includes('GB') &&
						(libraryType === '2160p' || !fileSizeStr.includes('MB'))
					) {
						badResults++;
						continue;
					}

					// immediately check if filesize makes sense
					const fileSize = convertToMB(fileSizeStr);
					if (getMediaType(title) === 'movie' && fileSize > 150000) {
						badResults++; // movie is too big
						continue;
					}
					// if file size is too small, skip
					if (fileSizeStr.includes(' B') || fileSizeStr.includes(' KB')) {
						badResults++;
						continue;
					}

					// Check if every term in the query (tokenized by space) is contained in the title
					console.log(`scraped title`, title);
					const queryTerms = targetTitle.replaceAll('"', ' ').split(' ').filter((e) => e !== '');
					let requiredTerms =
						queryTerms.length <= 3 ? queryTerms.length : queryTerms.length - 1;
					const containedTerms = queryTerms.filter((term) =>
						new RegExp(`${term}`).test(title.toLowerCase())
					).length;
					console.log(`title >`, queryTerms);
					if (containedTerms < requiredTerms) {
						console.log('not enough terms!');
						badResults++; // title doesn't contain most terms in the query
						continue;
					}
					console.log(`must have >`, mustHaveTerms);
					const containedMustHaveTerms = queryTerms.filter((term) =>
						new RegExp(`${term}`).test(title.toLowerCase())
					).length;
					if (containedMustHaveTerms < mustHaveTerms.length) {
						console.log('not enough terms!');
						badResults++;
						continue;
					}
					if (
						!/\b360p|\b480p|\b576p|\b720p|\b1080p|\b2160p|dvd[^\w]?rip|dvd[^\w]?scr|\bx264\b|\bx265\b|\bxvid\b|\bdivx\b|\bav1\b|bd[^\w]?rip|br[^\w]?rip|hd[^\w]?rip|ppv[^\w]?rip|web[^\w]?rip|cam[^\w]?rip|\bcam\b|\bts\b|\bhdtc\b|\bscreener\b|\br5\b/i.test(
							title.toLowerCase()
						)
					) {
						badResults++; // doesn't contain video resolution fragments or clues in the title
						continue;
					}
					if (libraryType === '2160p') {
						if (!/\b2160p\b|\buhd\b/i.test(title.toLowerCase())) {
							continue;
						}
					}

					const hash = namesAndHashes[resIndex][1];

					let resultObj: SearchResult = {
						title,
						fileSize,
						hash,
					};
					searchResultsArr.push(resultObj);
					// Reset ignoredResults counter
					badResults = 0;
				}

				// Stop execution if the last $BAD_RESULT_THRESHOLD results were ignored
				if (badResults >= BAD_RESULT_THRESHOLD) {
					console.log(
						`Stopped execution after ${pageNum} pages because the last ${BAD_RESULT_THRESHOLD} results were ignored.`
					);
					break;
				}

				if (numResults > pageNum * 10) {
					pageNum++;
				} else {
					// No more pages, exit the loop
					break;
				}
			}

			console.log(`Found ${searchResultsArr.length} results (${finalQuery})`);

			return searchResultsArr;
		} catch (error) {
			console.error('fetchSearchResults page processing error', error);
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
	}
}
