export type AsyncFunction<T> = () => Promise<T>;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runConcurrentFunctions<T>(
	functions: Array<AsyncFunction<T>>,
	concurrency: number,
	delay: number | ((index: number) => Promise<void>)
): Promise<[T[], Error[]]> {
	let currentFunctions: Array<AsyncFunction<T>> = [];
	const results: T[] = [];
	const errors: Error[] = [];

	while (functions.length > 0) {
		if (currentFunctions.length >= concurrency) {
			await sleep(10);
			continue;
		}
		const nextFunction = functions.shift()!;
		currentFunctions.push(nextFunction);
		nextFunction()
			.then(async (result) => {
				results.push(result);
			})
			.catch(async (err) => {
				errors.push(err);
			})
			.finally(async () => {
				if (typeof delay === 'number') await sleep(delay);
				const index = currentFunctions.indexOf(nextFunction);
				currentFunctions.splice(index, 1);
			});
	}

	while (currentFunctions.length > 0) {
		await sleep(10);
	}

	return [results, errors];
}
