import { notifyLocalStorageChange } from '@/hooks/localStorage';

const clearKeysWithPrefix = (prefix: string) => {
	const keysToRemove: string[] = [];

	for (let i = 0; i < window.localStorage.length; i++) {
		const key = window.localStorage.key(i);
		if (key && key.startsWith(prefix)) {
			keysToRemove.push(key);
		}
	}

	keysToRemove.forEach((key) => {
		window.localStorage.removeItem(key);
		// Without this every useLocalStorage instance keeps serving the token it
		// read before the clear - this path does not reload the page afterwards
		notifyLocalStorageChange(key);
	});

	// Dispatch logout event to update UI immediately
	window.dispatchEvent(new Event('logout'));
};

export const clearRdKeys = () => clearKeysWithPrefix('rd:');

/**
 * Debrid-Link's credentials, dropped together.
 *
 * There are up to four of them - `dl:accessToken`, `dl:refreshToken`,
 * `dl:tokenExpiry` and a pasted `dl:apiKey` - and a `badToken` invalidates the
 * OAuth set as a unit: a refresh token whose access token was rejected is the
 * same dead session. Leaving the expiry behind is the interesting failure, since
 * it would keep triggering a refresh against a token that is gone.
 */
export const clearDlKeys = () => clearKeysWithPrefix('dl:');
