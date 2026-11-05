import { notifyLocalStorageChange } from '@/hooks/localStorage';
import { BrowserState, isSyncedKey, SyncIdentity, SyncService } from './browserStateKeys';

/** Every synced key in this browser, as the raw strings localStorage holds. */
export function collectState(): BrowserState {
	const state: BrowserState = {};
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		const value = key && isSyncedKey(key) ? localStorage.getItem(key) : null;
		if (key && value !== null) state[key] = value;
	}
	return state;
}

/**
 * Write a restored state. Keys this browser already holds are kept: the login
 * it just made is fresher than the copy another browser saved, which may hold
 * a key that has since been rotated.
 */
export function applyState(state: BrowserState): void {
	const written = Object.keys(state).filter(
		(key) => isSyncedKey(key) && localStorage.getItem(key) === null
	);
	for (const key of written) localStorage.setItem(key, state[key]);
	// Announced once all are in, so a hook reacting to one key sees the rest.
	for (const key of written) notifyLocalStorageChange(key);
}

/** A stored credential as useLocalStorage wrote it: a JSON string or an unexpired envelope. */
function readCredential(key: string): string | null {
	try {
		const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
		if (typeof parsed === 'string') return parsed || null;
		if (parsed && typeof parsed.value === 'string') {
			if (typeof parsed.expiry === 'number' && parsed.expiry < Date.now()) return null;
			return parsed.value || null;
		}
		return null;
	} catch {
		return null;
	}
}

/** The provider logins this browser can prove, in the order a restore tries them. */
export function syncIdentities(): SyncIdentity[] {
	const identities: SyncIdentity[] = [];
	const [clientId, clientSecret, refreshToken] = [
		'rd:clientId',
		'rd:clientSecret',
		'rd:refreshToken',
	].map(readCredential);
	const rdKey = readCredential('rd:accessToken');
	if (clientId && clientSecret && refreshToken) {
		identities.push({ service: 'rd', clientId, clientSecret, refreshToken });
	} else if (rdKey) {
		identities.push({ service: 'rd', apiKey: rdKey });
	}

	// OAuth token before pasted key for Premiumize and Debrid-Link, as usePremiumizeCredential does.
	const others: [Exclude<SyncService, 'rd'>, string[]][] = [
		['tb', ['tb:apiKey']],
		['ad', ['ad:apiKey']],
		['pm', ['pm:accessToken', 'pm:apiKey']],
		['oc', ['oc:apiKey']],
		['dl', ['dl:accessToken', 'dl:apiKey']],
		// Last: a provider login is the identity when there is one; the sponsor key
		// stands on its own only for a sponsor with no debrid login (NZB-only zurg).
		['dmm', ['dmm:apiKey']],
	];
	for (const [service, keys] of others) {
		const apiKey = keys.map(readCredential).find(Boolean);
		if (apiKey) identities.push({ service, apiKey });
	}
	return identities;
}

function send(method: 'PUT' | 'POST' | 'DELETE', body: unknown): Promise<Response> {
	return fetch('/api/browser-state', {
		method,
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export function saveBrowserState(
	identities: SyncIdentity[],
	state: BrowserState
): Promise<boolean> {
	return send('PUT', { identities, state }).then(
		(res) => res.ok,
		() => false
	);
}

/**
 * The state saved behind this login, or null when there is none (204).
 * Authentication failures are not evidence that nothing is saved: a blocked
 * provider or a newly enrolled key may work on the next login event.
 */
export async function fetchBrowserState(identity: SyncIdentity): Promise<BrowserState | null> {
	const res = await send('POST', { identity });
	if (res.status === 204) return null;
	if (res.status !== 200) throw new Error(`browser-state answered ${res.status}`);
	const { state } = await res.json();
	return state ?? null;
}

export function forgetBrowserState(identities: SyncIdentity[]): Promise<boolean> {
	return send('DELETE', { identities }).then(
		(res) => res.ok,
		() => false
	);
}
