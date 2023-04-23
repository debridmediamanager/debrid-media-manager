import { CachedTorrentInfo } from '@/utils/cachedTorrentInfo';
import useLocalStorage from './localStorage';

export const useDownloadsCache = (providerKey: string) => {
	type cacheType = Record<string, CachedTorrentInfo>;

	const [cache, setCache] = useLocalStorage<cacheType>(`${providerKey}:downloads`, {});

	const addOneToCache = (id: string, hash: string, status?: string) => {
		if (cache && hash in cache === true) {
			setCache((prev) => ({
				...prev,
				[hash]: {
					...prev[hash],
					status: status === 'downloaded' ? 'downloaded' : 'downloading',
				},
			}));
		} else {
			setCache((prev) => ({
				...prev,
				[hash]: {
					id,
					hash,
					progress: 0,
					status: status === 'downloaded' ? 'downloaded' : 'downloading',
				},
			}));
		}
	};

	const addManyToCache = (torrents: CachedTorrentInfo[]) => {
		setCache((prev) => ({
			...prev,
			...torrents.reduce((acc: cacheType, curr: CachedTorrentInfo) => {
				acc[curr.hash] = curr;
				return acc;
			}, {}),
		}));
	};

	const removeFromCache = (id: string) => {
		if (!cache) return;
		setCache((prev) => {
			const hash = Object.keys(prev).find((key) => prev[key].id === id);
			const newCache = { ...prev };
			if (!hash) return newCache;
			delete newCache[hash];
			return newCache;
		});
	};

	const cacheUtils = {
		inLibrary: (hash: string): boolean => hash in cache!,
		notInLibrary: (hash: string): boolean => !cacheUtils.inLibrary(hash),
		isDownloaded: (hash: string): boolean =>
			cacheUtils.inLibrary(hash) && cache![hash].status === 'downloaded',
		isDownloading: (hash: string): boolean =>
			cacheUtils.inLibrary(hash) && cache![hash].status !== 'downloaded',
	};

	const adder = {
		single: addOneToCache,
		many: addManyToCache,
	};

	return [cache, cacheUtils, adder, removeFromCache] as const;
};
