import { notifyLocalStorageChange } from '@/hooks/localStorage';
import { useEffect, useState } from 'react';

/**
 * Marks a browser that came in without connecting a debrid service.
 *
 * DMM's indexer endpoints - Torznab and Newznab - are answered against a DMM
 * API key, not a debrid credential, so a sponsor pointing Prowlarr at DMM needs
 * nothing from Real-Debrid or TorBox to use them. Before this flag existed they
 * still could not get in: `withAuth` bounced every page to /start until some
 * provider token appeared, and Settings - the one place a DMM API key is
 * linked - was behind that same gate.
 *
 * It is not a credential and it opens no data. Everything a guest can reach is
 * either public (search, browse) or keyed on something the server checks for
 * itself (the sponsor key). The library is the one page it deliberately does
 * not open, because there is no account whose torrents it could list.
 */
export const GUEST_MODE_KEY = 'dmm:guest';

/** Read outside React, for the guard in `withAuth` and for tests. */
export function isGuestMode(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return window.localStorage.getItem(GUEST_MODE_KEY) === 'true';
	} catch {
		// A browser with site data blocked cannot hold guest mode either
		return false;
	}
}

export function enableGuestMode(): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(GUEST_MODE_KEY, 'true');
	} catch {
		return;
	}
	notifyLocalStorageChange(GUEST_MODE_KEY);
}

export function disableGuestMode(): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.removeItem(GUEST_MODE_KEY);
	} catch {
		return;
	}
	notifyLocalStorageChange(GUEST_MODE_KEY);
}

/**
 * Guest mode as React state, kept in step with the storage writes above.
 *
 * The initialiser reads localStorage, which on the server is nothing - the same
 * shape every credential read in `withAuth` already has. Nothing that calls this
 * is server-rendered: `withAuth` shows its loading screen for the first commit,
 * so the markup being hydrated never contains a guest-dependent branch.
 */
export function useGuestMode(): boolean {
	const [guest, setGuest] = useState<boolean>(() => isGuestMode());

	useEffect(() => {
		const read = () => setGuest(isGuestMode());
		read();
		// `storage` covers other tabs and `localStorage.clear()`; `local-storage`
		// is the same-tab announcement useLocalStorage writers make; `logout` is
		// what handleLogout fires after sweeping keys.
		window.addEventListener('storage', read);
		window.addEventListener('local-storage', read);
		window.addEventListener('logout', read);
		return () => {
			window.removeEventListener('storage', read);
			window.removeEventListener('local-storage', read);
			window.removeEventListener('logout', read);
		};
	}, []);

	return guest;
}
