import { getMediaType } from '@/utils/mediaType';
import ProxyManager from '@/utils/proxyManager';
import axios from 'axios';
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

function convertToMB(fileSizeStr: string) {
	let fileSize = parseFloat(fileSizeStr); // extracts the numeric part
	if (fileSizeStr.includes('GB')) {
		fileSize *= 1024; // if GB, convert to MB
	}
	return Math.round(fileSize); // returns the rounded integer value
}

function isFoundDateRecent(foundString: string, date: string): boolean {
	const regex = /found\s(\d+)\s(years?|months?|weeks?|days?|hours?|minutes?|seconds?)\sago/;
	const match = foundString.match(regex);

	if (!match) {
		throw new Error('Invalid found string');
	}

	const value = parseInt(match[1]);
	const unit = match[2];

	// set found date to last possible moment of the unit
	const foundDate = new Date();
	switch (unit) {
		case 'years':
		case 'year':
			foundDate.setFullYear(foundDate.getFullYear() - value);
			break;
		case 'months':
		case 'month':
			foundDate.setMonth(foundDate.getMonth() - value);
			break;
		case 'weeks':
		case 'week':
			foundDate.setDate(foundDate.getDate() - 7 * value);
			break;
		case 'days':
		case 'day':
			foundDate.setDate(foundDate.getDate() - value);
			break;
		case 'hours':
		case 'hour':
			return true;
		case 'minutes':
		case 'minute':
			return true;
		case 'seconds':
		case 'second':
			return true;
		default:
			throw new Error('Invalid unit');
	}

	const airDate = new Date(date);

	// Return true if the found date is more recent or equal
	return foundDate >= airDate;
}

const createSearchUrl = (finalQuery: string, pg: number) =>
	`${BTDIG}/search?order=0&q=${encodeURIComponent(finalQuery)}&p=${pg - 1}`;

type ProcessPageResult = {
	results: ScrapeSearchResult[];
	badCount: number;
	numResults: number;
};

const processPage = async (
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: (string | RegExp)[],
	airDate: string,
	pageNum: number
): Promise<ProcessPageResult> => {
	const MAX_RETRIES = 5; // maximum number of retries

	let results: ScrapeSearchResult[] = [];
	let badCount = 0;
	let retries = 0; // current number of retries
	let responseData = '';
	let numResults = 0;
	const searchUrl = createSearchUrl(finalQuery, pageNum);
	let proxy = new ProxyManager();
	while (true) {
		try {
			const client = createAxiosInstance(proxy.getWorkingProxy());
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
				proxy.rerollProxy();
				// console.log('429 error, waiting for a bit longer before retrying...');
				console.log('Btdigg 429');
				retries++;
			} else if (error.message.includes('timeout of')) {
				// console.log('timeout, waiting for a bit longer before retrying...');
				console.log('Btdigg ⏱');
				retries++;
			} else {
				console.log('request error:', error.message);
				retries++;
				if (retries >= MAX_RETRIES) {
					console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
					return { results, badCount: MAX_RESULTS_PER_PAGE, numResults };
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}
	// console.log(
	// 	`${pageNum}/${calculateMaxPages(
	// 		numResults
	// 	)} : ${finalQuery}, ${targetTitle}, ${mustHaveTerms}`
	// );
	const fileSizes = Array.from(
		responseData.matchAll(/class=\"torrent_size\"[^>]*>(\d+(?:\.\d+)?)(?:[^A-Z<]+)?([A-Z]+)?/g)
	);
	const namesAndHashes = Array.from(
		responseData.matchAll(/magnet:\?xt=urn:btih:([a-z\d]{40})&amp;dn=([^&]+)&/g)
	);
	const ages = Array.from(responseData.matchAll(/class=\"torrent_age\"[^>]*>([^<]+)/g));

	if (fileSizes.length !== namesAndHashes.length || fileSizes.length !== ages.length) {
		console.warn('Mismatch in file sizes and names');
		return { results, badCount: MAX_RESULTS_PER_PAGE, numResults };
	}

	for (let resIndex = 0; resIndex < fileSizes.length; resIndex++) {
		const title = decodeURIComponent(namesAndHashes[resIndex][2].replaceAll('+', ' '));
		const fileSizeStr = `${fileSizes[resIndex][1]} ${fileSizes[resIndex][2] || 'B'}`;

		if (!fileSizeStr.includes('GB') && !fileSizeStr.includes('MB')) {
			badCount++;
			continue;
		}

		const fileSize = convertToMB(fileSizeStr);
		if (getMediaType(title) === 'movie' && fileSize > 200000) {
			badCount++; // movie is too big
			continue;
		}
		if (fileSizeStr.includes(' B') || fileSizeStr.includes(' KB')) {
			badCount++;
			continue;
		}

		if (!isFoundDateRecent(ages[resIndex][1], airDate)) {
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
			new RegExp(`${term.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(title)
		).length;
		if (containedTerms < requiredTerms) {
			// console.debug(title, '-title match-', targetTitle);
			// console.debug('bad title', containedTerms, requiredTerms);
			badCount++; // title doesn't contain most terms in the query
			continue;
		}
		const containedMustHaveTerms = mustHaveTerms.filter((term) => {
			if (typeof term === 'string') {
				return new RegExp(`${term}`, 'i').test(title);
			} else if (term instanceof RegExp) {
				return term.test(title);
			}
			return false;
		}).length;
		if (containedMustHaveTerms < mustHaveTerms.length) {
			// console.debug(title, '-must have-', mustHaveTerms);
			// console.debug('bad must have terms', containedMustHaveTerms, mustHaveTerms.length);
			badCount++;
			continue;
		}
		if (!targetTitle.match(/xxx/i)) {
			if (title.match(/xxx/i)) {
				badCount++;
				continue;
			}
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
	title: string,
	promises: (() => Promise<ProcessPageResult>)[],
	batchSize: number
): Promise<ScrapeSearchResult[]> {
	let searchResultsArr: ScrapeSearchResult[] = [];
	let i = 0;
	let lastPrintedIndex = 0;
	while (i < promises.length) {
		let percentageIncrease = ((i - lastPrintedIndex) / promises.length) * 100;
		if (percentageIncrease >= 10) {
			console.log(`🌃 Btdigg batch ${i}/${promises.length}:${title}`);
			lastPrintedIndex = i;
		}
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
	console.log(`🌃 Btdigg done! ${title}`);
	return searchResultsArr;
}

export async function scrapeBtdigg(
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: (string | RegExp)[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	let searchResultsArr: ScrapeSearchResult[] = [];
	while (true) {
		console.log(`🔍 Searching Btdigg: ${finalQuery}`);
		try {
			let pageNum = 1;
			const { results, numResults } = await processPage(
				finalQuery,
				targetTitle,
				mustHaveTerms,
				airDate,
				pageNum++
			);
			console.log(`🌃 Btdigg search returned ${numResults} for ${finalQuery}`);
			searchResultsArr.push(...results);
			const maxPages = calculateMaxPages(numResults);
			let promises: (() => Promise<ProcessPageResult>)[] = [];
			while (pageNum <= maxPages) {
				promises.push(
					((pageNum) => async () => {
						return await processPage(
							finalQuery,
							targetTitle,
							mustHaveTerms,
							airDate,
							pageNum
						);
					})(pageNum)
				);
				pageNum++;
			}
			searchResultsArr.push(...(await processInBatches(finalQuery, promises, 5)));
		} catch (error) {
			console.error('scrapeBtdigg page processing error', error);
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
		// mkv
		try {
			let pageNum = 1;
			const { results, numResults } = await processPage(
				`${finalQuery} .mkv`,
				targetTitle,
				mustHaveTerms,
				airDate,
				pageNum++
			);
			searchResultsArr.push(...results);
			const maxPages = calculateMaxPages(numResults);
			let promises: (() => Promise<ProcessPageResult>)[] = [];
			while (pageNum <= maxPages) {
				promises.push(
					((pageNum) => async () => {
						return await processPage(
							`${finalQuery} .mkv`,
							targetTitle,
							mustHaveTerms,
							airDate,
							pageNum
						);
					})(pageNum)
				);
				pageNum++;
			}
			searchResultsArr.push(...(await processInBatches(`${finalQuery} .mkv`, promises, 5)));
		} catch (error) {
			console.error('scrapeBtdigg mkv page processing error', error);
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
		// mp4
		try {
			let pageNum = 1;
			const { results, numResults } = await processPage(
				`${finalQuery} .mp4`,
				targetTitle,
				mustHaveTerms,
				airDate,
				pageNum++
			);
			searchResultsArr.push(...results);
			const maxPages = calculateMaxPages(numResults);
			let promises: (() => Promise<ProcessPageResult>)[] = [];
			while (pageNum <= maxPages) {
				promises.push(
					((pageNum) => async () => {
						return await processPage(
							`${finalQuery} .mp4`,
							targetTitle,
							mustHaveTerms,
							airDate,
							pageNum
						);
					})(pageNum)
				);
				pageNum++;
			}
			searchResultsArr.push(...(await processInBatches(`${finalQuery} .mp4`, promises, 5)));
		} catch (error) {
			console.error('scrapeBtdigg mp4 page processing error', error);
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
		return searchResultsArr;
	}
}
