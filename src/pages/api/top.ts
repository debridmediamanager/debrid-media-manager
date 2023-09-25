import MdbList from '@/services/mdblist';
import { lcg, shuffle } from '@/utils/seededShuffle';
import { NextApiHandler } from 'next';

const handler: NextApiHandler = async (req, res) => {
	const mdblist = new MdbList();
	let topLists = await mdblist.topLists();
	let rng = lcg(new Date().getTime() / 1000 / 60 / 10);
	topLists = shuffle(topLists, rng).slice(0, 16);

	const response: Record<string, string[]> = {};
	for (const list of topLists) {
		const itemsResponse = await mdblist.listItems(list.id);
		response[list.name] = itemsResponse
			.filter((item) => item.imdb_id)
			.slice(0, 16)
			.map((item) => `${list.mediatype}:${item.imdb_id}`);
	}

	res.status(200).json(response);
};

export default handler;
