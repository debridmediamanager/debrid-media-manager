import { SearchResult } from '@/services/mediasearch';
import { UserTorrent } from '@/torrent/userTorrent';

// given a list, filter by query and paginate
export function applyQuickSearch(query: string, unfiltered: UserTorrent[]) {
	return query
		? unfiltered.filter((t) =>
				query.split(' ').every((subquery) => {
					const q = subquery.toLowerCase();
					try {
						return (
							new RegExp(q, 'i').test(t.filename) ||
							t.id.substring(0, 3).toLowerCase() === q ||
							t.id.substring(3).toLowerCase() === q ||
							t.hash.toLowerCase() === q ||
							t.serviceStatus.toLowerCase() === q
						);
					} catch (e) {
						return (
							t.id.substring(0, 3).toLowerCase() === q ||
							t.id.substring(3).toLowerCase() === q ||
							t.hash.toLowerCase() === q ||
							t.serviceStatus.toLowerCase() === q
						);
					}
				})
			)
		: unfiltered;
}

export function applyQuickSearch2(query: string, unfiltered: SearchResult[]) {
	if (!query) return unfiltered;
	return unfiltered.filter((t) =>
		query.split(' ').every((subquery) => {
			const q = subquery.toLowerCase();

			// Handle video count queries
			if (q.startsWith('videos:')) {
				const value = q.substring(7);
				const count = t.videoCount || 0;

				// Exact match (videos:N)
				if (/^\d+$/.test(value)) {
					return count === parseInt(value);
				}

				// Less than (videos:<N)
				if (value.startsWith('<') && /^\d+$/.test(value.substring(1))) {
					return count < parseInt(value.substring(1));
				}

				// Greater than (videos:>N)
				if (value.startsWith('>') && /^\d+$/.test(value.substring(1))) {
					return count > parseInt(value.substring(1));
				}

				return false;
			}

			// Regular title/hash search
			try {
				return new RegExp(q, 'i').test(t.title) || t.hash === q;
			} catch (e) {
				return t.hash === q;
			}
		})
	);
}
