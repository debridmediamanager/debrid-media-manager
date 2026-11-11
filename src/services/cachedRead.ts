/**
 * A database read shared by every request on one instance for `ttlMs`. A failed read
 * keeps the last good value (or `fallback` before any) and is retried after the TTL,
 * not on every request while the database is down.
 */
export function cachedRead<T>(read: () => Promise<T>, fallback: T, ttlMs: number, label: string) {
	let cached: { at: number; value: T } | null = null;
	let reading: Promise<T> | null = null;
	return {
		async get(): Promise<T> {
			if (cached && Date.now() - cached.at < ttlMs) return cached.value;
			reading ??= read()
				.catch((error) => {
					console.error(`${label}: reading failed, keeping the last value:`, error);
					return cached?.value ?? fallback;
				})
				.then((value) => {
					cached = { at: Date.now(), value };
					return value;
				})
				.finally(() => {
					reading = null;
				});
			return reading;
		},
		/** After a save, so this instance reads again on its next request. */
		invalidate() {
			cached = null;
		},
		resetForTest() {
			cached = null;
			reading = null;
		},
	};
}
