type AsyncFunction<T> = () => Promise<T>;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runConcurrentFunctions<T>(
	functions: Array<AsyncFunction<T>>,
	concurrency: number,
	delay: number
): Promise<[T[], Error[]]> {
	let currentFunctions: Array<AsyncFunction<T>> = [];
	const results: T[] = [];
	const errors: Error[] = [];

	while (functions.length > 0) {
		if (!(currentFunctions.length < concurrency)) await sleep(10);
		const nextFunction = functions.shift()!;
		currentFunctions.push(nextFunction);
		nextFunction()
			.then(async (result) => {
				results.push(result);
				await sleep(delay);
				const index = currentFunctions.indexOf(nextFunction);
				currentFunctions.splice(index, 1);
			})
			.catch((err) => {
				errors.push(err);
			});
	}

	while (currentFunctions.length > 0) {
		await sleep(10);
	}

	return [results, errors];
}
