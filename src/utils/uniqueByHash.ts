/**
 * The first row for each hash, in order. The hashlist page used to do this with
 * `findIndex` inside its filter, comparing every row with every row before it:
 * 13 of the ~20 s a 28k-item list (2026-09-30) kept the main thread busy.
 */
export function uniqueByHash<T extends { hash: string }>(rows: T[]): T[] {
	const seen = new Set<string>();
	return rows.filter((row) => {
		if (seen.has(row.hash)) return false;
		seen.add(row.hash);
		return true;
	});
}
