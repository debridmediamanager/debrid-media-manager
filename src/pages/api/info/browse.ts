import { MList, MListItem } from '@/services/mdblist';
import { getMdblistClient } from '@/services/mdblistClient';
import { lcg, shuffle } from '@/utils/seededShuffle';
import { NextApiRequest, NextApiResponse } from 'next';

type BrowseResponse = Record<string, string[]>;
type BrowseResponseCache = {
	lastUpdated: number;
	response: BrowseResponse;
};
const responses: Record<string, BrowseResponseCache> = {};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { search } = req.query;

	let key = 'index';
	if (search && typeof search === 'string') {
		key = decodeURIComponent(search).toLowerCase();
		key = key.replace(/[^a-z\s]/gi, ' ');
	}

	try {
		if (responses[key] && responses[key].lastUpdated > new Date().getTime() - 1000 * 60 * 10) {
			return res.status(200).json(responses[key].response);
		}

		const mdblistClient = getMdblistClient();
		let topLists;
		if (key === 'index') {
			topLists = await mdblistClient.getTopLists();
		} else {
			topLists = await mdblistClient.searchLists(key);
		}

		let rng = lcg(new Date().getTime() / 1000 / 60 / 10);
		topLists = shuffle(topLists, rng).slice(0, 4);

		const response: BrowseResponse = {};
		for (const list of topLists as MList[]) {
			const itemsResponse = await mdblistClient.getListItems(list.id.toString());
			const defaultMediaType = list.name.toLowerCase().includes('movie') ? 'movie' : 'show';
			response[list.name] = itemsResponse
				.filter((item: MListItem) => item.imdb_id)
				.slice(0, 24)
				.map(
					(item: MListItem) =>
						`${list.mediatype || defaultMediaType}:${item.imdb_id}:${item.title}`
				);
			response[list.name] = shuffle(response[list.name], rng);
		}

		responses[key] = {
			lastUpdated: new Date().getTime(),
			response,
		};

		res.status(200).json(response);
	} catch (error) {
		console.error('Error in browse info handler:', error);
		res.status(500).json({ error: 'Failed to fetch browse information' });
	}
}
