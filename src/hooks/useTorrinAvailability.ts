import { SearchResult } from '@/services/mediasearch';
import { processTrInstantCheck } from '@/utils/instantChecks';
import { useEffect } from 'react';
import useLocalStorage from './localStorage';

export function useTorrinAvailability(
	searchResults: SearchResult[],
	setSearchResults: React.Dispatch<React.SetStateAction<SearchResult[]>>
) {
	const [baseUrl] = useLocalStorage<string>('torrin:baseUrl');
	const [apiKey] = useLocalStorage<string>('torrin:apiKey');

	const hashKey = searchResults.map((r) => r.hash).join(',');

	useEffect(() => {
		if (!baseUrl || !apiKey || !hashKey) return;
		const hashes = hashKey.split(',').filter(Boolean);
		if (hashes.length === 0) return;

		// Ignore a late-finishing check once the base URL, key, or result set changes,
		// so a stale request can't clobber the current results.
		let cancelled = false;
		const guardedSetter: React.Dispatch<React.SetStateAction<SearchResult[]>> = (update) => {
			if (!cancelled) setSearchResults(update);
		};
		processTrInstantCheck(baseUrl, apiKey, hashes, guardedSetter).catch(() => {});

		return () => {
			cancelled = true;
		};
	}, [baseUrl, apiKey, hashKey, setSearchResults]);
}
