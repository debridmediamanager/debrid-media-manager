export const groupBy = (itemLimit: number, hashes: string[]) =>
	Array.from({ length: Math.ceil(hashes.length / itemLimit) }, (_, i) =>
		hashes.slice(i * itemLimit, (i + 1) * itemLimit)
	);
