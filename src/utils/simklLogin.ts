import {
	SIMKL_REDIRECT_PATH,
	buildSimklAuthorizeUrl,
	createCodeVerifier,
	createState,
	deriveCodeChallenge,
	getSimklClientId,
} from '@/services/simkl';

/**
 * The browser's half of the Simkl AUTH V2 PKCE login.
 *
 * The verifier and the state live in `sessionStorage`, not `localStorage`: they
 * are worth exactly one redirect, and a tab that is closed mid-login should not
 * leave a usable half of a handshake behind. `takeSimklLoginContext` clears them
 * as it reads, so a replayed `?code=` cannot ride a verifier that was already
 * spent.
 */

export const SIMKL_VERIFIER_KEY = 'simkl:pkceVerifier';
export const SIMKL_STATE_KEY = 'simkl:oauthState';

export const simklRedirectUri = (origin: string): string => `${origin}${SIMKL_REDIRECT_PATH}`;

export const SIMKL_SESSION_EVENT = 'simkl-session-change';
export const SIMKL_SESSION_SENTINEL = 'simkl:sessionChange';
let sessionGeneration = 0;

/** Upgrade cleanup only: never read or migrate legacy provider credentials. */
export function purgeLegacySimklCredentials(): void {
	try {
		['simkl:accessToken', 'simkl:refreshToken', 'simkl:tokenExpiry', 'simkl:userId'].forEach(
			(key) => window.localStorage.removeItem(key)
		);
	} catch {
		// Cookie-backed sessions also work when browser storage is disabled.
	}
}

export const getSimklSessionGeneration = (): number => sessionGeneration;

export function notifySimklSessionChange(): void {
	sessionGeneration++;
	purgeLegacySimklCredentials();
	window.dispatchEvent(new Event(SIMKL_SESSION_EVENT));
	try {
		window.localStorage.setItem(SIMKL_SESSION_SENTINEL, crypto.randomUUID());
	} catch {
		// Same-tab listeners still receive the event.
	}
}

let storageListenerInstalled = false;

/** One generation per cross-tab event, shared by all mounted consumers. */
export function subscribeSimklSessionChange(listener: () => void): () => void {
	if (!storageListenerInstalled) {
		window.addEventListener('storage', (event) => {
			if (event.key !== SIMKL_SESSION_SENTINEL && event.key !== null) return;
			sessionGeneration++;
			purgeLegacySimklCredentials();
			window.dispatchEvent(new Event(SIMKL_SESSION_EVENT));
		});
		storageListenerInstalled = true;
	}
	window.addEventListener(SIMKL_SESSION_EVENT, listener);
	return () => window.removeEventListener(SIMKL_SESSION_EVENT, listener);
}

/**
 * Mints a PKCE pair, parks it for the callback and returns the consent URL.
 *
 * Throws when no client id is configured, which is what a self-hosted instance
 * without its own registration hits - a caller that redirected anyway would send
 * the user to a Simkl error page instead of telling them what is missing.
 */
export async function beginSimklLogin(origin: string): Promise<string> {
	const clientId = getSimklClientId();
	if (!clientId) {
		throw new Error('Simkl is not configured on this instance');
	}

	const codeVerifier = createCodeVerifier();
	const state = createState();
	const codeChallenge = await deriveCodeChallenge(codeVerifier);
	sessionStorage.setItem(SIMKL_VERIFIER_KEY, codeVerifier);
	sessionStorage.setItem(SIMKL_STATE_KEY, state);

	return buildSimklAuthorizeUrl({
		clientId,
		redirectUri: simklRedirectUri(origin),
		codeChallenge,
		state,
	});
}

/** Reads the parked handshake and clears it, whether or not the state matches. */
export function takeSimklLoginContext(): { codeVerifier: string; state: string } | null {
	const codeVerifier = sessionStorage.getItem(SIMKL_VERIFIER_KEY);
	const state = sessionStorage.getItem(SIMKL_STATE_KEY);
	sessionStorage.removeItem(SIMKL_VERIFIER_KEY);
	sessionStorage.removeItem(SIMKL_STATE_KEY);
	if (!codeVerifier || !state) return null;
	return { codeVerifier, state };
}
