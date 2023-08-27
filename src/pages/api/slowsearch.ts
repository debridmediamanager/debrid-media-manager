import {
	createAxiosInstance,
	fetchSearchResults,
	flattenAndRemoveDuplicates,
	groupByParsedTitle,
	SearchResult,
} from '@/services/btdigg';
import { cleanSearchQuery, getLibraryTypes } from '@/utils/search';
import { NextApiRequest, NextApiResponse } from 'next';
import { SocksProxyAgent } from 'socks-proxy-agent';

export type SlowSearchApiResponse = {
	searchResults?: SearchResult[];
	errorMessage?: string;
};

const agent = new SocksProxyAgent(process.env.PROXY!, { timeout: 3000 });

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<SlowSearchApiResponse>
) {
	const { search, libraryType } = req.query;

	if (!search || search instanceof Array) {
		res.status(400).json({ errorMessage: 'Missing "search" query parameter' });
		return;
	}

	if (!libraryType || libraryType instanceof Array) {
		res.status(400).json({ errorMessage: 'Missing "libraryType" query parameter' });
		return;
	}

	const finalQuery = cleanSearchQuery(search);
	const libraryTypes = getLibraryTypes(libraryType);

	try {
		const results = [];
		for (const lType of libraryTypes) {
			results.push(await fetchSearchResults('veryslow', createAxiosInstance(agent), finalQuery, lType));
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
