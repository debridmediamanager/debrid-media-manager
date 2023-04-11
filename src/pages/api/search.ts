import { cacheJsonValue, getCachedJsonValue } from '@/services/cache';
import { getMediaId } from '@/utils/mediaId';
import { getMediaType } from '@/utils/mediaType';
import getReleaseTags from '@/utils/score';
import { filenameParse, ParsedFilename } from '@ctrl/video-filename-parser';
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
	mediaType: 'tv' | 'movie';
	info: ParsedFilename;
};

export type BtDiggApiResult = {
	searchResults?: SearchResult[];
	errorMessage?: string;
};

const stopWords = [
	'the',
	'and',
	'be',
	'to',
	'of',
	'a',
	'in',
	'i',
	'it',
	'on',
	'he',
	'as',
	'do',
	'at',
	'by',
	'we',
	'or',
	'an',
	'my',
	'so',
	'up',
	'if',
	'me',
];

const agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
const dhtSearchHostname = 'http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion';

export default async function handler(req: NextApiRequest, res: NextApiResponse<BtDiggApiResult>) {
	const { search, libraryType } = req.query;

	if (!search || search instanceof Array) {
		res.status(400).json({ errorMessage: 'Missing "search" query parameter' });
		return;
	}

	if (!libraryType || libraryType instanceof Array) {
		res.status(400).json({ errorMessage: 'Missing "libraryType" query parameter' });
		return;
	}

	const cleaned = search
		.split(/[\s\.\-\(\)]/)
		.filter((e) => e !== '')
		.map((e) => e.toLowerCase())
		.filter((term) => !stopWords.includes(term))
		.join(' ')
		.replace(/[áàäâ]/g, 'a')
		.replace(/[éèëê]/g, 'e')
		.replace(/[íìïî]/g, 'i')
		.replace(/[óòöô]/g, 'o')
		.replace(/[úùüû]/g, 'u')
		.replace(/[ç]/g, 'c')
		.replace(/[ñ]/g, 'n')
		.replace(/[ş]/g, 's')
		.replace(/[ğ]/g, 'g')
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	const finalQuery = `${cleaned}${libraryType === '1080pOr2160p' ? '' : ` ${libraryType}`}`;

	const client = axios.create({
		httpAgent: agent,
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
		},
	});

	try {
		const cached = await getCachedJsonValue<SearchResult[]>(finalQuery.split(' '));
		if (cached) {
			res.status(200).json({ searchResults: cached });
			return;
		}

		let searchResultsArr = flattenAndRemoveDuplicates(
			await Promise.all<SearchResult[]>([
				fetchSearchResults(client, '&order=0', finalQuery, libraryType),
				fetchSearchResults(client, '&order=3', finalQuery, libraryType),
			])
		);
		if (searchResultsArr.length) searchResultsArr = groupByParsedTitle(searchResultsArr);

		// run async
		cacheJsonValue<SearchResult[]>(finalQuery.split(' '), searchResultsArr);

		res.status(200).json({ searchResults: searchResultsArr });
	} catch (error: any) {
		console.error(error);

		res.status(500).json({ errorMessage: 'An error occurred while scraping the Btdigg' });
	}
}

async function fetchSearchResults(
	client: AxiosInstance,
	searchType: string,
	finalQuery: string,
	libraryType?: string
): Promise<SearchResult[]> {
	try {
		let pageNum = 1;

		let searchUrl = (pg: number) =>
			`${dhtSearchHostname}/search?q=${encodeURIComponent(finalQuery)}&p=${
				pg - 1
			}${searchType}`;

		const BAD_RESULT_THRESHOLD = 21; // 2 pages worth
		let badResults = 0;
		let searchResultsArr: SearchResult[] = [];

		const MAX_RETRIES = 5; // maximum number of retries
		const RETRY_DELAY = 1000; // initial delay in ms, doubles with each retry

		let skippedResults = 0;

		while (pageNum <= 40 + Math.floor(skippedResults / 10)) {
			console.log(
				`Scraping ${searchType} page ${pageNum} (${finalQuery})...`,
				new Date().getTime()
			);
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
				if (mediaType === 'movie' && fileSize > 128) {
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
		const mediaId = getMediaId(result.info, result.mediaType);
		if (mediaId in frequency) {
			frequency[mediaId] += result.fileSize;
		} else {
			frequency[mediaId] = result.fileSize;
		}
	}

	results.sort((a, b) => {
		const frequencyCompare =
			frequency[getMediaId(b.info, b.mediaType)] - frequency[getMediaId(a.info, a.mediaType)];
		if (frequencyCompare === 0) {
			return b.fileSize - a.fileSize;
		}
		return frequencyCompare;
	});

	return results;
}
