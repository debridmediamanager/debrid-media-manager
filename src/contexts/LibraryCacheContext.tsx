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

	const setLibraryItems: React.Dispatch<React.SetStateAction<UserTorrent[]>> = (next) => {
		const current = enhanced.libraryItems;
		const desired =
			typeof next === 'function'
				? (next as (p: UserTorrent[]) => UserTorrent[])(current)
				: next;

		const currentMap = new Map(current.map((t) => [t.id, t] as const));
		const desiredMap = new Map(desired.map((t) => [t.id, t] as const));

		// Remove items not present anymore
		for (const id of currentMap.keys()) {
			if (!desiredMap.has(id)) enhanced.removeTorrent(id);
		}
		// Add or update items
		for (const [id, t] of desiredMap.entries()) {
			if (!currentMap.has(id)) enhanced.addTorrent(t);
			else enhanced.updateTorrent(id, t);
		}
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
