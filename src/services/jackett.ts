import { meetsTitleConditions } from '@/utils/checks';
import { computeHashFromTorrent, extractHashFromMagnetLink } from '@/utils/extractHashFromTorrent';
import axios from 'axios';
import { ScrapeSearchResult } from './mediasearch';

const jackettHost = process.env.JACKETT ?? 'http://localhost:9117';
const apikey = process.env.JACKETT_KEY ?? 'abc123';

function isFoundDateRecent(foundString: string, date: string): boolean {
	const foundDate = new Date(foundString);
	const airDate = new Date(date);
	// Return true if the found date is more recent or equal
	return foundDate >= airDate;
}

const createSearchUrl = (finalQuery: string, mediaType: string) =>
	`${jackettHost}/api/v2.0/indexers/all/results?apikey=${apikey}&Category%5B%5D=${
		mediaType === 'movie' ? '2000' : '5000'
	}&Query=${encodeURIComponent(finalQuery)}`;

async function processItem(
	item: any,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult | undefined> {
	const title = item.Title;

	if (item.Size < 1024 * 1024) {
		return undefined;
	}
	const fileSize = item.Size / 1024 / 1024;

	if (!isFoundDateRecent(item.PublishDate, airDate)) {
		return undefined;
	}

	if (!meetsTitleConditions(targetTitle, years, title)) {
		return undefined;
	}

	const hash =
		item.InfoHash?.toLowerCase() ||
		(item.MagnetUri && extractHashFromMagnetLink(item.MagnetUri)) ||
		(item.Link && (await computeHashFromTorrent(item.Link)));
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
		if (percentageIncrease >= 20) {
			console.log(`🌁 Jackett batch ${i}/${promises.length}:${title}`);
			lastPrintedIndex = i;
		}
		const promisesResults = await Promise.all(
			promises.slice(i, i + batchSize).map(async (e) => await e())
		);
		promisesResults.forEach((e) => e && searchResultsArr.push(e));
		i += batchSize;
	}
	console.log(`🌁 Jackett done! ${title}`);
	return searchResultsArr;
}

const processPage = async (
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string,
	mediaType: string
): Promise<ScrapeSearchResult[]> => {
	const MAX_RETRIES = 5; // maximum number of retries

	let results: ScrapeSearchResult[] = [];
	let retries = 0; // current number of retries
	let responseData = [];
	const searchUrl = createSearchUrl(finalQuery, mediaType);
	while (true) {
		try {
			const response = await axios.get(searchUrl, { timeout: 600000 });
			responseData = response.data.Results;
			retries = 0;
			break;
		} catch (error: any) {
			console.log('jackett request error:', error.message, searchUrl);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return results;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	responseData = responseData
		.filter((item: any) => item.Size >= 1024 * 1024 * 100)
		.filter((item: any) => item.Seeders > 0 || item.Peers > 0);
	console.log(`🌁 Jackett search returned ${responseData.length} for ${finalQuery}`);

	const promises: (() => Promise<ScrapeSearchResult | undefined>)[] = responseData.map(
		(item: any) => {
			return () => processItem(item, targetTitle, years, airDate);
		}
	);
	results.push(...(await processInBatches(finalQuery, promises, 10)));

	return results;
};

export async function scrapeJackett(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string,
	mediaType: string = 'movie'
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching Jackett: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, years, airDate, mediaType);
	} catch (error) {
		console.error('scrapeJackett page processing error', error);
	}
	return [];
}
