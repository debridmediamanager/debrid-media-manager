import { meetsTitleConditions } from '@/utils/checks';
import axios from 'axios';
import { ScrapeSearchResult } from './mediasearch';

const hostname = process.env.MAGNETDL ?? 'https://www.magnetdl.com';

const createSearchUrl = (finalQuery: string) => {
	// remove all non-alphanumeric characters from the query
	const cleanedQuery = finalQuery.replace(/[^a-zA-Z0-9\s]/g, '').replaceAll(' ', '-');
	const firstLetter = cleanedQuery.charAt(0).toLowerCase();
	return `${hostname}/${firstLetter}/${cleanedQuery}`;
};

const processPage = async (
	finalQuery: string,
	targetTitle: string,
	years: string[]
): Promise<ScrapeSearchResult[]> => {
	const MAX_RETRIES = 5; // maximum number of retries

	let results: ScrapeSearchResult[] = [];
	let retries = 0; // current number of retries
	let responseData = '';
	const searchUrl = createSearchUrl(finalQuery);
	let page = 1;
	while (true) {
		try {
			const response = await axios.get(`${searchUrl}/${page}/`);
			responseData = responseData + response.data;
			if (response.data.includes('Next Page')) {
				page++;
				console.log('Next page found, continuing search');
				continue;
			}
			break;
		} catch (error: any) {
			console.log('MagnetDL request error:', error.message, searchUrl);
			retries++;
			if (retries >= MAX_RETRIES) {
				console.error(`Max retries reached (${MAX_RETRIES}), aborting search`);
				return results;
			}
			await new Promise((resolve) => setTimeout(resolve, 10000 * retries));
		}
	}

	// get all magnet links
	const magnetMatches = Array.from(
		responseData.matchAll(/magnet:\?xt=urn:btih:([A-Fa-f0-9]{40})\&amp;dn=(.*?)&/gs)
	);
	const magnets = magnetMatches.map((match) => ({
		hash: match[1].toLowerCase(),
		title: decodeURIComponent(match[2].replaceAll('+', ' ')),
	}));

	const sizeMatches = Array.from(responseData.matchAll(/<td>([\d.]+\s*[A-Z]{2})<\/td>/gs));
	const sizes = sizeMatches
		.map((match) => match[1])
		.map((size) => {
			const [num, unit] = size.split(' ');
			switch (unit) {
				case 'KB':
					return parseFloat(num) / 1024;
				case 'MB':
					return parseFloat(num);
				case 'GB':
					return parseFloat(num) * 1024;
				case 'TB':
					return parseFloat(num) * 1024 * 1024;
				default:
					return parseFloat(num);
			}
		});

	// combine titles and hashes into an array of objects
	results = magnets
		.map((magnet, index) => ({
			title: magnet.title,
			hash: magnet.hash,
			fileSize: sizes[index],
		}))
		.filter(({ title }) => meetsTitleConditions(targetTitle, years, title));

	console.log(`🧲 MagnetDL search returned ${results.length} for ${finalQuery}`);

	return results;
};

export async function scrapeMagnetDL(
	finalQuery: string,
	targetTitle: string,
	years: string[],
	airDate: string
): Promise<ScrapeSearchResult[]> {
	console.log(`🔍 Searching MagnetDL: ${finalQuery}`);
	try {
		return await processPage(finalQuery, targetTitle, years);
	} catch (error) {
		console.error('scrapeMagnetDL page processing error', error);
	}
	return [];
}
