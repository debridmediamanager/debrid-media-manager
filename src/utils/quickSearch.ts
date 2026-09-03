import { SearchResult } from '@/services/mediasearch';
import { UserTorrent } from '@/torrent/userTorrent';

// given a list, filter by query and paginate
export function quickSearchLibrary(query: string, unfiltered: UserTorrent[]) {
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
							(t.serviceStatus && t.serviceStatus.toLowerCase() === q)
						);
					} catch (e) {
						return (
							t.id.substring(0, 3).toLowerCase() === q ||
							t.id.substring(3).toLowerCase() === q ||
							t.hash.toLowerCase() === q ||
							(t.serviceStatus && t.serviceStatus.toLowerCase() === q)
						);
					}
				})
			)
		: unfiltered;
}

export function quickSearch(query: string, unfiltered: SearchResult[]) {
	if (!query) return unfiltered;
	return unfiltered.filter((t) =>
		query.split(' ').every((subquery) => {
			// Skip if the term is just a hyphen
			if (subquery === '-') return true;

			const isExclusion = subquery.startsWith('-');
			const q = (isExclusion ? subquery.substring(1) : subquery).toLowerCase();

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

			// Handle debrid availability queries
			// (is:rd, is:ad, is:tb, is:pm, is:oc, is:cached, is:uncached)
			if (q.startsWith('is:')) {
				const value = q.substring(3);
				const anyAvailable = !!(
					t.rdAvailable ||
					t.adAvailable ||
					t.tbAvailable ||
					t.pmAvailable ||
					t.ocAvailable
				);

				let available: boolean;
				switch (value) {
					case 'rd':
						available = !!t.rdAvailable;
						break;
					case 'ad':
						available = !!t.adAvailable;
						break;
					case 'tb':
						available = !!t.tbAvailable;
						break;
					case 'pm':
						available = !!t.pmAvailable;
						break;
					case 'oc':
						available = !!t.ocAvailable;
						break;
					case 'cached':
						available = anyAvailable;
						break;
					case 'uncached':
						available = !anyAvailable;
						break;
					default:
						return false;
				}

				return isExclusion ? !available : available;
			}

			// Regular title/hash search
			try {
				const matches = new RegExp(q, 'i').test(t.title) || t.hash === q;
				return isExclusion ? !matches : matches;
			} catch (e) {
				const matches = t.hash === q;
				return isExclusion ? !matches : matches;
			}
		})
	);
}
