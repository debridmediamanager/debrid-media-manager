import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCachedList, invalidateCachedList, useCachedList } from './useCachedList';

describe('useCachedList', () => {
	beforeEach(() => {
		clearCachedList();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('initial fetch', () => {
		it('fetches on mount and surfaces the data', async () => {
			const fetcher = vi.fn().mockResolvedValue(['a', 'b']);
			const { result } = renderHook(() => useCachedList('k1', fetcher));

			expect(result.current.loading).toBe(true);
			expect(result.current.data).toBeUndefined();

			await waitFor(() => expect(result.current.loading).toBe(false));

			expect(result.current.data).toEqual(['a', 'b']);
			expect(result.current.error).toBeNull();
			expect(fetcher).toHaveBeenCalledTimes(1);
		});

		it('does not fetch when key is null', () => {
			const fetcher = vi.fn();
			const { result } = renderHook(() => useCachedList(null, fetcher));

			expect(result.current.loading).toBe(false);
			expect(result.current.data).toBeUndefined();
			expect(fetcher).not.toHaveBeenCalled();
		});

		it('does not fetch when enabled is false', () => {
			const fetcher = vi.fn();
			const { result } = renderHook(() => useCachedList('k1', fetcher, { enabled: false }));

			expect(result.current.loading).toBe(false);
			expect(fetcher).not.toHaveBeenCalled();
		});
	});

	describe('back-navigation / remount behavior', () => {
		it('serves cached data synchronously on remount without refetching', async () => {
			const fetcher = vi.fn().mockResolvedValue(['cached-item']);

			// First mount: page is visited
			const first = renderHook(() => useCachedList('browse:recent', fetcher));
			await waitFor(() => expect(first.result.current.loading).toBe(false));
			expect(first.result.current.data).toEqual(['cached-item']);
			expect(fetcher).toHaveBeenCalledTimes(1);

			// User clicks a poster → page unmounts
			first.unmount();

			// User presses back → page remounts
			const second = renderHook(() => useCachedList('browse:recent', fetcher));

			// Data is available immediately, no loading flash, no refetch
			expect(second.result.current.data).toEqual(['cached-item']);
			expect(second.result.current.loading).toBe(false);
			expect(fetcher).toHaveBeenCalledTimes(1);
		});

		it('serves cache across many remounts within TTL', async () => {
			const fetcher = vi.fn().mockResolvedValue({ items: [1, 2, 3] });

			const first = renderHook(() => useCachedList('trakt:watchlist', fetcher));
			await waitFor(() => expect(first.result.current.loading).toBe(false));
			first.unmount();

			for (let i = 0; i < 5; i++) {
				const { result, unmount } = renderHook(() =>
					useCachedList('trakt:watchlist', fetcher)
				);
				expect(result.current.loading).toBe(false);
				expect(result.current.data).toEqual({ items: [1, 2, 3] });
				unmount();
			}

			expect(fetcher).toHaveBeenCalledTimes(1);
		});

		it('refetches when remounting after TTL expiry', async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			const fetcher = vi.fn().mockResolvedValueOnce(['v1']).mockResolvedValueOnce(['v2']);

			const first = renderHook(() => useCachedList('k1', fetcher, { ttlMs: 1000 }));
			await vi.waitFor(() => expect(first.result.current.data).toEqual(['v1']));
			first.unmount();

			// Advance past TTL
			await act(async () => {
				await vi.advanceTimersByTimeAsync(1500);
			});

			const second = renderHook(() => useCachedList('k1', fetcher, { ttlMs: 1000 }));
			// Should start loading again (stale)
			expect(second.result.current.loading).toBe(true);
			await vi.waitFor(() => expect(second.result.current.data).toEqual(['v2']));
			expect(fetcher).toHaveBeenCalledTimes(2);
		});
	});

	describe('key changes', () => {
		it('refetches when the key changes', async () => {
			const fetcher = vi.fn((key: string) => Promise.resolve(`data-for-${key}`));

			const { result, rerender } = renderHook(({ k }) => useCachedList(k, () => fetcher(k)), {
				initialProps: { k: 'key-a' },
			});

			await waitFor(() => expect(result.current.data).toBe('data-for-key-a'));

			rerender({ k: 'key-b' });
			await waitFor(() => expect(result.current.data).toBe('data-for-key-b'));

			expect(fetcher).toHaveBeenCalledTimes(2);
		});

		it('keeps separate cache entries per key', async () => {
			const fetcher = vi.fn((key: string) => Promise.resolve(`data-for-${key}`));

			const hook = renderHook(({ k }) => useCachedList(k, () => fetcher(k)), {
				initialProps: { k: 'a' },
			});
			await waitFor(() => expect(hook.result.current.data).toBe('data-for-a'));

			hook.rerender({ k: 'b' });
			await waitFor(() => expect(hook.result.current.data).toBe('data-for-b'));

			// Switching back to 'a' — should hit cache, no refetch
			const callsBefore = fetcher.mock.calls.length;
			hook.rerender({ k: 'a' });
			await waitFor(() => expect(hook.result.current.data).toBe('data-for-a'));
			expect(fetcher).toHaveBeenCalledTimes(callsBefore);
		});
	});

	describe('error handling', () => {
		it('surfaces errors and does not cache them', async () => {
			const fetcher = vi
				.fn()
				.mockRejectedValueOnce(new Error('network'))
				.mockResolvedValueOnce(['ok']);

			const first = renderHook(() => useCachedList('k1', fetcher));
			await waitFor(() => expect(first.result.current.loading).toBe(false));
			expect(first.result.current.error).toEqual(new Error('network'));
			expect(first.result.current.data).toBeUndefined();
			first.unmount();

			// Remount — because the error was not cached, a fresh fetch runs
			const second = renderHook(() => useCachedList('k1', fetcher));
			await waitFor(() => expect(second.result.current.data).toEqual(['ok']));
			expect(fetcher).toHaveBeenCalledTimes(2);
		});

		it('wraps non-Error throws into an Error instance', async () => {
			const fetcher = vi.fn().mockRejectedValue('string rejection');
			const { result } = renderHook(() => useCachedList('k1', fetcher));

			await waitFor(() => expect(result.current.error).not.toBeNull());
			expect(result.current.error).toBeInstanceOf(Error);
			expect(result.current.error?.message).toBe('string rejection');
		});
	});

	describe('refetch', () => {
		it('forces a fresh fetch and updates the cache', async () => {
			const fetcher = vi.fn().mockResolvedValueOnce(['v1']).mockResolvedValueOnce(['v2']);

			const { result } = renderHook(() => useCachedList('k1', fetcher));
			await waitFor(() => expect(result.current.data).toEqual(['v1']));

			await act(async () => {
				await result.current.refetch();
			});

			expect(result.current.data).toEqual(['v2']);
			expect(fetcher).toHaveBeenCalledTimes(2);

			// Remount — should get refetched v2 from cache
			const second = renderHook(() => useCachedList('k1', fetcher));
			expect(second.result.current.data).toEqual(['v2']);
			expect(fetcher).toHaveBeenCalledTimes(2);
		});
	});

	describe('reset', () => {
		it('clears data, error, and cache for the key', async () => {
			const fetcher = vi.fn().mockResolvedValue(['v1']);

			const first = renderHook(() => useCachedList('k1', fetcher));
			await waitFor(() => expect(first.result.current.data).toEqual(['v1']));

			act(() => {
				first.result.current.reset();
			});

			expect(first.result.current.data).toBeUndefined();
			expect(first.result.current.error).toBeNull();

			// Remount — cache is gone, so fetcher runs again
			first.unmount();
			const second = renderHook(() => useCachedList('k1', fetcher));
			await waitFor(() => expect(second.result.current.data).toEqual(['v1']));
			expect(fetcher).toHaveBeenCalledTimes(2);
		});

		it('does not affect other keys', async () => {
			const fetcher = vi.fn((k: string) => Promise.resolve(`for-${k}`));

			const hookA = renderHook(() => useCachedList('a', () => fetcher('a')));
			const hookB = renderHook(() => useCachedList('b', () => fetcher('b')));
			await waitFor(() => expect(hookA.result.current.data).toBe('for-a'));
			await waitFor(() => expect(hookB.result.current.data).toBe('for-b'));

			act(() => {
				hookA.result.current.reset();
			});

			expect(hookB.result.current.data).toBe('for-b');

			// Remount B — still from cache
			const callsBefore = fetcher.mock.calls.length;
			hookB.unmount();
			const hookB2 = renderHook(() => useCachedList('b', () => fetcher('b')));
			expect(hookB2.result.current.data).toBe('for-b');
			expect(fetcher).toHaveBeenCalledTimes(callsBefore);
		});
	});

	describe('module-level cache helpers', () => {
		it('clearCachedList removes all entries', async () => {
			const fetcher = vi.fn((k: string) => Promise.resolve(`for-${k}`));

			const hookA = renderHook(() => useCachedList('a', () => fetcher('a')));
			await waitFor(() => expect(hookA.result.current.data).toBe('for-a'));
			hookA.unmount();

			clearCachedList();

			// Remount — cache is gone
			const second = renderHook(() => useCachedList('a', () => fetcher('a')));
			expect(second.result.current.loading).toBe(true);
			await waitFor(() => expect(second.result.current.data).toBe('for-a'));
			expect(fetcher).toHaveBeenCalledTimes(2);
		});

		it('invalidateCachedList removes a single entry', async () => {
			const fetcher = vi.fn((k: string) => Promise.resolve(`for-${k}`));

			const hookA = renderHook(() => useCachedList('a', () => fetcher('a')));
			const hookB = renderHook(() => useCachedList('b', () => fetcher('b')));
			await waitFor(() => expect(hookA.result.current.data).toBe('for-a'));
			await waitFor(() => expect(hookB.result.current.data).toBe('for-b'));
			hookA.unmount();
			hookB.unmount();

			invalidateCachedList('a');

			// 'a' is gone, 'b' is still cached
			const callsBefore = fetcher.mock.calls.length;
			const hookA2 = renderHook(() => useCachedList('a', () => fetcher('a')));
			const hookB2 = renderHook(() => useCachedList('b', () => fetcher('b')));

			expect(hookB2.result.current.data).toBe('for-b');
			expect(hookA2.result.current.loading).toBe(true);
			await waitFor(() => expect(hookA2.result.current.data).toBe('for-a'));
			expect(fetcher).toHaveBeenCalledTimes(callsBefore + 1);
		});
	});

	describe('unmount safety', () => {
		it('does not set state after unmount', async () => {
			let resolveFetch!: (v: string[]) => void;
			const fetcher = vi.fn(
				() =>
					new Promise<string[]>((resolve) => {
						resolveFetch = resolve;
					})
			);

			const { unmount } = renderHook(() => useCachedList('k1', fetcher));
			unmount();

			const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			await act(async () => {
				resolveFetch(['late']);
				await Promise.resolve();
			});

			// React would log a warning if setState was called on an unmounted component
			expect(warnSpy).not.toHaveBeenCalled();
			warnSpy.mockRestore();
		});
	});
});
