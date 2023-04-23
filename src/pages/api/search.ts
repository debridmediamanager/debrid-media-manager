import {
	createAxiosInstance,
	fetchSearchResults,
	flattenAndRemoveDuplicates,
	groupByParsedTitle,
	SearchResult,
	searchSpeedType,
} from '@/services/btdigg';
import { cleanSearchQuery, getLibraryTypes } from '@/utils/search';
import { NextApiRequest, NextApiResponse } from 'next';
import { SocksProxyAgent } from 'socks-proxy-agent';

export type SearchApiResponse = {
	searchResults?: SearchResult[];
	errorMessage?: string;
};

const agent = new SocksProxyAgent(process.env.PROXY!, { timeout: 3000 });

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<SearchApiResponse>
) {
	const { search, libraryType, searchSpeedPassword, searchSpeed } = req.query;

	if (!search || search instanceof Array) {
		res.status(400).json({ errorMessage: 'Missing "search" query parameter' });
		return;
	}

	if (!libraryType || libraryType instanceof Array) {
		res.status(400).json({ errorMessage: 'Missing "libraryType" query parameter' });
		return;
	}

	if (searchSpeed instanceof Array) {
		res.status(400).json({ errorMessage: 'Missing "searchSpeed" query parameter' });
		return;
	}

	const finalQuery = cleanSearchQuery(search);
	const libraryTypes = getLibraryTypes(libraryType);
	const client = createAxiosInstance(agent);

	let speed: searchSpeedType = 'veryfast';
	if (process.env.SEARCH_SPEED_PASSWORD) {
		speed =
			searchSpeedPassword === process.env.SEARCH_SPEED_PASSWORD
				? (searchSpeed as searchSpeedType)
				: speed;
	}

	try {
		const results = [];
		for (const lType of libraryTypes) {
			results.push(await fetchSearchResults(speed, client, finalQuery, lType));
		}
		let processedResults = flattenAndRemoveDuplicates(results);
		if (processedResults.length) processedResults = groupByParsedTitle(processedResults);

		res.status(200).json({ searchResults: processedResults });
	} catch (error: any) {
		res.status(500).json({
			errorMessage: `An error occurred while scraping the Btdigg (${error.message})`,
		});
	}
}
