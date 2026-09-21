import { describe, expect, it, vi } from 'vitest';

const { CLIENT_ID } = vi.hoisted(() => ({ CLIENT_ID: 'test-client-id' }));

vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { simklClientId: CLIENT_ID } }),
}));

import {
	SIMKL_STATE_KEY,
	SIMKL_VERIFIER_KEY,
	beginSimklLogin,
	simklRedirectUri,
	takeSimklLoginContext,
} from '@/utils/simklLogin';

describe('beginSimklLogin', () => {
	it('parks the handshake and builds a consent URL that matches it', async () => {
		sessionStorage.clear();

		const url = new URL(await beginSimklLogin('https://debridmediamanager.com'));
		const verifier = sessionStorage.getItem(SIMKL_VERIFIER_KEY)!;
		const state = sessionStorage.getItem(SIMKL_STATE_KEY)!;

		expect(verifier).toBeTruthy();
		// The challenge must be the S256 of the parked verifier, not the
		// verifier itself - Simkl rejects `plain` outright.
		expect(url.searchParams.get('code_challenge')).not.toBe(verifier);
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('state')).toBe(state);
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://debridmediamanager.com/auth/simkl'
		);
		expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
	});

	it('mints a fresh verifier per attempt', async () => {
		sessionStorage.clear();
		await beginSimklLogin('https://debridmediamanager.com');
		const first = sessionStorage.getItem(SIMKL_VERIFIER_KEY);
		await beginSimklLogin('https://debridmediamanager.com');
		expect(sessionStorage.getItem(SIMKL_VERIFIER_KEY)).not.toBe(first);
	});
});

describe('takeSimklLoginContext', () => {
	it('returns the parked handshake once and clears it', () => {
		sessionStorage.setItem(SIMKL_VERIFIER_KEY, 'verifier');
		sessionStorage.setItem(SIMKL_STATE_KEY, 'state');

		expect(takeSimklLoginContext()).toEqual({ codeVerifier: 'verifier', state: 'state' });
		// A second read has nothing left, so a replayed `?code=` cannot ride a
		// verifier that was already spent.
		expect(takeSimklLoginContext()).toBeNull();
		expect(sessionStorage.getItem(SIMKL_VERIFIER_KEY)).toBeNull();
	});

	it('returns null when nothing was parked', () => {
		sessionStorage.clear();
		expect(takeSimklLoginContext()).toBeNull();
	});
});

describe('simklRedirectUri', () => {
	it('is the path registered against the client id', () => {
		expect(simklRedirectUri('http://localhost:3000')).toBe('http://localhost:3000/auth/simkl');
	});
});
