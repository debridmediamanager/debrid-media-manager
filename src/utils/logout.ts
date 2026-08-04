import { notifyLocalStorageChange } from '@/hooks/localStorage';
import UserTorrentDB from '@/torrent/db';
import { NextRouter } from 'next/router';

export async function handleLogout(prefix: string | undefined, router: NextRouter) {
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
		router.reload();
	} else {
		localStorage.clear();
		// key: null is the "everything was cleared" signal useLocalStorage honors
		window.dispatchEvent(new StorageEvent('storage', { key: null }));
		// Dispatch logout event to update UI immediately
		window.dispatchEvent(new Event('logout'));
		router.push('/start');
	}
}
