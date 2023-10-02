import axios from 'axios';
import bencode from 'bencode';
import { createHash } from 'crypto';
import { ScrapeSearchResult } from './mediasearch';

const prowlarrHost = process.env.PROWLARR ?? 'http://localhost:9696';
const apikey = process.env.PROWLARR_KEY ?? 'abc123';

function isFoundDateRecent(foundString: string, date: string): boolean {
	const foundDate = new Date(foundString);
	const airDate = new Date(date);
	// Return true if the found date is more recent or equal
	return foundDate >= airDate;
}

const createSearchUrl = (finalQuery: string) =>
	`${prowlarrHost}/api/v1/search?query=${encodeURIComponent(
		finalQuery
	)}&indexerIds=-2&categories[]=2000&categories[]=5000&type=search&apikey=${apikey}`;

function extractHashFromMagnetLink(magnetLink: string) {
	const regex = /urn:btih:([A-Fa-f0-9]+)/;
	const match = magnetLink.match(regex);
	if (match) {
		return match[1].toLowerCase();
	} else {
		return undefined;
	}
}

async function computeHashFromTorrent(url: string): Promise<string | undefined> {
	try {
		const response = await axios.get(url, {
			maxRedirects: 0, // Set maxRedirects to 0 to disable automatic redirects
			validateStatus: (status) => status >= 200 && status < 400,
			responseType: 'arraybuffer',
			timeout: 10000,
		});

		if (response.status === 301 || response.status === 302) {
			const redirectURL = response.headers.location;
			if (redirectURL.startsWith('magnet:')) {
				// If the redirect URL is a magnet link, return it directly
				return extractHashFromMagnetLink(redirectURL);
			}
		}

		const info = bencode.decode(response.data).info;
		const encodedInfo = bencode.encode(info);
		const infoHash = createHash('sha1').update(encodedInfo).digest();
		const magnetHash = Array.prototype.map
			.call(new Uint8Array(infoHash), (byte) => {
				return ('0' + byte.toString(16)).slice(-2);
			})
			.join('');

		return magnetHash.toLowerCase();
	} catch (error: any) {
		return undefined;
	}
}

async function processItem(
	item: any,
	targetTitle: string,
	mustHaveTerms: (string | RegExp)[],
	airDate: string
): Promise<ScrapeSearchResult | undefined> {
	const title = item.title;
	const fileSize = item.size / 1024 / 1024;

	if (!isFoundDateRecent(item.publishDate, airDate)) {
		return undefined;
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
		// console.log(
		// 	`❌ ${item.indexer} returned a bad result (title match)`,
		// 	containedTerms,
		// 	requiredTerms
		// );
		return undefined;
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
		// console.log(
		// 	`❌ ${item.indexer} returned a bad result (must have terms)`,
		// 	containedMustHaveTerms,
		// 	mustHaveTerms.length
		// );
		return undefined;
	}
	if (!targetTitle.match(/xxx/i)) {
		if (title.match(/xxx/i)) {
			return undefined;
		}
	}

	const hash =
		item.infoHash?.toLowerCase() ||
		(item.magnetUrl && (await computeHashFromTorrent(item.magnetUrl))) ||
		(item.downloadUrl && (await computeHashFromTorrent(item.downloadUrl)));
	if (!hash) {
		return undefined;
	}

	return {
		title,
		fileSize,
		hash,
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
		if (percentageIncrease >= 10) {
			console.log(`🌄 Prowlarr batch ${i}/${promises.length}:${title}`);
			lastPrintedIndex = i;
		}
		const promisesResults = await Promise.all(
			promises.slice(i, i + batchSize).map(async (e) => await e())
		);
		promisesResults.forEach((e) => e && searchResultsArr.push(e));
		i += batchSize;
	}
	console.log(`🌄 Prowlarr done! ${title}`);
	return searchResultsArr;
}

const processPage = async (
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: (string | RegExp)[],
	airDate: string
): Promise<ScrapeSearchResult[]> => {
	const MAX_RETRIES = 5; // maximum number of retries

	let results: ScrapeSearchResult[] = [];
	let retries = 0; // current number of retries
	let responseData = [];
	const searchUrl = createSearchUrl(finalQuery);
	while (true) {
		try {
			const response = await axios.get(searchUrl, { timeout: 600000 });
			responseData = response.data;
			retries = 0;
			break;
		} catch (error: any) {
			console.log('request error:', error.message);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return results;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	responseData = responseData
		.filter((item: any) => item.size >= 1024 * 1024 * 100)
		.filter((item: any) => item.leechers > 0 || item.seeders > 0);
	console.log(`🌄 Prowlarr search returned ${responseData.length} for ${finalQuery}`);

	const promises: (() => Promise<ScrapeSearchResult | undefined>)[] = responseData.map(
		(item: any) => {
			return () => processItem(item, targetTitle, mustHaveTerms, airDate);
		}
	);
	results.push(...(await processInBatches(finalQuery, promises, 5)));

	return results;
};

export async function scrapeProwlarr(
	finalQuery: string,
	targetTitle: string,
	mustHaveTerms: (string | RegExp)[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching Prowlarr: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, mustHaveTerms, airDate);
	} catch (error) {
		console.error('scrapeProwlarr page processing error', error);
	}
	return [];
}
