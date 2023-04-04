import getReleaseTags from '@/utils/score';
import { filenameParse } from '@ctrl/video-filename-parser';
import { NextApiRequest, NextApiResponse } from 'next';
import { Browser, ElementHandle } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

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

	const finalQuery = `${cleaned}${libraryType === 'does not matter' ? '' : ` ${libraryType}`}`;

	const browsersQty = process.env.BROWSERS_QTY ? parseInt(process.env.BROWSERS_QTY, 10) : 1;
	const randomNum = Math.floor(Math.random() * browsersQty);
	const browser = await puppeteer.connect({
		browserURL: `http://127.0.0.1:${9222 + randomNum}`,
	});

	try {
		let searchResultsArr = flattenAndRemoveDuplicates(
			await Promise.all<SearchResult[]>([
				fetchSearchResults(browser, '&order=0', finalQuery, libraryType),
				fetchSearchResults(browser, '&order=3', finalQuery, libraryType),
			])
		);
		if (searchResultsArr.length) searchResultsArr = groupByParsedTitle(searchResultsArr);

		res.status(200).json({ searchResults: searchResultsArr });
	} catch (error: any) {
		console.error(error);

		res.status(500).json({ errorMessage: 'An error occurred while scraping the Btdigg' });
	} finally {
		await browser.disconnect();
	}
}

async function fetchSearchResults(
	browser: Browser,
	searchType: string,
	finalQuery: string,
	libraryType?: string
): Promise<SearchResult[]> {
	const page = await browser.newPage();
	try {
		let pageNum = 0;

		// Navigate to the URL to be scraped
		const searchUrl = `http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion/search?q=${encodeURIComponent(
			finalQuery
		)}&p=${pageNum}${searchType}`;
		await page.goto(searchUrl, { waitUntil: 'networkidle0' });

		const IGNORED_THRESHOLD = 21; // 2 pages worth
		let ignoredResults = 0;
		let searchResultsArr: SearchResult[] = [];

		while (pageNum < 100) {
			console.log(`Scraping ${searchType} page ${pageNum + 1} (${finalQuery})...`);

			// Select all the search results on the current page
			const searchResults = await page.$$('.one_result');

			// Loop through each search result and extract the desired information
			for (const result of searchResults) {
				const title = await result.$eval('.torrent_name a', (node: any) =>
					node.textContent.trim()
				);
				// console.log(title);
				const fileSizeStr = await result.$eval('.torrent_size', (node: any) =>
					node.textContent.trim()
				);

				// Ignore results that don't have GB in fileSize
				if (libraryType !== 'does not matter' && !fileSizeStr.includes('GB')) {
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
				if (libraryType === 'does not matter' && !/1080p|2160p/.test(title.toLowerCase)) {
					ignoredResults++;
					continue;
				}

				const magnetLink = await result.$eval(
					'.torrent_magnet a',
					(node: any) => node.href
				);
				const hash = magnetLink.match(/xt=urn:btih:(.*?)&/)[1];

				const { dolby_vision, hdr10plus, hdr, remux, proper_remux, score } = getReleaseTags(
					title,
					fileSize
				);

				let resultObj: SearchResult = {
					title,
					fileSize,
					magnetLink,
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

			// Try to find the "Next →" link and click it to load the next page of results
			const nextPageLink = await page.$x("//a[contains(text(), 'Next →')]");
			if (nextPageLink.length > 0) {
				await (nextPageLink[0] as ElementHandle<Element>).click();
				pageNum++;
				await page.waitForNavigation({ waitUntil: 'networkidle0' });
			} else {
				// No more pages, exit the loop
				break;
			}
		}

		return searchResultsArr;
	} finally {
		await page.close();
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
