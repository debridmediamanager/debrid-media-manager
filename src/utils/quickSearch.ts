import { SearchResult } from '@/services/mediasearch';
import { UserTorrent } from '@/torrent/userTorrent';

const HASH_LENGTH_MIN_THRESHOLD = 8;

// given a list, filter by query and paginate
export function applyQuickSearch(query: string, unfiltered: UserTorrent[]) {
	let regexFilters: RegExp[] = [];
	for (let q of query.split(' ')) {
		try {
			if (q.startsWith('magnet:?')) {
				const hash = q.match(/xt=urn:btih:([a-zA-Z0-9]{8,40})/);
				if (hash && hash.length >= 2) regexFilters.push(new RegExp(hash[1], 'i'));
				continue;
			}
			regexFilters.push(new RegExp(q, 'i'));
		} catch (error) {
			continue;
		}
	}
	return query
		? unfiltered.filter((t) =>
				regexFilters.every((regex) => regex.test(t.filename) || regex.test(t.id) || (regex.toString().length >= HASH_LENGTH_MIN_THRESHOLD+3 && regex.test(t.hash)))
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
