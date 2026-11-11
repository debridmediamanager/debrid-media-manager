import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const { CLIENT_ID } = vi.hoisted(() => ({ CLIENT_ID: 'test-client-id' }));

vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { simklClientId: CLIENT_ID } }),
}));

import {
	beginSimklLogin,
	getSimklSessionGeneration,
	notifySimklSessionChange,
	SIMKL_SESSION_SENTINEL,
	SIMKL_STATE_KEY,
	SIMKL_VERIFIER_KEY,
	subscribeSimklSessionChange,
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
		expect(url.searchParams.get('code_challenge')).toBe(
			createHash('sha256').update(verifier).digest('base64url')
		);
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

	it('does not park a usable handshake when PKCE challenge creation fails', async () => {
		sessionStorage.clear();
		const digest = vi
			.spyOn(crypto.subtle, 'digest')
			.mockRejectedValueOnce(new Error('Crypto unavailable'));
		await expect(beginSimklLogin('https://debridmediamanager.com')).rejects.toThrow(
			'Crypto unavailable'
		);
		expect(sessionStorage.getItem(SIMKL_VERIFIER_KEY)).toBeNull();
		expect(sessionStorage.getItem(SIMKL_STATE_KEY)).toBeNull();
		digest.mockRestore();
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

describe('cookie-session notifications', () => {
	it('invalidates same-tab consumers even when local storage is unavailable', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeSimklSessionChange(listener);
		const generation = getSimklSessionGeneration();
		const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('Storage blocked');
		});
		try {
			notifySimklSessionChange();
			expect(listener).toHaveBeenCalledTimes(1);
			expect(getSimklSessionGeneration()).toBe(generation + 1);
		} finally {
			storage.mockRestore();
			unsubscribe();
		}
	});

	it('advances one shared generation for a cross-tab event with multiple subscribers', () => {
		const seen: number[] = [];
		const unsubscribeA = subscribeSimklSessionChange(() =>
			seen.push(getSimklSessionGeneration())
		);
		const unsubscribeB = subscribeSimklSessionChange(() =>
			seen.push(getSimklSessionGeneration())
		);
		const generation = getSimklSessionGeneration();
		window.dispatchEvent(
			new StorageEvent('storage', { key: SIMKL_SESSION_SENTINEL, newValue: 'changed' })
		);
		expect(seen).toEqual([generation + 1, generation + 1]);
		unsubscribeA();
		unsubscribeB();
	});
});
