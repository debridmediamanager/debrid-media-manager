import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRdKeys } from './clearLocalStorage';

const clearMock = vi.fn();

vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return { clear: clearMock };
	}),
}));

import {
	listSavedAccounts,
	parkCurrentAccount,
	saveCurrentAccount,
	savedAccountsKey,
	switchToSavedAccount,
} from './savedAccounts';

const dad = { id: '1', label: 'dad' };
const son = { id: '2', label: 'son' };

// A real 24h token as useLocalStorage writes it, expiry envelope included.
const dadToken = JSON.stringify({ value: 'dad-access', expiry: Date.now() + 86_400_000 });

function signInDad() {
	localStorage.setItem('rd:accessToken', dadToken);
	localStorage.setItem('rd:clientId', '"dad-client"');
	localStorage.setItem('rd:clientSecret', '"dad-secret"');
	localStorage.setItem('rd:refreshToken', '"dad-device"');
	localStorage.setItem('rd:castToken', '"dad-cast"');
}

describe('savedAccounts', () => {
	beforeEach(() => {
		localStorage.clear();
		clearMock.mockReset();
	});

	it('lists nothing until an account is saved', () => {
		expect(listSavedAccounts('rd:')).toEqual([]);
	});

	it('snapshots every key under the prefix, raw, and nothing else', () => {
		signInDad();
		localStorage.setItem('ad:apiKey', '"other-provider"');
		localStorage.setItem('settings:player', 'web');

		saveCurrentAccount('rd:', dad);

		const [saved] = listSavedAccounts('rd:');
		expect(saved.id).toBe('1');
		expect(saved.label).toBe('dad');
		expect(Object.keys(saved.keys).sort()).toEqual([
			'rd:accessToken',
			'rd:castToken',
			'rd:clientId',
			'rd:clientSecret',
			'rd:refreshToken',
		]);
		expect(saved.keys['rd:accessToken']).toBe(dadToken);
		// The active login stays signed in; saving is not parking.
		expect(localStorage.getItem('rd:accessToken')).toBe(dadToken);
	});

	it('saves nothing when nobody is signed in', () => {
		saveCurrentAccount('rd:', dad);
		expect(localStorage.getItem(savedAccountsKey('rd:'))).toBeNull();
	});

	it('replaces an older snapshot of the same account instead of duplicating it', () => {
		signInDad();
		saveCurrentAccount('rd:', dad);
		localStorage.setItem('rd:accessToken', '"dad-renewed"');
		saveCurrentAccount('rd:', dad);

		const list = listSavedAccounts('rd:');
		expect(list).toHaveLength(1);
		expect(list[0].keys['rd:accessToken']).toBe('"dad-renewed"');
	});

	// The whole point of keeping the store outside the provider prefix: a
	// rejected token sweeps `rd:*`, and the second account must outlive that.
	it('survives the provider key sweep a rejected token triggers', () => {
		signInDad();
		saveCurrentAccount('rd:', dad);
		clearRdKeys();
		expect(localStorage.getItem('rd:accessToken')).toBeNull();
		expect(listSavedAccounts('rd:')).toHaveLength(1);
	});

	it('parks the active login and leaves the prefix empty for a new sign-in', async () => {
		signInDad();
		await parkCurrentAccount('rd:', dad);

		expect(listSavedAccounts('rd:').map((a) => a.id)).toEqual(['1']);
		expect(localStorage.getItem('rd:accessToken')).toBeNull();
		expect(localStorage.getItem('rd:refreshToken')).toBeNull();
		expect(clearMock).toHaveBeenCalledTimes(1);
	});

	it('switches: restores the target, parks the current, clears the library cache', async () => {
		signInDad();
		await parkCurrentAccount('rd:', dad);
		// son signs in with a pasted API key: one plain key, no OAuth triple
		localStorage.setItem('rd:accessToken', '"son-api-key"');
		clearMock.mockReset();

		expect(await switchToSavedAccount('rd:', '1', son)).toBe(true);

		expect(localStorage.getItem('rd:accessToken')).toBe(dadToken);
		expect(localStorage.getItem('rd:clientId')).toBe('"dad-client"');
		expect(localStorage.getItem('rd:castToken')).toBe('"dad-cast"');
		const list = listSavedAccounts('rd:');
		expect(list.map((a) => a.id)).toEqual(['2']);
		expect(list[0].keys).toEqual({ 'rd:accessToken': '"son-api-key"' });
		expect(clearMock).toHaveBeenCalledTimes(1);
	});

	it('switches from a signed-out state without inventing a saved account', async () => {
		signInDad();
		await parkCurrentAccount('rd:', dad);

		expect(await switchToSavedAccount('rd:', '1', null)).toBe(true);

		expect(localStorage.getItem('rd:accessToken')).toBe(dadToken);
		expect(localStorage.getItem(savedAccountsKey('rd:'))).toBeNull();
	});

	// A login page reached with Back still holds the second account's login,
	// which nobody has identified yet. Sweeping it would lose it.
	it('refuses to sweep an active login it was not told about', async () => {
		signInDad();
		await parkCurrentAccount('rd:', dad);
		localStorage.setItem('rd:accessToken', '"son-api-key"');

		expect(await switchToSavedAccount('rd:', '1', null)).toBe(false);

		expect(localStorage.getItem('rd:accessToken')).toBe('"son-api-key"');
		expect(listSavedAccounts('rd:').map((a) => a.id)).toEqual(['1']);
		expect(clearMock).toHaveBeenCalledTimes(1); // the park only
	});

	it('refuses an unknown id and changes nothing', async () => {
		signInDad();
		expect(await switchToSavedAccount('rd:', 'nope', dad)).toBe(false);
		expect(localStorage.getItem('rd:accessToken')).toBe(dadToken);
		expect(listSavedAccounts('rd:')).toEqual([]);
		expect(clearMock).not.toHaveBeenCalled();
	});

	it('keeps providers apart', async () => {
		signInDad();
		localStorage.setItem('ad:apiKey', '"ad-key"');
		await parkCurrentAccount('rd:', dad);
		expect(localStorage.getItem('ad:apiKey')).toBe('"ad-key"');
		expect(listSavedAccounts('ad:')).toEqual([]);
	});

	it('ignores a corrupt store', () => {
		localStorage.setItem(savedAccountsKey('rd:'), '{not json');
		expect(listSavedAccounts('rd:')).toEqual([]);
		localStorage.setItem(savedAccountsKey('rd:'), JSON.stringify([{ id: 1 }, null, 'x']));
		expect(listSavedAccounts('rd:')).toEqual([]);
	});

	it('announces every key it writes or removes so useLocalStorage readers follow', async () => {
		signInDad();
		const seen: string[] = [];
		const spy = vi.spyOn(window, 'dispatchEvent').mockImplementation((event: Event) => {
			const detail = (event as CustomEvent).detail as { key?: string } | undefined;
			if (event.type === 'local-storage' && detail?.key) seen.push(detail.key);
			return true;
		});

		await parkCurrentAccount('rd:', dad);

		expect(seen).toContain('rd:accessToken');
		expect(seen).toContain(savedAccountsKey('rd:'));
		spy.mockRestore();
	});
});
