/**
 * Hands the event loop back (one `setImmediate`) once `sliceMs` has passed since the last
 * time. An `await` on an already-settled promise runs as a microtask and lets nothing else in,
 * so cached work in a loop holds the whole replica: placement ran 12 s without a break on
 * 2026-11-11, and every request and health probe on that replica waited.
 *
 * Callers waiting at once share one hand-back and one slice: each resetting its own clock as it
 * resumed let five releases placed together run 15 ms apiece, back to back, in a single turn.
 */
export function eventLoopSlicer(sliceMs = 15): () => Promise<void> {
	let sliceStart = performance.now();
	let turn: Promise<void> | null = null;
	return async () => {
		if (performance.now() - sliceStart < sliceMs) return;
		turn ??= new Promise<void>((resolve) =>
			setImmediate(() => {
				turn = null;
				sliceStart = performance.now();
				resolve();
			})
		);
		await turn;
	};
}
