/**
 * Groups an array of strings into smaller arrays of specified size
 * @param itemLimit - Maximum number of items per group
 * @param hashes - Array of strings to be grouped
 * @returns Array of string arrays, each containing at most itemLimit elements
 */
export const groupBy = (itemLimit: number, hashes: string[]): string[][] =>
	Array.from({ length: Math.ceil(hashes.length / itemLimit) }, (_, i) =>
		hashes.slice(i * itemLimit, (i + 1) * itemLimit)
	);
