import { NextApiHandler } from 'next';

type SearchMiscResponse = Record<string, string[]>;
type SearchMiscResponseCache = {
	lastUpdated: number;
	response: SearchMiscResponse;
};
const responses: Record<string, SearchMiscResponseCache> = {};

const handler: NextApiHandler = async (req, res) => {
	// const { keyword } = req.query;
	// const keywordStr = keyword as string;

	// const mdblist = new MdbList();
	// let topLists;
	// if (!keywordStr) {
	// 	topLists = await mdblist.searchLists('latest');
	// } else {
	// 	topLists = await mdblist.searchLists(keywordStr);
	// }

	// let rng = lcg(new Date().getTime() / 1000 / 60 / 10);
	// topLists = shuffle(topLists, rng).slice(0, 1);

	const response: SearchMiscResponse = {};
	// for (const list of topLists) {
	// 	const itemsResponse = await mdblist.listItems(list.id);
	// 	response[list.name] = itemsResponse
	// 		.filter((item) => item.imdb_id)
	// 		.slice(0, 16)
	// 		.map((item) => `${list.mediatype}:${item.imdb_id}:${item.title}`);
	// }

	// responses[keywordStr] = {
	// 	lastUpdated: new Date().getTime(),
	// 	response,
	// };

	res.status(200).json(response);
};

export default handler;
