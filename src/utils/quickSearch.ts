import { SearchResult } from '@/services/mediasearch';
import { UserTorrent } from '@/torrent/userTorrent';

// given a list, filter by query and paginate
export function applyQuickSearch(query: string, unfiltered: UserTorrent[]) {
	return query
		? unfiltered.filter((t) =>
				query.split(' ').every((subquery) => {
					const q = subquery.toLowerCase();
					return (
						new RegExp(q, 'i').test(t.filename) ||
						t.id.substring(0, 3).toLowerCase() === q ||
						t.id.substring(3).toLowerCase() === q ||
						t.hash.toLowerCase() === q ||
						t.serviceStatus.toLowerCase() === q
					);
				})
			)
		: unfiltered;
}

export function applyQuickSearch2(query: string, unfiltered: SearchResult[]) {
	return query
		? unfiltered.filter((t) =>
				query.split(' ').every((subquery) => {
					const q = subquery.toLowerCase();
					return new RegExp(q, 'i').test(t.title) || t.hash === q;
				})
			)
		: unfiltered;
}
