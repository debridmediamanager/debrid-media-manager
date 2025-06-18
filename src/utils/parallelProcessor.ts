export interface ProcessResult<T> {
	item: T;
	success: boolean;
	error?: Error;
}

/**
 * Process an array of items with a maximum concurrency limit
 * @param items Array of items to process
 * @param processor Async function to process each item
 * @param concurrency Maximum number of concurrent operations
 * @param onProgress Optional callback for progress updates
 * @returns Promise that resolves with results for all items
 */
export async function processWithConcurrency<T>(
	items: T[],
	processor: (item: T) => Promise<void>,
	concurrency: number,
	onProgress?: (completed: number, total: number) => void
): Promise<ProcessResult<T>[]> {
	const queue = [...items];
	const results: ProcessResult<T>[] = [];
	const inProgress = new Map<Promise<ProcessResult<T>>, T>();
	let completed = 0;
	const total = items.length;

	while (queue.length > 0 || inProgress.size > 0) {
		// Start new tasks up to the concurrency limit
		while (inProgress.size < concurrency && queue.length > 0) {
			const item = queue.shift()!;
			const promise = processor(item)
				.then(() => ({ item, success: true }) as ProcessResult<T>)
				.catch((error) => ({ item, success: false, error }) as ProcessResult<T>)
				.finally(() => {
					inProgress.delete(promise);
					completed++;
					if (onProgress) {
						onProgress(completed, total);
					}
				});
			inProgress.set(promise, item);
		}

		// Wait for at least one task to complete before continuing
		if (inProgress.size > 0) {
			const result = await Promise.race(inProgress.keys());
			results.push(result);
		}
	}

	return results;
}
