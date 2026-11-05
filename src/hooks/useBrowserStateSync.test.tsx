import { SYNC_ENABLED_KEY } from '@/utils/browserStateKeys';
import { fetchBrowserState, saveBrowserState } from '@/utils/browserStateSync';
import { act, renderHook } from '@testing-library/react';
import toast from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLocalStorageChange } from './localStorage';
import { RESTORE_TRIED_KEY, useBrowserStateSync } from './useBrowserStateSync';

vi.mock('@/utils/browserStateSync', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/browserStateSync')>()),
	fetchBrowserState: vi.fn(),
	saveBrowserState: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const fetchMock = vi.mocked(fetchBrowserState);
const saveMock = vi.mocked(saveBrowserState);
const TB = { service: 'tb', apiKey: 'tb-key' } as const;

/** Write a key the way the app does, announcing it to this tab. */
const write = (key: string, value: string) =>
	act(() => {
		localStorage.setItem(key, value);
		notifyLocalStorageChange(key);
	});
const flush = () => act(async () => {});

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
	vi.useFakeTimers();
	fetchMock.mockResolvedValue(null);
	saveMock.mockResolvedValue(true);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('restore', () => {
	it('does nothing in a browser with no login', async () => {
		renderHook(() => useBrowserStateSync());
		await flush();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(localStorage.getItem(RESTORE_TRIED_KEY)).toBeNull();
	});

	// After a deploy every logged-in browser mounts this at once; none of them may ask.
	it('marks an already logged-in browser as tried without asking', async () => {
		localStorage.setItem('tb:apiKey', '"tb-key"');
		renderHook(() => useBrowserStateSync());
		await flush();
		expect(localStorage.getItem(RESTORE_TRIED_KEY)).not.toBeNull();

		write('settings:player', '"vlc"');
		await flush();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('restores the saved state when a fresh browser logs in, and says so', async () => {
		fetchMock.mockResolvedValue({ 'ad:apiKey': '"ad-key"', 'settings:player': '"vlc"' });
		renderHook(() => useBrowserStateSync());

		write('tb:apiKey', '"tb-key"');
		await flush();

		expect(fetchMock).toHaveBeenCalledWith(TB);
		expect(localStorage.getItem('ad:apiKey')).toBe('"ad-key"');
		expect(localStorage.getItem('settings:player')).toBe('"vlc"');
		expect(toast.success).toHaveBeenCalledWith(
			'Welcome back: your logins and settings were restored'
		);
		expect(localStorage.getItem(RESTORE_TRIED_KEY)).not.toBeNull();
	});

	// Through the real fetchBrowserState, so the status mapping is what is tested.
	it.each([
		[204, true],
		[401, false],
		[403, false],
		[429, false],
		[503, false],
	])('after a %i answer, marks the browser as tried: %s', async (status, tried) => {
		const actual = await vi.importActual<typeof import('@/utils/browserStateSync')>(
			'@/utils/browserStateSync'
		);
		fetchMock.mockImplementation(actual.fetchBrowserState);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status }));

		renderHook(() => useBrowserStateSync());
		write('tb:apiKey', '"tb-key"');
		await flush();

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem(RESTORE_TRIED_KEY) !== null).toBe(tried);
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('restores only once while several login keys land', async () => {
		let answer: (state: null) => void = () => {};
		fetchMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
		renderHook(() => useBrowserStateSync());

		// Real-Debrid's login writes several keys in a row while the request is in flight.
		write('tb:apiKey', '"tb-key"');
		write('ad:apiKey', '"ad-key"');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await act(async () => answer(null));
		write('pm:apiKey', '"pm-key"');
		renderHook(() => useBrowserStateSync());
		await flush();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('asks again on the next login event after a request that got no answer', async () => {
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		renderHook(() => useBrowserStateSync());

		write('tb:apiKey', '"tb-key"');
		await flush();
		expect(localStorage.getItem(RESTORE_TRIED_KEY)).toBeNull();

		write('ad:apiKey', '"ad-key"');
		await flush();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(localStorage.getItem(RESTORE_TRIED_KEY)).not.toBeNull();
	});

	it.each([401, 503])(
		'retries a %i restore after remount instead of treating the login as established',
		async (status) => {
			const actual = await vi.importActual<typeof import('@/utils/browserStateSync')>(
				'@/utils/browserStateSync'
			);
			fetchMock.mockImplementation(actual.fetchBrowserState);
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValueOnce({ status }).mockResolvedValueOnce({ status: 204 })
			);
			const first = renderHook(() => useBrowserStateSync());
			write('tb:apiKey', '"tb-key"');
			await flush();
			first.unmount();

			renderHook(() => useBrowserStateSync());
			await flush();
			expect(fetch).toHaveBeenCalledTimes(2);
			expect(localStorage.getItem(RESTORE_TRIED_KEY)).toBe('1');
		}
	);
});

describe('push', () => {
	beforeEach(() => {
		localStorage.setItem(RESTORE_TRIED_KEY, '1');
		localStorage.setItem('tb:apiKey', '"tb-key"');
	});

	it('saves synced changes 1.5 s after the last one while the setting is on', async () => {
		localStorage.setItem(SYNC_ENABLED_KEY, 'true');
		renderHook(() => useBrowserStateSync());

		write('settings:player', '"vlc"');
		await act(() => vi.advanceTimersByTimeAsync(1000));
		write('settings:movieMaxSize', '"15"');
		await act(() => vi.advanceTimersByTimeAsync(1499));
		expect(saveMock).not.toHaveBeenCalled();

		await act(() => vi.advanceTimersByTimeAsync(1));
		expect(saveMock).toHaveBeenCalledTimes(1);
		expect(saveMock).toHaveBeenCalledWith([TB], {
			'tb:apiKey': '"tb-key"',
			[SYNC_ENABLED_KEY]: 'true',
			'settings:player': '"vlc"',
			'settings:movieMaxSize': '"15"',
		});
	});

	it('ignores keys that are not synced', async () => {
		localStorage.setItem(SYNC_ENABLED_KEY, 'true');
		renderHook(() => useBrowserStateSync());
		write('rd:castToken', '"x"');
		await act(() => vi.advanceTimersByTimeAsync(2000));
		expect(saveMock).not.toHaveBeenCalled();
	});

	it('does not save for a refreshed access token alone, but carries it in the next save', async () => {
		localStorage.setItem(SYNC_ENABLED_KEY, 'true');
		renderHook(() => useBrowserStateSync());
		write('rd:accessToken', '{"value":"fresh","expiry":9999999999999}');
		await act(() => vi.advanceTimersByTimeAsync(2000));
		expect(saveMock).not.toHaveBeenCalled();

		write('settings:player', '"vlc"');
		await act(() => vi.advanceTimersByTimeAsync(1500));
		expect(saveMock).toHaveBeenCalledTimes(1);
		expect(saveMock.mock.calls[0][1]['rd:accessToken']).toBe(
			'{"value":"fresh","expiry":9999999999999}'
		);
	});

	it('saves nothing while the setting is off', async () => {
		renderHook(() => useBrowserStateSync());
		write('settings:player', '"vlc"');
		await act(() => vi.advanceTimersByTimeAsync(2000));
		expect(saveMock).not.toHaveBeenCalled();
	});

	it('saves the restored browser under its own logins', async () => {
		localStorage.clear();
		fetchMock.mockResolvedValue({ [SYNC_ENABLED_KEY]: 'true', 'ad:apiKey': '"ad-key"' });

		renderHook(() => useBrowserStateSync());
		write('tb:apiKey', '"tb-key"');
		await flush();
		await act(() => vi.advanceTimersByTimeAsync(1500));

		expect(saveMock).toHaveBeenCalledTimes(1);
		expect(saveMock.mock.calls[0][0]).toEqual([TB, { service: 'ad', apiKey: 'ad-key' }]);
	});

	it('waits for the restore before saving anything', async () => {
		localStorage.clear();
		localStorage.setItem(SYNC_ENABLED_KEY, 'true');
		fetchMock.mockReturnValue(new Promise(() => {}));

		renderHook(() => useBrowserStateSync());
		write('tb:apiKey', '"tb-key"');
		write('settings:player', '"vlc"');
		await act(() => vi.advanceTimersByTimeAsync(2000));
		expect(saveMock).not.toHaveBeenCalled();
	});
});
