import {
	readRdOAuthCredentials,
	readStoredAccessToken,
	writeAccessToken,
} from '@/utils/rdTokenStorage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('rdTokenStorage', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.useRealTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('readStoredAccessToken', () => {
		it('reads the expirable shape useLocalStorage writes', () => {
			const expiry = Date.now() + 3600_000;
			localStorage.setItem('rd:accessToken', JSON.stringify({ value: 'abc', expiry }));

			expect(readStoredAccessToken()).toEqual({ value: 'abc', expiry });
		});

		it('reads a plain token and reports no expiry', () => {
			localStorage.setItem('rd:accessToken', JSON.stringify('plain-token'));

			expect(readStoredAccessToken()).toEqual({ value: 'plain-token', expiry: null });
		});

		it('returns null when absent or unparseable', () => {
			expect(readStoredAccessToken()).toBeNull();
			localStorage.setItem('rd:accessToken', '{not json');
			expect(readStoredAccessToken()).toBeNull();
		});
	});

	describe('writeAccessToken', () => {
		it('stores the token with an expiry derived from expires_in', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

			writeAccessToken('fresh', 3600);

			const stored = readStoredAccessToken();
			expect(stored?.value).toBe('fresh');
			expect(stored?.expiry).toBe(Date.parse('2026-01-01T01:00:00.000Z'));
		});

		it('announces the change so useLocalStorage instances re-read', () => {
			const storageEvents: string[] = [];
			const customEvents: string[] = [];
			const onStorage = (e: Event) => storageEvents.push((e as StorageEvent).key ?? '');
			const onCustom = (e: Event) => customEvents.push((e as CustomEvent).detail?.key);
			window.addEventListener('storage', onStorage);
			window.addEventListener('local-storage', onCustom);

			writeAccessToken('fresh', 3600);

			window.removeEventListener('storage', onStorage);
			window.removeEventListener('local-storage', onCustom);
			expect(storageEvents).toContain('rd:accessToken');
			expect(customEvents).toContain('rd:accessToken');
		});
	});

	describe('readRdOAuthCredentials', () => {
		it('returns the triplet when all three are present', () => {
			localStorage.setItem('rd:clientId', JSON.stringify('cid'));
			localStorage.setItem('rd:clientSecret', JSON.stringify('secret'));
			localStorage.setItem('rd:refreshToken', JSON.stringify('refresh'));

			expect(readRdOAuthCredentials()).toEqual({
				clientId: 'cid',
				clientSecret: 'secret',
				refreshToken: 'refresh',
			});
		});

		it('returns null for an API-token login, which has nothing to refresh with', () => {
			localStorage.setItem('rd:accessToken', JSON.stringify('api-token'));

			expect(readRdOAuthCredentials()).toBeNull();
		});

		it('returns null when the triplet is incomplete', () => {
			localStorage.setItem('rd:clientId', JSON.stringify('cid'));
			localStorage.setItem('rd:clientSecret', JSON.stringify('secret'));

			expect(readRdOAuthCredentials()).toBeNull();
		});
	});
});
