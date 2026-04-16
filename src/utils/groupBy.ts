/**
 * Groups an array into smaller arrays of specified size
 * @param itemLimit - Maximum number of items per group
 * @param items - Array to be grouped
 * @returns Array of arrays, each containing at most itemLimit elements
 */
export const groupBy = <T>(itemLimit: number, items: T[]): T[][] =>
	Array.from({ length: Math.ceil(items.length / itemLimit) }, (_, i) =>
		items.slice(i * itemLimit, (i + 1) * itemLimit)
	);
