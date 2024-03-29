import { SearchResult } from '@/services/mediasearch';
import { UserTorrent } from '@/torrent/userTorrent';

// given a list, filter by query and paginate
export function applyQuickSearch(query: string, unfiltered: UserTorrent[]) {
	let regexFilters: RegExp[] = [];
	for (const q of query.split(' ')) {
		try {
			regexFilters.push(new RegExp(q, 'i'));
		} catch (error) {
			continue;
		}
	}
	return query
		? unfiltered.filter((t) =>
				regexFilters.every((regex) => regex.test(t.filename) || regex.test(t.id))
		  )
		: unfiltered;
}

export function applyQuickSearch2(query: string, unfiltered: SearchResult[]) {
	let regexFilters: RegExp[] = [];
	for (const q of query.split(' ')) {
		try {
			regexFilters.push(new RegExp(q, 'i'));
		} catch (error) {
			continue;
		}
	}
	return query
		? unfiltered.filter((t) => regexFilters.every((regex) => regex.test(t.title)))
		: unfiltered;
}
