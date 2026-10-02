import { notifyLocalStorageChange } from '@/hooks/localStorage';
import { logoutSimkl } from '@/services/simkl';
import UserTorrentDB from '@/torrent/db';
import type { NextRouter } from 'next/router';
import { notifySimklSessionChange } from './simklLogin';

export async function handleLogout(
	prefix: string | undefined,
	router: Pick<NextRouter, 'reload' | 'push'>
) {
	if (!prefix || prefix === 'simkl:') {
		try {
			await logoutSimkl();
		} catch (error) {
			// The server clears its cookie even when Redis deletion fails.
			// Re-read the session instead of leaving private views authenticated.
			notifySimklSessionChange();
			throw error;
		}
	}

	// Clear IndexedDB library cache (current week only)
	try {
		const torrentDB = new UserTorrentDB();
		await torrentDB.clear();
		console.log('Logout: Cleared current week library cache');
	} catch (error) {
		console.error('Failed to clear torrent database:', error);
	}

	if (prefix) {
		const removed: string[] = [];
		let i = localStorage.length - 1;
		while (i >= 0) {
			const key = localStorage.key(i);
			if (key && key.startsWith(prefix)) {
				localStorage.removeItem(key);
				removed.push(key);
			}
			i--;
		}
		// Keep useLocalStorage instances in step with the keys we just dropped
		removed.forEach(notifyLocalStorageChange);
		// Dispatch logout event to update UI immediately
		window.dispatchEvent(new Event('logout'));
		if (prefix === 'simkl:') notifySimklSessionChange();
		router.reload();
	} else {
		localStorage.clear();
		// key: null is the "everything was cleared" signal useLocalStorage honors
		window.dispatchEvent(new StorageEvent('storage', { key: null }));
		// Dispatch logout event to update UI immediately
		window.dispatchEvent(new Event('logout'));
		notifySimklSessionChange();
		router.push('/start');
	}
}
