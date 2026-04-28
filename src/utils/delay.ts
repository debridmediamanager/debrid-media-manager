// setTimeout gets throttled to 1s+ in inactive browser tabs.
// Use setTimeout for the bulk of the wait, then a single MessageChannel
// tick to compensate if the browser over-slept due to throttling.
const isBrowser = typeof window !== 'undefined' && !process.env.VITEST_WORKER_ID;

export function delay(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	if (!isBrowser) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	return new Promise((resolve) => {
		const start = Date.now();
		setTimeout(() => {
			const elapsed = Date.now() - start;
			if (elapsed >= ms) {
				resolve();
				return;
			}
			// setTimeout was throttled — finish the remaining wait with one MessageChannel hop
			const remaining = ms - elapsed;
			setTimeout(resolve, remaining);
		}, ms);
	});
}
