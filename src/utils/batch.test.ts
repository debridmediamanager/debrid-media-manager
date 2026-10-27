import { describe, expect, it, vi } from 'vitest';
import { runConcurrentFunctions, type AsyncFunction } from './batch';

describe('batch utilities', () => {
	describe('runConcurrentFunctions', () => {
		it('processes functions with specified concurrency', async () => {
			const results: number[] = [];
			const functions: AsyncFunction<number>[] = [
				async () => {
					results.push(1);
					return 1;
				},
				async () => {
					results.push(2);
					return 2;
				},
				async () => {
					results.push(3);
					return 3;
				},
				async () => {
					results.push(4);
					return 4;
				},
			];

			const [data, errors] = await runConcurrentFunctions(functions, 2, 0);

			expect(data).toHaveLength(4);
			expect(errors).toHaveLength(0);
			expect(data.sort()).toEqual([1, 2, 3, 4]);
		});

		// A spaced RD bulk add waits a minute between adds; a wait after the last
		// one only held back the final toast
		it('spaces starts without waiting after the last one', async () => {
			vi.useFakeTimers();
			let settled: unknown = null;
			runConcurrentFunctions([async () => 1, async () => 2], 1, 60_000).then(
				(result) => (settled = result)
			);
			await vi.advanceTimersByTimeAsync(60_000);
			vi.useRealTimers();
			expect(settled).toEqual([[1, 2], []]);
		});

		it('handles errors gracefully', async () => {
			const functions: AsyncFunction<number>[] = [
				async () => 1,
				async () => {
					throw new Error('Test error');
				},
				async () => 3,
			];

			const [data, errors] = await runConcurrentFunctions(functions, 2, 0);

			expect(data).toHaveLength(2);
			expect(errors).toHaveLength(1);
			expect(errors[0].message).toBe('Test error');
		});

		it('respects concurrency limit', async () => {
			let concurrent = 0;
			let maxConcurrent = 0;

			const functions: AsyncFunction<number>[] = Array.from(
				{ length: 10 },
				(_, i) => async () => {
					concurrent++;
					maxConcurrent = Math.max(maxConcurrent, concurrent);
					await new Promise((resolve) => setTimeout(resolve, 10));
					concurrent--;
					return i;
				}
			);

			await runConcurrentFunctions(functions, 3, 0);

			expect(maxConcurrent).toBeLessThanOrEqual(3);
		});

		it('calls progress callback with correct values', async () => {
			const progressUpdates: Array<[number, number, number]> = [];
			const functions: AsyncFunction<number>[] = [
				async () => 1,
				async () => 2,
				async () => {
					throw new Error('error');
				},
				async () => 4,
			];

			const onProgress = vi.fn((completed, total, errors) => {
				progressUpdates.push([completed, total, errors]);
			});

			await runConcurrentFunctions(functions, 2, 0, onProgress);

			expect(onProgress).toHaveBeenCalled();
			expect(progressUpdates[progressUpdates.length - 1]).toEqual([4, 4, 1]);
		});

		it('handles delay between functions', async () => {
			const start = Date.now();
			const functions: AsyncFunction<number>[] = [async () => 1, async () => 2];

			await runConcurrentFunctions(functions, 1, 50);
			const duration = Date.now() - start;

			expect(duration).toBeGreaterThanOrEqual(50);
		});

		it('handles function-based delay', async () => {
			const delayFn = vi.fn(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
			});

			const functions: AsyncFunction<number>[] = [async () => 1, async () => 2];

			await runConcurrentFunctions(functions, 2, delayFn as any);

			expect(delayFn).not.toHaveBeenCalled();
		});

		it('handles empty function array', async () => {
			const [data, errors] = await runConcurrentFunctions([], 2, 0);

			expect(data).toHaveLength(0);
			expect(errors).toHaveLength(0);
		});

		it('handles single function', async () => {
			const functions: AsyncFunction<string>[] = [async () => 'result'];

			const [data, errors] = await runConcurrentFunctions(functions, 1, 0);

			expect(data).toEqual(['result']);
			expect(errors).toHaveLength(0);
		});
	});
});
