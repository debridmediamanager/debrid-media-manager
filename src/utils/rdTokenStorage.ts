/**
 * Direct access to the stored Real-Debrid access token.
 *
 * useLocalStorage owns this key for React consumers, but two places need it
 * outside a component: the refresh scheduler needs the expiry to know when to
 * renew, and the axios 401 handler needs to write a fresh token back. Both go
 * through here so the storage shape - and the events that keep every
 * useLocalStorage instance in sync - stay in one place.
 */

const ACCESS_TOKEN_KEY = 'rd:accessToken';

export const RD_CLIENT_ID_KEY = 'rd:clientId';
export const RD_CLIENT_SECRET_KEY = 'rd:clientSecret';
export const RD_REFRESH_TOKEN_KEY = 'rd:refreshToken';

type StoredToken = {
	value: string;
	/** epoch ms, or null when the entry was written without a TTL */
	expiry: number | null;
};

function readRaw(key: string): unknown {
	if (typeof window === 'undefined') return null;
	try {
		const item = window.localStorage.getItem(key);
		return item ? JSON.parse(item) : null;
	} catch {
		return null;
	}
}

/** Plain string value for any of the rd:* credential keys. */
export function readRdCredential(key: string): string | null {
	const parsed = readRaw(key);
	if (typeof parsed === 'string') return parsed;
	if (parsed && typeof parsed === 'object' && typeof (parsed as any).value === 'string') {
		return (parsed as any).value;
	}
	return null;
}

export function readStoredAccessToken(): StoredToken | null {
	const parsed = readRaw(ACCESS_TOKEN_KEY);
	if (typeof parsed === 'string') {
		return { value: parsed, expiry: null };
	}
	if (
		parsed &&
		typeof parsed === 'object' &&
		typeof (parsed as any).value === 'string' &&
		typeof (parsed as any).expiry === 'number'
	) {
		return { value: (parsed as any).value, expiry: (parsed as any).expiry };
	}
	return null;
}

/**
 * Write a refreshed token and tell every useLocalStorage instance about it.
 * Mirrors what useLocalStorage.setValue dispatches, so hooks re-read instead of
 * holding the superseded token in memory.
 */
export function writeAccessToken(token: string, expiresInSecs: number): void {
	if (typeof window === 'undefined') return;
	const payload = JSON.stringify({
		value: token,
		expiry: Date.now() + expiresInSecs * 1000,
	});
	try {
		window.localStorage.setItem(ACCESS_TOKEN_KEY, payload);
		window.dispatchEvent(
			new StorageEvent('storage', { key: ACCESS_TOKEN_KEY, newValue: payload })
		);
		window.dispatchEvent(
			new CustomEvent('local-storage', { detail: { key: ACCESS_TOKEN_KEY } })
		);
	} catch {
		// best effort - some environments block constructing StorageEvent
	}
}

export function readRdOAuthCredentials(): {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
} | null {
	const clientId = readRdCredential(RD_CLIENT_ID_KEY);
	const clientSecret = readRdCredential(RD_CLIENT_SECRET_KEY);
	const refreshToken = readRdCredential(RD_REFRESH_TOKEN_KEY);
	if (!clientId || !clientSecret || !refreshToken) return null;
	return { clientId, clientSecret, refreshToken };
}
