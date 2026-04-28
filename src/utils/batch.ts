import { delay as sleep } from '@/utils/delay';

export type AsyncFunction<T> = () => Promise<T>;

export async function runConcurrentFunctions<T>(
	functions: Array<AsyncFunction<T>>,
	concurrency: number,
	delay: number | ((index: number) => Promise<void>),
	onProgress?: (completed: number, total: number, errors: number) => void
): Promise<[T[], Error[]]> {
	const results: T[] = [];
	const errors: Error[] = [];
	const total = functions.length;
	let completed = 0;
	let running = 0;
	let resolveSlot: (() => void) | null = null;

	function waitForSlot(): Promise<void> {
		if (running < concurrency) return Promise.resolve();
		return new Promise((resolve) => {
			resolveSlot = resolve;
		});
	}

	function onTaskDone() {
		running--;
		completed++;
		if (onProgress) {
			onProgress(completed, total, errors.length);
		}
		if (resolveSlot) {
			const resolve = resolveSlot;
			resolveSlot = null;
			resolve();
		}
	}

	const pending: Promise<void>[] = [];

	for (const fn of functions) {
		await waitForSlot();
		running++;
		const task = fn()
			.then((result) => {
				results.push(result);
			})
			.catch((err) => {
				errors.push(err);
			})
			.then(async () => {
				if (typeof delay === 'number' && delay > 0) await sleep(delay);
				onTaskDone();
			});
		pending.push(task);
	}

	await Promise.all(pending);

	return [results, errors];
}
