import { MListItem } from '@/services/mdblist';
import { getMdblistClient } from '@/services/mdblistClient';
import { lcg, shuffle } from '@/utils/seededShuffle';
import { NextApiHandler } from 'next';

const handler: NextApiHandler = async (req, res) => {
	const mdblistClient = getMdblistClient();
	let topLists = await mdblistClient.getTopLists();
	let rng = lcg(new Date().getTime() / 1000 / 60 / 5);
	topLists = shuffle(topLists, rng).slice(0, 4);

	const response: Record<string, string[]> = {};
	for (const list of topLists) {
		const itemsResponse = await mdblistClient.getListItems(list.id.toString());
		response[list.name] = itemsResponse
			.filter((item: MListItem) => item.imdb_id)
			.slice(0, 16)
			.map((item: MListItem) => `${list.mediatype}:${item.imdb_id}`);
	}

	res.status(200).json(response);
};

export default handler;
