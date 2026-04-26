// Background-tab-safe delay using MessageChannel.
// setTimeout gets throttled to 1s+ in inactive tabs; MessageChannel keeps timing.
// Falls back to setTimeout in non-browser / test environments.
const useFallback = typeof window === 'undefined' || !!process.env.VITEST_WORKER_ID;

export function delay(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	if (useFallback) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	return new Promise((resolve) => {
		const start = Date.now();
		function tick() {
			if (Date.now() - start >= ms) {
				resolve();
				return;
			}
			const ch = new MessageChannel();
			ch.port1.onmessage = tick;
			ch.port2.postMessage(null);
		}
		const ch = new MessageChannel();
		ch.port1.onmessage = tick;
		ch.port2.postMessage(null);
	});
}
