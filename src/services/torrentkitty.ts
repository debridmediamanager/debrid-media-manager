import { meetsTitleConditions } from '@/utils/checks';
import axios from 'axios';
import { ScrapeSearchResult } from './mediasearch';

const tkHost = process.env.TORRENTKITTY ?? 'https://www.torrentkitty.ink';

function isFoundDateRecent(foundString: string, date: string): boolean {
	// 2016-04-10
	const foundDate = new Date(foundString);
	const airDate = new Date(date);
	// Return true if the found date is more recent or equal
	return foundDate >= airDate;
}

const createSearchUrl = (finalQuery: string) =>
	`${tkHost}/search/${encodeURIComponent(finalQuery)}/`;

async function processItem(
	item: TitleAndHash,
	airDate: string
): Promise<ScrapeSearchResult | undefined> {
	const MAX_RETRIES = 5; // maximum number of retries

	let retries = 0; // current number of retries
	let responseData = '';
	while (true) {
		try {
			const response = await axios.get(`${tkHost}/information/${item.hash}`, {
				timeout: 60000,
			});
			responseData = response.data;
			break;
		} catch (error: any) {
			console.log('request error:', error.message, `${tkHost}/information/${item.hash}`);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return undefined;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	// parse fileSize from responseData
	// <tr><th>Content Size:</th><td>1.50 GB</td>
	const fileSizeMatch = responseData.match(/<tr><th>Content Size:<\/th><td>(.+?)<\/td>/);
	if (!fileSizeMatch) {
		return undefined;
	}
	// parse fileSize from match, convert to megabytes - can be TB, GB, MB, or KB so we need to check
	const fileSize = fileSizeMatch[1].includes('TB')
		? parseFloat(fileSizeMatch[1]) * 1024 * 1024
		: fileSizeMatch[1].includes('GB')
		? parseFloat(fileSizeMatch[1]) * 1024
		: fileSizeMatch[1].includes('MB')
		? parseFloat(fileSizeMatch[1])
		: parseFloat(fileSizeMatch[1]) / 1024;

	// parse created date from responseData
	// <tr><th>Created On:</th><td>2016-04-10</td>
	const createdOnMatch = responseData.match(/<tr><th>Created On:<\/th><td>(.+?)<\/td>/);
	// parse created date from match
	if (createdOnMatch && !isFoundDateRecent(createdOnMatch[1], airDate)) {
		return undefined;
	}

	return {
		title: item.title,
		fileSize,
		hash: item.hash.toLowerCase(),
	};
}

async function processInBatches(
	title: string,
	promises: (() => Promise<ScrapeSearchResult | undefined>)[],
	batchSize: number
): Promise<ScrapeSearchResult[]> {
	let searchResultsArr: ScrapeSearchResult[] = [];
	let i = 0;
	let lastPrintedIndex = 0;
	while (i < promises.length) {
		let percentageIncrease = ((i - lastPrintedIndex) / promises.length) * 100;
		if (percentageIncrease >= 20) {
			console.log(`🐱 TorrentKitty batch ${i}/${promises.length}:${title}`);
			lastPrintedIndex = i;
		}
		const promisesResults = await Promise.all(
			promises.slice(i, i + batchSize).map(async (e) => await e())
		);
		promisesResults.forEach((e) => e && searchResultsArr.push(e));
		i += batchSize;
	}
	console.log(`🐱 TorrentKitty done! ${title}`);
	return searchResultsArr;
}

type TitleAndHash = {
	title: string;
	hash: string;
};

const processPage = async (
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[]> => {
	const MAX_RETRIES = 5; // maximum number of retries

	let results: ScrapeSearchResult[] = [];
	let retries = 0; // current number of retries
	let responseData = '';
	const searchUrl = createSearchUrl(finalQuery);
	while (true) {
		try {
			const response = await axios.get(searchUrl, { timeout: 60000 });
			responseData = response.data;
			break;
		} catch (error: any) {
			console.log('request error:', error.message, searchUrl);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return results;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	// <td class="name">Saturday.Night.Live.S41E19.Goodnight.Sweet.Prince.HDTV.x264-W4F[ettv]</td>
	// get all titles from page by regex matching
	const titleMatches = responseData.match(/<td class="name">(.+?)<\/td>/g);
	if (!titleMatches) {
		return [];
	}
	// parse title text from matches
	let titles = titleMatches.map(
		(match: string) => match.match(/<td class="name">(.+?)<\/td>/)![1]
	);

	// <a href="/information/3D7135215F164DB5D691794CF9BAA4BF7269CF86" title="Saturday.Night.Live.S41E19.Goodnight.Sweet.Prince.HDTV.x264-W4F[ettv]" rel="information">Detail</a>
	// get all hashes from page by regex matching
	const hashMatches = responseData.match(
		/<a href="\/information\/(.+?)" title=".+?" rel="information">Detail<\/a>/g
	);
	if (!hashMatches) {
		return [];
	}
	// parse hash text from matches
	const hashes = hashMatches.map(
		(match: string) =>
			match.match(
				/<a href="\/information\/(.+?)" title=".+?" rel="information">Detail<\/a>/
			)![1]
	);

	// combine titles and hashes into an array of objects
	const titlesAndHashes: TitleAndHash[] = titles
		.map((title: string, index: number) => ({ title, hash: hashes[index] }))
		.filter((item: { title: string; hash: string }) =>
			meetsTitleConditions(targetTitle, years, item.title)
		);

	console.log(`🐱 TorrentKitty search returned ${titlesAndHashes.length} for ${finalQuery}`);

	const promises: (() => Promise<ScrapeSearchResult | undefined>)[] = titlesAndHashes.map(
		(item: TitleAndHash) => {
			return () => processItem(item, airDate);
		}
	);
	results.push(...(await processInBatches(finalQuery, promises, 10)));

	console.log(results);

	return results;
};

export async function scrapeTorrentKitty(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching TorrentKitty: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, years, airDate);
	} catch (error) {
		console.error('scrapeTorrentKitty page processing error', error);
	}
	return [];
}
