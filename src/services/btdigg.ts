import { getMediaId } from '@/utils/mediaId';
import { getMediaType } from '@/utils/mediaType';
import getReleaseTags from '@/utils/score';
import { filenameParse, ParsedFilename } from '@ctrl/video-filename-parser';
import axios, { AxiosInstance } from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { PlanetScaleCache } from './planetscale';
import UserAgent from 'user-agents';

export type SearchResult = {
	title: string;
	fileSize: number;
	magnetLink: string;
	hash: string;
	dolby_vision: boolean;
	hdr10plus: boolean;
	hdr: boolean;
	remux: boolean;
	proper_remux: boolean;
	score: number;
	mediaType: 'tv' | 'movie';
	info: ParsedFilename;
};

const cache = new PlanetScaleCache();

export const createAxiosInstance = (agent: SocksProxyAgent) => {
	return axios.create({
		httpAgent: agent,
		headers: {
			accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'accept-language': 'en-US,en;q=0.5',
			'accept-encoding': 'gzip, deflate, br',
			referer: 'http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion/',
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
	const frequency: Record<string, number> = {};
	for (const result of results) {
		const mediaId = getMediaId(result.info, result.mediaType, true);
		if (mediaId in frequency) {
			frequency[mediaId] += result.fileSize;
		} else {
			frequency[mediaId] = result.fileSize;
		}
	}

	results.sort((a, b) => {
		const frequencyCompare =
			frequency[getMediaId(b.info, b.mediaType, true)] -
			frequency[getMediaId(a.info, a.mediaType, true)];
		if (frequencyCompare === 0) {
			return b.fileSize - a.fileSize;
		}
		return frequencyCompare;
	});

	return results;
};

const dhtSearchHostname = 'http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion';

export type searchSpeedType =
	| 'veryfast'
	| 'fast'
	| 'normal'
	| 'normaloverride'
	| 'slow'
	| 'slowoverride'
	| 'veryslow'
	| 'veryslowoverride';

export async function fetchSearchResults(
	speed: searchSpeedType,
	client: AxiosInstance,
	searchQuery: string,
	libraryType: string
): Promise<SearchResult[]> {
	try {
		const finalQuery = `${searchQuery}${
			!libraryType || libraryType === '1080pOr2160p' ? '' : ` ${libraryType}`
		}`;

		try {
			if (!speed.includes('override')) {
				const cached = await cache.getCachedJsonValue<SearchResult[]>(
					finalQuery.split(' ')
				);
				if (cached) {
					return cached;
				}
			}
		} catch (e: any) {
			console.warn(e);
		}

		let pageNum = 1;

		const createSearchUrl = (pg: number) =>
			`${dhtSearchHostname}/search?q=${encodeURIComponent(finalQuery)}&p=${pg - 1}`;

		const BAD_RESULT_THRESHOLD = 11;
		let badResults = 0;
		let searchResultsArr: SearchResult[] = [];

		const MAX_RETRIES = 5; // maximum number of retries
		const RETRY_DELAY = 1500; // initial delay in ms, doubles with each retry

		let upperThreshold: (skipped: number) => number;

		switch (speed) {
			case 'veryfast':
				upperThreshold = (skipped: number): number => 20 + Math.floor(skipped / 10);
				break;
			case 'fast':
				upperThreshold = (skipped: number): number => 40 + Math.floor(skipped / 10);
				break;
			case 'normal':
			case 'normaloverride':
				upperThreshold = (skipped: number): number => 60 + Math.floor(skipped / 10);
				break;
			case 'slow':
			case 'slowoverride':
				upperThreshold = (skipped: number): number => 80 + Math.floor(skipped / 10);
				break;
			case 'veryslow':
			case 'veryslowoverride':
				upperThreshold = (_: any) => 100;
				break;
		}

		let skippedResults = 0;
		while (pageNum <= upperThreshold(skippedResults)) {
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
					if (error.message.includes('status code 429') || error.message.includes('"socket" was not created')) {
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
			console.log(
				`Scrape successful for page ${pageNum} (${finalQuery})`,
				new Date().getTime()
			);
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
				const title = decodeURIComponent(namesAndHashes[resIndex][2].replaceAll('+', ' '));
				const fileSizeStr = `${fileSizes[resIndex][1]} ${fileSizes[resIndex][2] || 'B'}`;
				const mediaType = getMediaType(title);
				const info =
					mediaType === 'movie' ? filenameParse(title) : filenameParse(title, true);

				// Ignore results that don't have GB in fileSize
				if (libraryType !== '1080pOr2160p' && !fileSizeStr.includes('GB')) {
					badResults++;
					continue;
				}

				// immediately check if filesize makes sense
				const fileSize = parseFloat(fileSizeStr);
				if (mediaType === 'movie' && fileSize > 150) {
					skippedResults++;
					continue;
				}

				// Check if every term in the query (tokenized by space) is contained in the title
				const queryTerms = finalQuery.split(' ');
				const containsAllTerms = queryTerms.every((term) =>
					new RegExp(`\\b${term}`).test(title.toLowerCase())
				);
				if (!containsAllTerms) {
					badResults++;
					continue;
				}
				if (libraryType === '1080pOr2160p' && !/1080p|2160p/i.test(title.toLowerCase())) {
					badResults++;
					continue;
				}

				const hash = namesAndHashes[resIndex][1];

				const { dolby_vision, hdr10plus, hdr, remux, proper_remux, score } = getReleaseTags(
					title,
					fileSize
				);

				let resultObj: SearchResult = {
					title,
					fileSize,
					magnetLink: `magnet:?xt=urn:btih:${hash}`,
					hash,
					dolby_vision,
					hdr10plus,
					hdr,
					remux,
					proper_remux,
					score,
					mediaType,
					info,
				};
				searchResultsArr.push(resultObj);
				// Reset ignoredResults counter
				badResults = 0;
			}

			// Stop execution if the last 5 results were ignored
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

		cache.cacheJsonValue(finalQuery.split(' '), searchResultsArr);

		return searchResultsArr;
	} catch (error) {
		console.error('fetchSearchResults page processing error', error);
		throw error;
	}
}
