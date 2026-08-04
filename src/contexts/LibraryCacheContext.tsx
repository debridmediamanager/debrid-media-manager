import {
	EnhancedLibraryCacheProvider,
	useEnhancedLibraryCache,
} from '@/contexts/EnhancedLibraryCacheContext';
import { UserTorrent } from '@/torrent/userTorrent';
import { ReactNode, useEffect, useMemo, useState } from 'react';

const LAST_SYNC_STORAGE_KEY = 'library:lastSync';

export interface LibraryCacheContextType {
	libraryItems: UserTorrent[];
	isLoading: boolean;
	isFetching: boolean;
	lastFetchTime: Date | null;
	error: string | null;
	refreshLibrary: () => Promise<void>;
	setLibraryItems: React.Dispatch<React.SetStateAction<UserTorrent[]>>;
	addTorrent: (torrent: UserTorrent) => void;
	removeTorrent: (torrentId: string) => void;
	removeTorrents: (torrentIds: string[]) => void;
	updateTorrent: (torrentId: string, updates: Partial<UserTorrent>) => void;
}

// Provider stays the same name but delegates to the enhanced provider
export function LibraryCacheProvider({ children }: { children: ReactNode }) {
	return <EnhancedLibraryCacheProvider>{children}</EnhancedLibraryCacheProvider>;
}

// Hook keeps the same name/signature but adapts to the enhanced context
export function useLibraryCache(): LibraryCacheContextType {
	const enhanced = useEnhancedLibraryCache();
	const [persistedLastSync, setPersistedLastSync] = useState<Date | null>(() => {
		if (typeof window === 'undefined') return null;
		const stored = window.localStorage.getItem(LAST_SYNC_STORAGE_KEY);
		if (!stored) return null;
		const parsed = new Date(stored);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	});

	useEffect(() => {
		if (!enhanced.stats.lastSync) return;
		setPersistedLastSync(enhanced.stats.lastSync);
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(
				LAST_SYNC_STORAGE_KEY,
				enhanced.stats.lastSync.toISOString()
			);
		}
	}, [enhanced.stats.lastSync]);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== LAST_SYNC_STORAGE_KEY) return;
			if (!event.newValue) {
				setPersistedLastSync(null);
				return;
			}
			const parsed = new Date(event.newValue);
			if (Number.isNaN(parsed.getTime())) return;
			setPersistedLastSync(parsed);
		};
		window.addEventListener('storage', handleStorage);
		return () => window.removeEventListener('storage', handleStorage);
	}, []);

	const lastFetchTime = useMemo(
		() => enhanced.stats.lastSync ?? persistedLastSync,
		[enhanced.stats.lastSync, persistedLastSync]
	);

	// Hand the whole list over in one pass. This used to diff by id and call
	// addTorrent/updateTorrent/removeTorrent per item, so a caller that mapped
	// over the library to change a single torrent triggered one update - and one
	// IndexedDB write - for every torrent it owned.
	const setLibraryItems: React.Dispatch<React.SetStateAction<UserTorrent[]>> = (next) => {
		const desired =
			typeof next === 'function'
				? (next as (p: UserTorrent[]) => UserTorrent[])(enhanced.libraryItems)
				: next;
		enhanced.replaceLibrary(desired);
	};

	const refreshLibrary = async () => {
		const start = performance.now();
		console.log('[LibraryCache] refreshLibrary start', {
			timestamp: new Date().toISOString(),
			source: 'LibraryCacheContext',
		});
		try {
			// Legacy behavior: full refresh across all services
			await enhanced.refreshAll(true);
			console.log('[LibraryCache] refreshLibrary success', {
				librarySize: enhanced.libraryItems.length,
				lastSync: enhanced.stats.lastSync?.toISOString() ?? null,
				durationMs: Math.round(performance.now() - start),
			});
		} catch (error) {
			console.error('[LibraryCache] refreshLibrary failure', {
				error,
				durationMs: Math.round(performance.now() - start),
			});
			throw error;
		}
	};

	return {
		libraryItems: enhanced.libraryItems,
		isLoading: enhanced.syncStatus.isLoading,
		isFetching: enhanced.syncStatus.isSyncing,
		lastFetchTime,
		error: enhanced.syncStatus.error,
		refreshLibrary,
		setLibraryItems,
		addTorrent: enhanced.addTorrent,
		removeTorrent: enhanced.removeTorrent,
		removeTorrents: enhanced.removeTorrents,
		updateTorrent: enhanced.updateTorrent,
	};
}
