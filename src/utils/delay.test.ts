import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delay } from './delay';

describe('delay', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('resolves immediately for ms = 0', async () => {
		const result = delay(0);
		expect(result).toBeInstanceOf(Promise);
		await result;
	});

	it('resolves immediately for negative ms', async () => {
		const result = delay(-100);
		expect(result).toBeInstanceOf(Promise);
		await result;
	});

	it('returns a promise', () => {
		const result = delay(100);
		expect(result).toBeInstanceOf(Promise);
		vi.advanceTimersByTime(100);
	});

	it('resolves after the specified timeout in non-browser env', async () => {
		let resolved = false;
		delay(1000).then(() => {
			resolved = true;
		});

		vi.advanceTimersByTime(999);
		await Promise.resolve();
		expect(resolved).toBe(false);

		vi.advanceTimersByTime(1);
		await Promise.resolve();
		expect(resolved).toBe(true);
	});

	it('does not resolve before timeout elapses', async () => {
		let resolved = false;
		delay(500).then(() => {
			resolved = true;
		});

		vi.advanceTimersByTime(499);
		await Promise.resolve();
		expect(resolved).toBe(false);
	});
});
