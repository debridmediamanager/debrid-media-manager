import { notifyLocalStorageChange } from '@/hooks/localStorage';
import UserTorrentDB from '@/torrent/db';

/**
 * Saved provider logins, so a household with two Real-Debrid accounts can swap
 * between them instead of logging out and back in (Reddit, 2026-10-31).
 *
 * DMM keeps exactly one login per provider in localStorage under that
 * provider's prefix (`rd:`, `ad:`, ...), and everything downstream assumes
 * one. A saved account is therefore a snapshot of every key under the prefix,
 * parked *outside* it: `clearRdKeys` sweeps the prefix on any rejected token,
 * and a saved account has to survive that. The store never holds the active
 * account, so switching is symmetric and the auth hooks stay untouched.
 */
export type AccountIdentity = { id: string; label: string };

export type SavedAccount = AccountIdentity & {
	/** Raw localStorage strings, so `{ value, expiry }` envelopes round-trip untouched. */
	keys: Record<string, string>;
	savedAt: number;
};

export const savedAccountsKey = (prefix: string) => `dmm:accounts:${prefix.replace(/:$/, '')}`;

export function listSavedAccounts(prefix: string): SavedAccount[] {
	if (typeof window === 'undefined') return [];
	try {
		const parsed = JSON.parse(window.localStorage.getItem(savedAccountsKey(prefix)) ?? '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(a): a is SavedAccount =>
				!!a && typeof a.id === 'string' && !!a.keys && typeof a.keys === 'object'
		);
	} catch {
		return [];
	}
}

function writeSavedAccounts(prefix: string, accounts: SavedAccount[]) {
	const key = savedAccountsKey(prefix);
	if (accounts.length) window.localStorage.setItem(key, JSON.stringify(accounts));
	else window.localStorage.removeItem(key);
	notifyLocalStorageChange(key);
}

function prefixedKeys(prefix: string): string[] {
	const keys: string[] = [];
	for (let i = 0; i < window.localStorage.length; i++) {
		const key = window.localStorage.key(i);
		if (key?.startsWith(prefix)) keys.push(key);
	}
	return keys;
}

/** Snapshot the active login under `prefix`, replacing an older snapshot of the same account. */
export function saveCurrentAccount(prefix: string, identity: AccountIdentity): void {
	const keys: Record<string, string> = {};
	for (const key of prefixedKeys(prefix)) keys[key] = window.localStorage.getItem(key)!;
	if (!Object.keys(keys).length) return;
	const others = listSavedAccounts(prefix).filter((a) => a.id !== identity.id);
	writeSavedAccounts(prefix, [...others, { ...identity, keys, savedAt: Date.now() }]);
}

function sweep(prefix: string) {
	for (const key of prefixedKeys(prefix)) {
		window.localStorage.removeItem(key);
		notifyLocalStorageChange(key);
	}
}

/**
 * Library rows carry no account, so the previous account's torrents would show
 * until the next sync. Same sweep `handleLogout` does.
 */
async function clearLibraryCache() {
	try {
		await new UserTorrentDB().clear();
	} catch (error) {
		console.error('[savedAccounts] failed to clear the library cache', error);
	}
}

/**
 * Make a saved account the active one, parking the current login (if any) in
 * its place. The caller does a full page load afterwards: provider auth state
 * is a module singleton that only a reload resets.
 */
export async function switchToSavedAccount(
	prefix: string,
	id: string,
	current: AccountIdentity | null
): Promise<boolean> {
	const target = listSavedAccounts(prefix).find((a) => a.id === id);
	if (!target) return false;
	if (current) saveCurrentAccount(prefix, current);
	sweep(prefix);
	for (const [key, value] of Object.entries(target.keys)) {
		window.localStorage.setItem(key, value);
		notifyLocalStorageChange(key);
	}
	writeSavedAccounts(
		prefix,
		listSavedAccounts(prefix).filter((a) => a.id !== id)
	);
	await clearLibraryCache();
	return true;
}

/** Park the active login so the provider's login page takes a second account. */
export async function parkCurrentAccount(prefix: string, current: AccountIdentity): Promise<void> {
	saveCurrentAccount(prefix, current);
	sweep(prefix);
	await clearLibraryCache();
}
