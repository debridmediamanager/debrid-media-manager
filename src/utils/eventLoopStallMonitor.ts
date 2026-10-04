// A replica whose event loop blocks cannot answer its health probe, and on
// 2026-10-04 four such stalls took every dmm_web replica down. This names each
// stall in the log so it can be lined up with the request that caused it.

interface StallMonitorOptions {
	intervalMs?: number;
	thresholdMs?: number;
	now?: () => number;
	warn?: (message: string) => void;
}

export function startEventLoopStallMonitor({
	intervalMs = 250,
	thresholdMs = 500,
	now = Date.now,
	warn = console.warn,
}: StallMonitorOptions = {}): () => void {
	let expected = now() + intervalMs;
	const timer = setInterval(() => {
		const current = now();
		const lag = current - expected;
		if (lag >= thresholdMs) {
			warn(`[event-loop] blocked for ${lag}ms`);
		}
		expected = current + intervalMs;
	}, intervalMs);
	timer.unref?.();
	return () => clearInterval(timer);
}
