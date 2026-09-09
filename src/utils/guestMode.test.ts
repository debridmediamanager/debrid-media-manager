import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUEST_MODE_KEY, disableGuestMode, enableGuestMode, isGuestMode } from './guestMode';

describe('guestMode', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it('reads as off with nothing stored', () => {
		expect(isGuestMode()).toBe(false);
	});

	it('turns on and off again', () => {
		enableGuestMode();
		expect(isGuestMode()).toBe(true);

		disableGuestMode();
		expect(isGuestMode()).toBe(false);
		expect(localStorage.getItem(GUEST_MODE_KEY)).toBeNull();
	});

	// The flag is a plain 'true', not JSON-quoted, so a stray value left behind
	// by anything else never reads as guest mode.
	it('only accepts the exact stored marker', () => {
		localStorage.setItem(GUEST_MODE_KEY, '"true"');
		expect(isGuestMode()).toBe(false);

		localStorage.setItem(GUEST_MODE_KEY, 'false');
		expect(isGuestMode()).toBe(false);
	});

	// `handleLogout(undefined)` clears everything, so guest mode ends with it.
	it('does not survive a full localStorage clear', () => {
		enableGuestMode();
		localStorage.clear();
		expect(isGuestMode()).toBe(false);
	});

	it('announces the change so useLocalStorage readers stay in step', () => {
		const dispatched: string[] = [];
		const spy = vi.spyOn(window, 'dispatchEvent').mockImplementation((event: Event) => {
			dispatched.push(event.type);
			return true;
		});

		enableGuestMode();
		expect(dispatched).toContain('local-storage');

		dispatched.length = 0;
		disableGuestMode();
		expect(dispatched).toContain('local-storage');

		spy.mockRestore();
	});

	// A browser with site data blocked throws on every access. Guest mode is a
	// convenience, so it degrades to "off" rather than taking the page down.
	it('survives storage that throws', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(isGuestMode()).toBe(false);

		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => enableGuestMode()).not.toThrow();

		vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => disableGuestMode()).not.toThrow();
	});
});
