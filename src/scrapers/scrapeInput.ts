import { getMdblistClient } from '@/services/mdblistClient';

const mdblistClient = getMdblistClient();

export class ScrapeInput {
	constructor() {}

	async *byListId(listId: string): AsyncIterableIterator<string> {
		while (true) {
			try {
				const listItems = await mdblistClient.getListItems(listId);
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
				const lists = await mdblistClient.searchLists(searchTerm);
				for (let i = 0; i < lists.length; i++) {
					const list = lists[i];
					console.log(`(${searchTerm}:${i}/${lists.length}) ${list.slug}`, list);
					yield list.id;
				}
				break;
			} catch (error) {
				console.error('byLists error', error);
				await new Promise((resolve) => setTimeout(resolve, 10000));
			}
		}
	}
}
