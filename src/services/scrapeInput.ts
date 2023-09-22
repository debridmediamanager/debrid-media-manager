import axios from 'axios';

const apiKey = process.env.MDBLIST_API_KEY || 'demo';
const searchListsUrl = (term: string) =>
	`https://mdblist.com/api/lists/search?s=${term}&apikey=${apiKey}`;
const listItemsUrl = (listId: string) =>
	`https://mdblist.com/api/lists/${listId}/items?apikey=${apiKey}`;

export class ScrapeInput {
	constructor() {}

	async *byListId(listId: string): AsyncIterableIterator<string> {
		while (true) {
			try {
				const listItemsResponse = await axios.get(listItemsUrl(listId));
				const listItems = listItemsResponse.data;
				for (const listItem of listItems) {
					if (listItem.imdb_id) {
						console.log(
							`(${listId}:${listItem.rank}/${listItems.length}) ${listItem.title}...`,
							listItem
						);
						yield listItem.imdb_id;
					}
				}
				break;
			} catch (error) {
				console.error('byListId error', error);
				await new Promise((resolve) => setTimeout(resolve, 10000));
			}
		}
	}

	async *byLists(searchTerm: string): AsyncIterableIterator<string> {
		while (true) {
			try {
				const searchListResp = await axios.get(searchListsUrl(searchTerm));
				const lists = searchListResp.data;
				for (let i = 0; i < lists.length; i++) {
					const list = lists[i];
					console.log(`(${searchTerm}:${i}/${lists.length}) ${list.slug}`, list);
					yield list.id;
				}
			} catch (error) {
				console.error('byLists error', error);
				await new Promise((resolve) => setTimeout(resolve, 10000));
			}
		}
	}
}
