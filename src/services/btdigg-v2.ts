import { getMediaType } from '@/utils/mediaType';
import axios, { AxiosInstance } from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import UserAgent from 'user-agents';
import { ScrapeSearchResult } from './mediasearch';

const BTDIG = 'http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion';
// const BTDIG = 'https://en.btdig.com';
const MAX_RESULTS_PER_PAGE = 10;
const BAD_RESULT_THRESHOLD = 20;

export const createAxiosInstance = (agent: SocksProxyAgent) => {
	return axios.create({
		httpAgent: BTDIG.startsWith('http://') ? agent : undefined,
		// httpsAgent: BTDIG.startsWith('https://') ? agent : undefined,
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

export const flattenAndRemoveDuplicates = (arr: ScrapeSearchResult[][]): ScrapeSearchResult[] => {
	const flattened = arr.reduce((acc, val) => acc.concat(val), []);
	const unique = new Map<string, ScrapeSearchResult>();
	flattened.forEach((item) => {
		if (!unique.has(item.hash)) {
			unique.set(item.hash, item);
		}
	});
	return Array.from(unique.values());
};

export const groupByParsedTitle = (results: ScrapeSearchResult[]): ScrapeSearchResult[] => {
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

const createSearchUrl = (finalQuery: string, pg: number) =>
	`${BTDIG}/search?order=0&q=${encodeURIComponent(finalQuery)}&p=${pg - 1}`;

type ProcessPageResult = {
	results: ScrapeSearchResult[];
	badCount: number;
	numResults: number;
};

const processPage = async (
	client: AxiosInstance,
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: string[],
	is2160p: boolean,
	pageNum: number
): Promise<ProcessPageResult> => {
	const MAX_RETRIES = 5; // maximum number of retries
	const RETRY_DELAY = 1500; // initial delay in ms, doubles with each retry

	let results: ScrapeSearchResult[] = [];
	let badCount = 0;
	let retries = 0; // current number of retries
	let responseData = '';
	let numResults = 0;
	const searchUrl = createSearchUrl(finalQuery, pageNum);
	while (true) {
		try {
			const response = await client.get(searchUrl);
			responseData = response.data;
			const numResultsStr = responseData.match(/(\d+) results found/) || [];
			numResults = parseInt(numResultsStr[1], 10);
			retries = 0;
			break;
		} catch (error: any) {
			if (error.message.includes('status code 404') && pageNum === 1) {
				console.error('404 error, aborting search');
				return { results, badCount: MAX_RESULTS_PER_PAGE, numResults };
			} else if (
				error.message.includes('status code 429') ||
				error.message.includes('"socket" was not created')
			) {
				console.log('waiting an extra 10 seconds before retrying...');
				await new Promise((resolve) => setTimeout(resolve, 10000));
			} else {
				console.log('request error:', error.message);
				retries++;
				if (retries > MAX_RETRIES) {
					console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
					return { results, badCount: MAX_RESULTS_PER_PAGE, numResults };
				}
			}
			const delay = RETRY_DELAY * Math.pow(2, retries - 1);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
	console.log(
		`${pageNum}/${calculateMaxPages(
			numResults
		)} : ${finalQuery}, ${targetTitle}, ${mustHaveTerms}`
	);
	const fileSizes = Array.from(
		responseData.matchAll(/class=\"torrent_size\"[^>]*>(\d+(?:\.\d+)?)(?:[^A-Z<]+)?([A-Z]+)?/g)
	);
	const namesAndHashes = Array.from(
		responseData.matchAll(/magnet:\?xt=urn:btih:([a-z\d]{40})&amp;dn=([^&]+)&/g)
	);

	if (fileSizes.length !== namesAndHashes.length) {
		console.warn('Mismatch in file sizes and names');
		return { results, badCount: MAX_RESULTS_PER_PAGE, numResults };
	}

	for (let resIndex = 0; resIndex < fileSizes.length; resIndex++) {
		const title = decodeURIComponent(namesAndHashes[resIndex][2].replaceAll('+', ' '));
		const fileSizeStr = `${fileSizes[resIndex][1]} ${fileSizes[resIndex][2] || 'B'}`;

		if (!fileSizeStr.includes('GB') && (is2160p || !fileSizeStr.includes('MB'))) {
			badCount++;
			continue;
		}

		// immediately check if filesize makes sense
		const fileSize = convertToMB(fileSizeStr);
		if (getMediaType(title) === 'movie' && fileSize > 150000) {
			badCount++; // movie is too big
			continue;
		}
		// if file size is too small, skip
		if (fileSizeStr.includes(' B') || fileSizeStr.includes(' KB')) {
			badCount++;
			continue;
		}

		// Check if every term in the query (tokenized by space) is contained in the title
		const queryTerms = targetTitle
			.replaceAll('"', ' ')
			.split(' ')
			.filter((e) => e !== '');
		let requiredTerms = queryTerms.length <= 3 ? queryTerms.length : queryTerms.length - 1;
		const containedTerms = queryTerms.filter((term) =>
			new RegExp(`${term.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&')}`).test(title.toLowerCase())
		).length;
		if (containedTerms < requiredTerms) {
			badCount++; // title doesn't contain most terms in the query
			continue;
		}
		const containedMustHaveTerms = mustHaveTerms.filter((term) =>
			new RegExp(`${term}`).test(title.toLowerCase())
		).length;
		if (containedMustHaveTerms < mustHaveTerms.length) {
			badCount++;
			continue;
		}
		if (is2160p && !/\b2160p\b|\buhd\b/i.test(title.toLowerCase())) {
			continue;
		}

		const hash = namesAndHashes[resIndex][1];

		let resultObj = {
			title,
			fileSize,
			hash,
		};
		results.push(resultObj);
	}

	return { results, badCount, numResults };
};

function calculateMaxPages(
	numResults: number,
	resultsPerPage: number = 10,
	maxPageNum: number = 100
): number {
	let totalPages = Math.ceil(numResults / resultsPerPage);
	return totalPages > maxPageNum ? maxPageNum : totalPages;
}

async function processInBatches(
	promises: (() => Promise<ProcessPageResult>)[],
	batchSize: number
): Promise<ScrapeSearchResult[]> {
	let searchResultsArr: ScrapeSearchResult[] = [];
	let i = 0;
	while (i < promises.length) {
		let totalBadCount = 0;
		const promisesResults = await Promise.all(
			promises.slice(i, i + batchSize).map(async (e) => await e())
		);
		const results = promisesResults.reduce(
			(acc: ScrapeSearchResult[], val: ProcessPageResult) => acc.concat(val.results),
			[]
		);
		totalBadCount = promisesResults.reduce(
			(acc: number, val: ProcessPageResult) => (acc += val.badCount),
			totalBadCount
		);
		searchResultsArr.push(...results);
		i += batchSize;
		if (totalBadCount >= BAD_RESULT_THRESHOLD) {
			break;
		}
	}
	return searchResultsArr;
}

export async function scrapeResults(
	client: AxiosInstance,
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: string[],
	is2160p: boolean = false
): Promise<ScrapeSearchResult[]> {
	let searchResultsArr: ScrapeSearchResult[] = [];
	while (true) {
		console.log(`fetching search results for: ${finalQuery}`);
		try {
			let pageNum = 1;
			const { results, numResults } = await processPage(
				client,
				finalQuery,
				targetTitle,
				mustHaveTerms,
				is2160p,
				pageNum++
			);
			searchResultsArr.push(...results);
			const maxPages = calculateMaxPages(numResults);
			let promises: (() => Promise<ProcessPageResult>)[] = [];
			while (pageNum <= maxPages) {
				promises.push(
					((pageNum) => async () => {
						return await processPage(
							client,
							finalQuery,
							targetTitle,
							mustHaveTerms,
							is2160p,
							pageNum
						);
					})(pageNum)
				);
				pageNum++;
			}
			searchResultsArr.push(...(await processInBatches(promises, 2)));
		} catch (error) {
			console.error('fetchSearchResults page processing error', error);
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
		return searchResultsArr;
	}
}
