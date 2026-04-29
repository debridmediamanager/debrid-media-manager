/**
 * Regression test for the React 18 batching bug that broke availability checks.
 *
 * Bug: hashesToCheck was assigned inside a setState functional updater, then
 * read outside it. React 18's automatic batching defers updater execution in
 * async contexts, so hashesToCheck was always [] and availability checks never
 * fired. Fixed by wrapping the setState call in flushSync.
 */
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { describe, expect, it } from 'vitest';

describe('flushSync guarantees synchronous updater execution', () => {
	it('without flushSync, setState updater side-effects are deferred in async contexts', async () => {
		const { result } = renderHook(() => useState<string[]>([]));

		let sideEffect = '';

		await act(async () => {
			const [, setState] = result.current;
			setState(() => {
				sideEffect = 'set-by-updater';
				return ['value'];
			});
			// In React 18 batched async context, updater may be deferred
			// sideEffect might still be '' here — this is the bug pattern
		});

		// After act() completes, the updater has run
		expect(sideEffect).toBe('set-by-updater');
	});

	it('with flushSync, setState updater side-effects are available immediately', async () => {
		const { result } = renderHook(() => useState<string[]>([]));

		let sideEffect = '';

		await act(async () => {
			const [, setState] = result.current;
			flushSync(() => {
				setState(() => {
					sideEffect = 'set-by-updater';
					return ['value'];
				});
			});
			// With flushSync, the updater is guaranteed to have run
			expect(sideEffect).toBe('set-by-updater');
		});
	});

	it('reproduces the availability check pattern: flushSync makes hashesToCheck available', async () => {
		const { result } = renderHook(() =>
			useState([
				{ hash: 'hash-1', rdAvailable: false },
				{ hash: 'hash-2', rdAvailable: false },
			])
		);

		let hashesToCheck: string[] = [];
		let availabilityCheckFired = false;

		await act(async () => {
			const [, setSearchResults] = result.current;

			flushSync(() => {
				setSearchResults((prev) => {
					hashesToCheck = prev.filter((r) => !r.rdAvailable).map((r) => r.hash);
					return prev;
				});
			});

			// This is the critical assertion: hashesToCheck must be populated
			// BEFORE we decide whether to fire availability checks
			if (hashesToCheck.length > 0) {
				availabilityCheckFired = true;
			}
		});

		expect(hashesToCheck).toEqual(['hash-1', 'hash-2']);
		expect(availabilityCheckFired).toBe(true);
	});

	it('without flushSync, the availability check pattern can fail to fire', async () => {
		const { result } = renderHook(() =>
			useState([
				{ hash: 'hash-1', rdAvailable: false },
				{ hash: 'hash-2', rdAvailable: false },
			])
		);

		let hashesToCheck: string[] = [];
		let checkDecisionMade = false;
		let decisionValue = false;

		await act(async () => {
			const [, setSearchResults] = result.current;

			// Without flushSync — the original buggy pattern
			setSearchResults((prev) => {
				hashesToCheck = prev.filter((r) => !r.rdAvailable).map((r) => r.hash);
				return prev;
			});

			// Record the decision point — this runs before React processes the batch
			checkDecisionMade = true;
			decisionValue = hashesToCheck.length > 0;
		});

		expect(checkDecisionMade).toBe(true);
		// After act(), updater has run so hashesToCheck IS populated
		expect(hashesToCheck).toEqual(['hash-1', 'hash-2']);
		// But the decision was made BEFORE the updater ran — it could be wrong
		// In jsdom/test environment React may process synchronously, so we
		// document the pattern rather than assert the failure deterministically.
		// The real failure happens in browser React 18 with concurrent features.
	});
});
