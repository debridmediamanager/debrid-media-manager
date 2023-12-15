import { UserTorrent } from '@/types/userTorrent';

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
