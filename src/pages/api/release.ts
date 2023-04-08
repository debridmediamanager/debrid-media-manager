import getReleaseTags from '@/utils/score';
import { filenameParse } from '@ctrl/video-filename-parser';
import axios, { AxiosInstance } from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import { SocksProxyAgent } from 'socks-proxy-agent';

type SearchResult = {
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
};

export type BtDiggApiResult = {
	searchResults?: SearchResult[];
	errorMessage?: string;
};

const agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function handler(req: NextApiRequest, res: NextApiResponse<BtDiggApiResult>) {
	const { name } = req.query;

	if (!name || name instanceof Array) {
		res.status(400).json({ errorMessage: 'Missing "name" query parameter' });
		return;
	}

	const finalQuery = `${name}`;

	const client = axios.create({
		httpAgent: agent,
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
		},
	});

	try {
		let searchResultsArr = flattenAndRemoveDuplicates(
			await Promise.all<SearchResult[]>([
				fetchSearchResults(client, '&order=0', finalQuery),
				fetchSearchResults(client, '&order=3', finalQuery),
			])
		);
		if (searchResultsArr.length) searchResultsArr = groupByParsedTitle(searchResultsArr);

		res.status(200).json({ searchResults: searchResultsArr });
	} catch (error: any) {
		console.error(error);

		res.status(500).json({ errorMessage: 'An error occurred while scraping the Btdigg' });
	}
}

async function fetchSearchResults(
	client: AxiosInstance,
	searchType: string,
	finalQuery: string
): Promise<SearchResult[]> {
	try {
		let pageNum = 1;

		let searchUrl = (pg: number) =>
			`http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion/search?q=${encodeURIComponent(
				finalQuery
			)}&p=${pg - 1}${searchType}`;

		const IGNORED_THRESHOLD = 21; // 2 pages worth
		let ignoredResults = 0;
		let searchResultsArr: SearchResult[] = [];

		const MAX_RETRIES = 5; // maximum number of retries
		const RETRY_DELAY = 1000; // initial delay in ms, doubles with each retry

		while (pageNum <= 100) {
			console.log(`Scraping ${searchType} page ${pageNum} (${finalQuery})...`);
			let retries = 0; // current number of retries
			let responseData = '';
			let numResults = 0;
			while (true) {
				try {
					const response = await client.get(searchUrl(pageNum), { httpAgent: agent });
					responseData = response.data;
					const numResultsStr = responseData.match(/(\d+) results found/) || [];
					numResults = parseInt(numResultsStr[1], 10);
					retries = 0;
					break;
				} catch (error) {
					retries++;
					if (retries > MAX_RETRIES) {
						console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
						break;
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
				throw new Error('parsing error');
			}

			for (let resIndex = 0; resIndex < fileSizes.length; resIndex++) {
				const title = decodeURIComponent(namesAndHashes[resIndex][2].replaceAll('+', ' '));
				const fileSizeStr = `${fileSizes[resIndex][1]} ${fileSizes[resIndex][2] || 'B'}`;

				// Ignore results that don't have GB in fileSize
				if (!fileSizeStr.includes('GB')) {
					ignoredResults++;
					continue;
				}

				// immediately check if filesize makes sense
				const fileSize = parseFloat(fileSizeStr);
				if (!/\bs\d\d|season/i.test(title) && fileSize > 128) {
					continue;
				}

				// Check if every term in the query (tokenized by space) is contained in the title
				const queryTerms = finalQuery.split(' ');
				const containsAllTerms = queryTerms.every((term) =>
					new RegExp(`\\b${term}`).test(title.toLowerCase())
				);
				if (!containsAllTerms) {
					ignoredResults++;
					continue;
				}
				if (!/1080p|2160p/.test(title.toLowerCase())) {
					ignoredResults++;
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
				};
				searchResultsArr.push(resultObj);
				// Reset ignoredResults counter
				ignoredResults = 0;
			}

			// Stop execution if the last 5 results were ignored
			if (ignoredResults >= IGNORED_THRESHOLD) {
				console.log(
					`Stopped execution after ${pageNum} pages because the last ${IGNORED_THRESHOLD} results were ignored.`
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
		console.error(error);
		throw error;
	}
}

function flattenAndRemoveDuplicates(arr: SearchResult[][]): SearchResult[] {
	const flattened = arr.reduce((acc, val) => acc.concat(val), []);
	const unique = new Map<string, SearchResult>();
	flattened.forEach((item) => {
		if (!unique.has(item.hash)) {
			unique.set(item.hash, item);
		}
	});
	return Array.from(unique.values());
}

function groupByParsedTitle(results: SearchResult[]): SearchResult[] {
	const frequency: Record<string, number> = {};
	for (const result of results) {
		const properTitle = filenameParse(result.title).title.toLocaleLowerCase();
		if (properTitle in frequency) {
			frequency[properTitle]++;
		} else {
			frequency[properTitle] = 1;
		}
	}

	results.sort((a, b) => {
		const frequencyCompare =
			frequency[filenameParse(b.title).title.toLocaleLowerCase()] -
			frequency[filenameParse(a.title).title.toLocaleLowerCase()];
		if (frequencyCompare === 0) {
			return b.fileSize - a.fileSize;
		}
		return frequencyCompare;
	});

	return results;
}
