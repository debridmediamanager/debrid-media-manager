import { HIT_TTL_MS, STORAGE_KEY } from '@/utils/subtitleLanguageCache';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTLE_MS, useSubtitleLanguages } from './useSubtitleLanguages';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const settle = () =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
	});

describe('useSubtitleLanguages', () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: 0 });
		localStorage.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('asks nothing until enabled, then reads the cache before asking', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ [A]: [['gre'], HIT_TTL_MS] }));
		const post = vi.fn();
		vi.stubGlobal('fetch', post);

		const { result, rerender } = renderHook(({ on }) => useSubtitleLanguages([A], on), {
			initialProps: { on: false },
		});
		await settle();
		expect(result.current.languages.size).toBe(0);

		rerender({ on: true });
		await settle();
		expect(result.current.languages.get(A)).toEqual(['gre']);
		expect(post).not.toHaveBeenCalled();
	});

	it('forgets a hit once it expires, so a failed refresh leaves the release unknown', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ [A]: [['gre'], 1000] }));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 500, headers: new Headers() }))
		);

		const { result, rerender } = renderHook(
			({ hashes }) => useSubtitleLanguages(hashes, true),
			{
				initialProps: { hashes: [A] },
			}
		);
		await settle();
		expect(result.current.languages.get(A)).toEqual(['gre']);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		rerender({ hashes: [A, B] });
		await settle();

		expect(result.current.languages.has(A)).toBe(false);
		expect(result.current.checking).toBe(false);
	});

	it('forgets a hash a refresh answers as having no snapshot', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ [A]: [['gre'], 1000] }));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: async () => ({ releases: {} }),
			}))
		);

		const { result, rerender } = renderHook(
			({ hashes }) => useSubtitleLanguages(hashes, true),
			{
				initialProps: { hashes: [A] },
			}
		);
		await settle();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		rerender({ hashes: [A, B] });
		await settle();

		expect(result.current.languages.has(A)).toBe(false);
	});
});
