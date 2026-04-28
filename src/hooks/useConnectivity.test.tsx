import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectivity } from './useConnectivity';

describe('useConnectivity', () => {
	let originalOnLine: boolean;

	beforeEach(() => {
		originalOnLine = navigator.onLine;
	});

	it('returns true when navigator.onLine is true', () => {
		Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
		const { result } = renderHook(() => useConnectivity());
		expect(result.current).toBe(true);
		Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
	});

	it('returns false when navigator.onLine is false', () => {
		Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
		const { result } = renderHook(() => useConnectivity());
		expect(result.current).toBe(false);
		Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
	});

	it('updates to false when offline event fires', () => {
		Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
		const { result } = renderHook(() => useConnectivity());
		expect(result.current).toBe(true);

		act(() => {
			window.dispatchEvent(new Event('offline'));
		});

		expect(result.current).toBe(false);
		Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
	});

	it('updates to true when online event fires', () => {
		Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
		const { result } = renderHook(() => useConnectivity());
		expect(result.current).toBe(false);

		act(() => {
			window.dispatchEvent(new Event('online'));
		});

		expect(result.current).toBe(true);
		Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
	});

	it('cleans up event listeners on unmount', () => {
		const addSpy = vi.spyOn(window, 'addEventListener');
		const removeSpy = vi.spyOn(window, 'removeEventListener');

		const { unmount } = renderHook(() => useConnectivity());

		expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
		expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));

		unmount();

		expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
		expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));

		addSpy.mockRestore();
		removeSpy.mockRestore();
	});
});
