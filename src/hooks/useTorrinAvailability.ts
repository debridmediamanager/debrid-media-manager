import { SearchResult } from '@/services/mediasearch';
import { torrinInstantCheck } from '@/services/torrin';
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

		let cancelled = false;
		torrinInstantCheck(baseUrl, apiKey, hashes)
			.then((resp) => {
				if (cancelled) return;
				const cached = new Set(
					Object.entries(resp || {})
						.filter(([, v]) => ((v as any)?.rd?.length ?? 0) > 0)
						.map(([h]) => h.toLowerCase())
				);
				if (cached.size === 0) return;
				setSearchResults((prev) => {
					let changed = false;
					const next = prev.map((r) => {
						if (cached.has(r.hash.toLowerCase()) && !r.torrinAvailable) {
							changed = true;
							return { ...r, torrinAvailable: true };
						}
						return r;
					});
					return changed ? next : prev;
				});
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	}, [baseUrl, apiKey, hashKey, setSearchResults]);
}
