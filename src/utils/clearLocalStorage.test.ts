import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDlKeys, clearRdKeys } from './clearLocalStorage';

describe('clearLocalStorage', () => {
	let localStorageMock: Storage;
	let dispatchEventSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		const storage: Record<string, string> = {};

		localStorageMock = {
			get length() {
				return Object.keys(storage).length;
			},
			clear: vi.fn(),
			getItem: vi.fn((key: string) => storage[key] || null),
			setItem: vi.fn((key: string, value: string) => {
				storage[key] = value;
			}),
			removeItem: vi.fn((key: string) => {
				delete storage[key];
			}),
			key: vi.fn((index: number) => {
				const keys = Object.keys(storage);
				return keys[index] || null;
			}),
		} as Storage;

		Object.defineProperty(window, 'localStorage', {
			value: localStorageMock,
			writable: true,
		});

		dispatchEventSpy = vi.spyOn(window, 'dispatchEvent') as any;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('clearRdKeys', () => {
		it('removes all keys starting with "rd:"', () => {
			localStorageMock.setItem('rd:token', 'value1');
			localStorageMock.setItem('rd:user', 'value2');
			localStorageMock.setItem('other:key', 'value3');
			localStorageMock.setItem('normalKey', 'value4');

			clearRdKeys();

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('rd:token');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('rd:user');
			expect(localStorageMock.removeItem).not.toHaveBeenCalledWith('other:key');
			expect(localStorageMock.removeItem).not.toHaveBeenCalledWith('normalKey');
		});

		it('dispatches logout event', () => {
			clearRdKeys();

			expect(dispatchEventSpy).toHaveBeenCalledOnce();
			const event = dispatchEventSpy.mock.calls[0][0] as Event;
			expect(event.type).toBe('logout');
		});

		it('handles empty localStorage', () => {
			clearRdKeys();

			expect(localStorageMock.removeItem).not.toHaveBeenCalled();
			expect(dispatchEventSpy).toHaveBeenCalledOnce();
		});

		it('handles localStorage with no rd: keys', () => {
			localStorageMock.setItem('other:key', 'value1');
			localStorageMock.setItem('normalKey', 'value2');

			clearRdKeys();

			expect(localStorageMock.removeItem).not.toHaveBeenCalled();
			expect(dispatchEventSpy).toHaveBeenCalledOnce();
		});

		it('announces each removed key so useLocalStorage stops serving it', () => {
			localStorageMock.setItem('rd:accessToken', 'token');
			localStorageMock.setItem('rd:refreshToken', 'refresh');

			clearRdKeys();

			const notified = dispatchEventSpy.mock.calls
				.map(([event]) => event as Event)
				.filter((event) => event.type === 'local-storage')
				.map((event) => (event as CustomEvent).detail?.key);
			// without these the tokens live on in memory - this path does not reload
			expect(notified).toEqual(expect.arrayContaining(['rd:accessToken', 'rd:refreshToken']));
			expect(dispatchEventSpy.mock.calls.some(([e]) => (e as Event).type === 'logout')).toBe(
				true
			);
		});

		it('handles mixed keys correctly', () => {
			localStorageMock.setItem('rd:', 'value1');
			localStorageMock.setItem('rd:config', 'value2');
			localStorageMock.setItem('rdNotPrefix', 'value3');
			localStorageMock.setItem('prefix:rd:', 'value4');

			clearRdKeys();

			expect(localStorageMock.removeItem).toHaveBeenCalledTimes(2);
			expect(localStorageMock.removeItem).toHaveBeenNthCalledWith(1, 'rd:');
			expect(localStorageMock.removeItem).toHaveBeenNthCalledWith(2, 'rd:config');
			expect(localStorageMock.removeItem).not.toHaveBeenCalledWith('rdNotPrefix');
			expect(localStorageMock.removeItem).not.toHaveBeenCalledWith('prefix:rd:');
		});
	});

	describe('clearDlKeys', () => {
		// A `badToken` kills the whole Debrid-Link session, so all four keys go:
		// leaving `dl:tokenExpiry` behind would keep triggering a refresh against
		// a token that no longer exists.
		it('removes every dl: credential and nothing else', () => {
			localStorageMock.setItem('dl:accessToken', 'token');
			localStorageMock.setItem('dl:refreshToken', 'refresh');
			localStorageMock.setItem('dl:tokenExpiry', '1');
			localStorageMock.setItem('dl:apiKey', 'key');
			localStorageMock.setItem('rd:accessToken', 'other');

			clearDlKeys();

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('dl:accessToken');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('dl:refreshToken');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('dl:tokenExpiry');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('dl:apiKey');
			expect(localStorageMock.removeItem).not.toHaveBeenCalledWith('rd:accessToken');
		});

		it('announces each removed key so useLocalStorage stops serving it', () => {
			localStorageMock.setItem('dl:accessToken', 'token');

			clearDlKeys();

			const notified = dispatchEventSpy.mock.calls
				.map(([event]) => event as Event)
				.filter((event) => event.type === 'local-storage')
				.map((event) => (event as CustomEvent).detail?.key);
			expect(notified).toEqual(expect.arrayContaining(['dl:accessToken']));
			expect(dispatchEventSpy.mock.calls.some(([e]) => (e as Event).type === 'logout')).toBe(
				true
			);
		});
	});
});
