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

		processTrInstantCheck(baseUrl, apiKey, hashes, setSearchResults).catch(() => {});
	}, [baseUrl, apiKey, hashKey, setSearchResults]);
}
