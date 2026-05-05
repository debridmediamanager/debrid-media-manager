import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getLocalStorageBoolean,
	getLocalStorageItem,
	getLocalStorageItemOrDefault,
	getLocalStorageString,
} from './browserStorage';

describe('browserStorage', () => {
	beforeEach(() => {
		// Clear localStorage before each test
		localStorage.clear();
		vi.clearAllMocks();
	});

	describe('getLocalStorageItem', () => {
		it('returns item from localStorage', () => {
			localStorage.setItem('testKey', 'testValue');
			expect(getLocalStorageItem('testKey')).toBe('testValue');
		});

		it('returns null when item does not exist', () => {
			expect(getLocalStorageItem('nonExistentKey')).toBeNull();
		});

		it('returns null when localStorage throws an error', () => {
			const spy = vi.spyOn(Storage.prototype, 'getItem');
			spy.mockImplementation(() => {
				throw new Error('Storage error');
			});
			expect(getLocalStorageItem('testKey')).toBeNull();
			spy.mockRestore();
		});
	});

	describe('getLocalStorageItemOrDefault', () => {
		it('returns stored value when it exists', () => {
			localStorage.setItem('testKey', 'storedValue');
			expect(getLocalStorageItemOrDefault('testKey', 'defaultValue')).toBe('storedValue');
		});

		it('returns fallback when value does not exist', () => {
			expect(getLocalStorageItemOrDefault('nonExistentKey', 'defaultValue')).toBe(
				'defaultValue'
			);
		});

		it('returns fallback when stored value is null', () => {
			const spy = vi.spyOn(Storage.prototype, 'getItem');
			spy.mockReturnValue(null);
			expect(getLocalStorageItemOrDefault('testKey', 'defaultValue')).toBe('defaultValue');
			spy.mockRestore();
		});
	});

	describe('getLocalStorageString', () => {
		it('returns raw strings stored directly', () => {
			localStorage.setItem('apiKey', 'raw-key');
			expect(getLocalStorageString('apiKey')).toBe('raw-key');
		});

		it('returns parsed strings stored by useLocalStorage', () => {
			localStorage.setItem('apiKey', JSON.stringify('json-key'));
			expect(getLocalStorageString('apiKey')).toBe('json-key');
		});

		it('returns null when value does not exist', () => {
			expect(getLocalStorageString('missingKey')).toBeNull();
		});
	});

	describe('getLocalStorageBoolean', () => {
		it('returns true when value is "true"', () => {
			localStorage.setItem('boolKey', 'true');
			expect(getLocalStorageBoolean('boolKey', false)).toBe(true);
		});

		it('returns false when value is "false"', () => {
			localStorage.setItem('boolKey', 'false');
			expect(getLocalStorageBoolean('boolKey', true)).toBe(false);
		});

		it('returns false when value is any other string', () => {
			localStorage.setItem('boolKey', 'notBoolean');
			expect(getLocalStorageBoolean('boolKey', true)).toBe(false);
		});

		it('returns fallback when value does not exist', () => {
			expect(getLocalStorageBoolean('nonExistentKey', true)).toBe(true);
			expect(getLocalStorageBoolean('nonExistentKey', false)).toBe(false);
		});

		it('returns fallback when value is null', () => {
			const spy = vi.spyOn(Storage.prototype, 'getItem');
			spy.mockReturnValue(null);
			expect(getLocalStorageBoolean('testKey', true)).toBe(true);
			spy.mockRestore();
		});
	});
});
